import type { Prisma } from "@prisma/client";

/**
 * The attachment fields any response may carry.
 *
 * `storageKey` is deliberately absent: it is an internal locator, and disclosing
 * it invites someone to ask for it directly (BR-35). The shape lives here rather
 * than inside a route so the Ticket Detail response and the attachment list
 * cannot drift apart — api-spec.md §3 says they are the same metadata.
 */
export const attachmentSelect = {
  id: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
  removedAt: true,
  removedByRequesterId: true,
  removalReason: true,
} satisfies Prisma.AttachmentSelect;

export type AttachmentView = Prisma.AttachmentGetPayload<{ select: typeof attachmentSelect }>;
