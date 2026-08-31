import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { resolveRequester } from "./requester-context.js";
import { MAX_ACTIVE, checkAttachment, safeDownloadName, validateRemovalReason } from "./attachment-rules.js";

// Files live outside the database: binaries in Postgres make backups and query
// plans worse for no gain (decision D-06). The directory is configurable so the
// test run and the E2E run do not write into a developer's working copy.
const storageDirectory = path.resolve(process.env.ATTACHMENT_STORAGE_DIR ?? path.join(process.cwd(), "storage", "attachments"));

// storageKey is never returned: it is an internal locator, and disclosing it
// invites someone to ask for it directly.
const attachmentSelect = {
  id: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
  removedAt: true,
  removedByRequesterId: true,
  removalReason: true,
} satisfies Prisma.AttachmentSelect;

type RequesterContext = { id: number; fullName: string };

/** Resolves identity, or answers. Returns null when the caller has been answered. */
async function requireRequester(req: Request, res: Response, context: string): Promise<RequesterContext | null> {
  const resolved = await resolveRequester(req).catch(() => null);
  if (resolved === null) {
    sendDependencyUnavailable(res, context, new Error("requester lookup failed"));
    return null;
  }
  if (!resolved.requester) {
    sendError(res, 401, "REQUESTER_CONTEXT_REQUIRED", "Select a Development Requester first.");
    return null;
  }
  return resolved.requester;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function uploadAttachment(req: Request, res: Response): Promise<void> {
  const requester = await requireRequester(req, res, "POST attachment");
  if (!requester) return;

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
      const owned = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} AND "requesterId" = ${requester.id} FOR UPDATE
      `;
      if (owned.length === 0) return { notFound: true as const };

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
  const requester = await requireRequester(req, res, "GET attachments");
  if (!requester) return;

  const ticketId = positiveId(req.params.ticketId);
  if (ticketId === null) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  try {
    const owned = await getPrisma().ticket.findFirst({
      where: { id: ticketId, requesterId: requester.id },
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
  const requester = await requireRequester(req, res, "GET attachment download");
  if (!requester) return;

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
        ticket: { requesterId: requester.id },
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
  const requester = await requireRequester(req, res, "PATCH attachment");
  if (!requester) return;

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
        where: { id: attachmentId, ticketId, ticket: { requesterId: requester.id } },
        select: { id: true, removedAt: true },
      });
      if (!existing) return { notFound: true as const };

      // The first removal's reason and timestamp are the record. A second
      // removal must not overwrite who removed it or why.
      if (existing.removedAt) return { alreadyRemoved: true as const };

      const removed = await tx.attachment.update({
        where: { id: existing.id },
        data: {
          removedAt: new Date(),
          removedByRequesterId: requester.id,
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
    if ("alreadyRemoved" in outcome) {
      sendError(res, 409, "ATTACHMENT_ALREADY_REMOVED", "That attachment has already been removed.");
      return;
    }

    res.status(200).json(outcome.removed);
  } catch (error) {
    sendDependencyUnavailable(res, "PATCH /api/tickets/:id/attachments/:id", error);
  }
}
