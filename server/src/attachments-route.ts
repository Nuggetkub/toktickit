import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Request, Response } from "express";
import type { TicketStatus } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { attachmentSelect } from "./attachment-view.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import type { SessionUser } from "./session.js";
import { MAX_ACTIVE, checkAttachment, safeDownloadName, validateRemovalReason } from "./attachment-rules.js";
import { isTerminal } from "./ticket-workflow.js";

// Files live outside the database: binaries in Postgres make backups and query
// plans worse for no gain (decision D-06). The directory is configurable so the
// test run and the E2E run do not write into a developer's working copy.
const storageDirectory = path.resolve(process.env.ATTACHMENT_STORAGE_DIR ?? path.join(process.cwd(), "storage", "attachments"));

/**
 * Which tickets this caller may reach, as a query predicate rather than a check
 * performed afterwards (BR-19).
 *
 * A Requester is confined to their own ticket, exactly as in Lab 2. IT Staff and
 * Administrators may *read* any ticket's attachments and download the active
 * ones, per the authorization matrix — they are refused upload and removal at
 * the route, by requireRole, before anything here runs.
 */
function visibleTicket(user: SessionUser, ticketId: number) {
  return user.role === "REQUESTER" ? { id: ticketId, requesterId: user.id } : { id: ticketId };
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function uploadAttachment(req: Request, res: Response): Promise<void> {
  // Requester-only (authorization matrix), enforced at the route; the owner is
  // the session user, so there is no id here for a caller to influence.
  const user = currentUser(res);

  const ticketId = positiveId(req.params.ticketId);
  if (ticketId === null) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  const file = req.file;
  if (!file) {
    sendError(res, 400, "VALIDATION_FAILED", "Attach one file under the field name 'file'.", {
      file: "A file is required.",
    });
    return;
  }

  // Content decides the type, never the client's declared Content-Type (BR-31).
  const check = checkAttachment(file.buffer);
  if (check.rejection) {
    sendError(res, check.rejection.status, check.rejection.code, check.rejection.message);
    return;
  }

  const prisma = getPrisma();
  const storageKey = randomUUID();
  const storagePath = path.join(storageDirectory, storageKey);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Lock the Ticket row for the life of the transaction. Counting and then
      // inserting without this is a check-then-write: several uploads issued
      // together each read a count below the limit and each proceed, and a
      // multi-file picker uploading in parallel is the ordinary case rather than
      // an exotic one. Serialising per Ticket costs nothing at five attachments.
      const owned = await tx.$queryRaw<{ id: number; currentStatus: TicketStatus }[]>`
        SELECT "id", "currentStatus" FROM "Ticket" WHERE "id" = ${ticketId} AND "requesterId" = ${user.id} FOR UPDATE
      `;
      if (owned.length === 0) return { notFound: true as const };

      // BR-27: a closed or cancelled Ticket is frozen, and an attachment is part
      // of the Ticket. Checked here, inside the lock and before the file is
      // written, so a refusal never leaves bytes on disk.
      //
      // This route had no status check at all until issue #52 — the workflow
      // routes enforced BR-27 and the attachment routes did not, so a Requester
      // could still add to or withdraw from a finished Ticket.
      if (isTerminal(owned[0].currentStatus)) return { terminal: true as const };

      const active = await tx.attachment.count({ where: { ticketId, removedAt: null } });
      if (active >= MAX_ACTIVE) return { limitReached: true as const };

      // Written before the row exists so a failed write leaves no metadata
      // pointing at a missing file. The reverse order would.
      await mkdir(storageDirectory, { recursive: true });
      await writeFile(storagePath, file.buffer, { flag: "wx" });

      const attachment = await tx.attachment.create({
        data: {
          ticketId,
          storageKey,
          originalFilename: safeDownloadName(file.originalname),
          mimeType: check.type,
          sizeBytes: file.buffer.length,
        },
        select: attachmentSelect,
      });
      return { attachment };
    });

    if ("notFound" in created) {
      sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
      return;
    }
    if ("terminal" in created) {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }
    if ("limitReached" in created) {
      sendError(res, 409, "ATTACHMENT_LIMIT_REACHED", `A Ticket may have at most ${MAX_ACTIVE} active attachments.`);
      return;
    }

    res.status(201).json(created.attachment);
  } catch (error) {
    // The transaction rolled back, so the file on disk is an orphan.
    await unlink(storagePath).catch(() => undefined);
    sendDependencyUnavailable(res, "POST /api/tickets/:id/attachments", error);
  }
}

