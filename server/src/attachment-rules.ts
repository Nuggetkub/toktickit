// Attachment rules for Lab 2 (BR-31 to BR-38). No database and no HTTP, so the
// boundaries can be tested at the boundary.

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ACTIVE = 5;
export const REASON_MIN = 5;
export const REASON_MAX = 250;

export const PERMITTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type PermittedType = (typeof PERMITTED_TYPES)[number];

/**
 * Identifies a file from its own leading bytes.
 *
 * BR-31 says the server determines the type from the file's content. The obvious
 * shortcut is to read the `Content-Type` of the multipart part, but that value is
 * supplied by whoever is uploading: an executable announced as `image/png` would
 * pass. The declared type is therefore ignored entirely, and the detected type is
 * what gets stored — so the recorded MIME type is one the server established
 * rather than one it was told.
 */
export function detectAttachmentType(bytes: Buffer): PermittedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }

  // RIFF....WEBP — the four size bytes between the two markers are skipped.
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}

export type AttachmentRejection =
  | { status: 415; code: "ATTACHMENT_TYPE_NOT_ALLOWED"; message: string }
  | { status: 413; code: "ATTACHMENT_TOO_LARGE"; message: string };

export type AttachmentCheck =
  | { type: PermittedType; rejection?: never }
  | { type?: never; rejection: AttachmentRejection };

export function checkAttachment(bytes: Buffer): AttachmentCheck {
  // Size first: a 40 MB file that is also the wrong type should be refused for
  // the reason the user can act on most easily.
  if (bytes.length > MAX_BYTES) {
    return {
      rejection: {
        status: 413,
        code: "ATTACHMENT_TOO_LARGE",
        message: "Each attachment must be 5 MB or smaller.",
      },
    };
  }

  const type = detectAttachmentType(bytes);
  if (type === null) {
    return {
      rejection: {
        status: 415,
        code: "ATTACHMENT_TYPE_NOT_ALLOWED",
        message: "Attachments must be JPEG, PNG, WEBP or PDF.",
      },
    };
  }

  return { type };
}

/** BR-38: trimmed, 5-250 characters. */
export function validateRemovalReason(
  body: unknown,
): { reason: string; fieldErrors?: never } | { reason?: never; fieldErrors: Record<string, string> } {
  const message = `Give a removal reason of ${REASON_MIN}-${REASON_MAX} characters.`;

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { fieldErrors: { removalReason: message } };
  }

  const value = (body as Record<string, unknown>).removalReason;
  if (typeof value !== "string") return { fieldErrors: { removalReason: message } };

  const reason = value.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { fieldErrors: { removalReason: message } };
  }

  return { reason };
}

// Control characters, plus the characters reserved in filenames and the two path
// separators. A quoted header value containing a newline or a double quote is a
// header-injection risk rather than merely untidy.
const UNSAFE_FILENAME_CHARACTERS = new RegExp("[\\u0000-\\u001f<>:\"|?*\\\\/]", "g");

/**
 * A download name the browser can save, built without the original filename ever
 * reaching a filesystem path (BR-35). The extension is preserved, because it is
 * what makes the saved file openable.
 */
export function safeDownloadName(originalFilename: string): string {
  const withoutPath = originalFilename.split(/[\\/]/).pop() ?? "";
  const cleaned = withoutPath.replace(UNSAFE_FILENAME_CHARACTERS, "").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 180) || "attachment";
}
