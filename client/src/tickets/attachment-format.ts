/**
 * How an attachment is described in words, shared by the Requester's Ticket
 * Detail and the IT Staff one.
 *
 * Extracted rather than copied: the two screens show the same rows to different
 * readers, and a second copy of "184 KB" would drift the moment one screen
 * gained a unit the other did not.
 */

const TYPE_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WEBP image",
  "application/pdf": "PDF document",
};

export function describeType(mimeType: string): string {
  return TYPE_LABELS[mimeType] ?? mimeType;
}

export function describeSize(bytes: number): string {
  // Kilobytes below a megabyte: "0.2 MB" for a screenshot tells the reader less
  // than "184 KB" does, and the column exists to be read rather than to be neat.
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function moment(value: string): string {
  return new Date(value).toLocaleString();
}