export async function listAttachments(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);

  const ticketId = positiveId(req.params.ticketId);
  if (ticketId === null) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  try {
    const owned = await getPrisma().ticket.findFirst({
      where: visibleTicket(user, ticketId),
      select: { id: true },
    });
    if (!owned) {
      sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
      return;
    }

    // Removed attachments are included: BR-39 keeps them visible as metadata.
    const attachments = await getPrisma().attachment.findMany({
      where: { ticketId },
      orderBy: { uploadedAt: "asc" },
      select: attachmentSelect,
    });
    res.status(200).json(attachments);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id/attachments", error);
  }
}

export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);

  const ticketId = positiveId(req.params.ticketId);
  const attachmentId = positiveId(req.params.attachmentId);
  if (ticketId === null || attachmentId === null) {
    sendError(res, 404, "ATTACHMENT_NOT_FOUND", "That attachment could not be found.");
    return;
  }

  try {
    // Ownership and "still active" are both part of the query, so a removed or
    // foreign file is never read from disk and then refused (BR-39, BR-40).
    const attachment = await getPrisma().attachment.findFirst({
      where: {
        id: attachmentId,
        ticketId,
        removedAt: null,
        ...(user.role === "REQUESTER" ? { ticket: { requesterId: user.id } } : {}),
      },
      select: { storageKey: true, originalFilename: true, mimeType: true },
    });

    if (!attachment) {
      sendError(res, 404, "ATTACHMENT_NOT_FOUND", "That attachment could not be found.");
      return;
    }

    const bytes = await readFile(path.join(storageDirectory, attachment.storageKey));
    res.status(200);
    res.setHeader("Content-Type", attachment.mimeType);
    // Always an attachment, never inline: the browser saves the file instead of
    // rendering it, which keeps a stored file from being served as a page.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadName(attachment.originalFilename))}`,
    );
    res.send(bytes);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id/attachments/:id/download", error);
  }
}

export async function removeAttachment(req: Request, res: Response): Promise<void> {
  // Requester-only, like upload: IT Staff were refused at the route.
  const user = currentUser(res);

  const ticketId = positiveId(req.params.ticketId);
  const attachmentId = positiveId(req.params.attachmentId);
  if (ticketId === null || attachmentId === null) {
    sendError(res, 404, "ATTACHMENT_NOT_FOUND", "That attachment could not be found.");
    return;
  }

  const validation = validateRemovalReason(req.body);
  if (!validation.reason) {
    sendError(res, 400, "VALIDATION_FAILED", "The attachment could not be removed.", validation.fieldErrors);
    return;
  }

  try {
    const outcome = await getPrisma().$transaction(async (tx) => {
      const existing = await tx.attachment.findFirst({
        where: { id: attachmentId, ticketId, ticket: { requesterId: user.id } },
        select: { id: true, removedAt: true, ticket: { select: { currentStatus: true } } },
      });
      if (!existing) return { notFound: true as const };

      // BR-27 before the removal rules, as in the workflow routes: "this Ticket
      // is finished" is the truer answer than anything about this one file.
      if (isTerminal(existing.ticket.currentStatus)) return { terminal: true as const };

      // The first removal's reason and timestamp are the record. A second
      // removal must not overwrite who removed it or why.
      if (existing.removedAt) return { alreadyRemoved: true as const };

      const removed = await tx.attachment.update({
        where: { id: existing.id },
        data: {
          removedAt: new Date(),
          removedByRequesterId: user.id,
          removalReason: validation.reason,
        },
        select: attachmentSelect,
      });
      return { removed };
    });

    if ("notFound" in outcome) {
      sendError(res, 404, "ATTACHMENT_NOT_FOUND", "That attachment could not be found.");
      return;
    }
    if ("terminal" in outcome) {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }
    if ("alreadyRemoved" in outcome) {
      sendError(res, 409, "ATTACHMENT_ALREADY_REMOVED", "That attachment has already been removed.");
      return;
    }

    res.status(200).json(outcome.removed);
  } catch (error) {
    sendDependencyUnavailable(res, "PATCH /api/tickets/:id/attachments/:id", error);
  }
}
