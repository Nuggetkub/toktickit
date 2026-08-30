// Client-side attachment rules for the Create Ticket screen.
//
// These mirror the fixed labsheet constraints and BR-31 to BR-33. The server
// re-checks all of them when the file is actually uploaded (Issue #25) — this is
// here so the user finds out immediately rather than after a round trip, not
// because the client is trusted to decide.

export const PERMITTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const PERMITTED_TYPE_LABEL = "JPEG, PNG, WEBP or PDF";
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 5;

export type RejectedFile = { name: string; reason: string };

export type SelectionResult = {
  accepted: File[];
  rejected: RejectedFile[];
};

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Partitions a selection rather than rejecting it wholesale.
 *
 * A user who picks one good file and one bad one should keep the good one and be
 * told which was refused and why — losing both, with a message that names
 * neither, is the behaviour Part 6 asks us to demonstrate the *absence* of.
 *
 * `already` is the set of files kept from earlier selections, so the five-file
 * ceiling counts the whole basket rather than each pick in isolation.
 */
export function selectAttachments(chosen: File[], already: File[] = []): SelectionResult {
  const accepted = [...already];
  const rejected: RejectedFile[] = [];

  for (const file of chosen) {
    if (!(PERMITTED_TYPES as readonly string[]).includes(file.type)) {
      rejected.push({
        name: file.name,
        reason: `is not a permitted type — attach ${PERMITTED_TYPE_LABEL}`,
      });
      continue;
    }

    if (file.size > MAX_BYTES) {
      rejected.push({
        name: file.name,
        reason: `is ${formatSize(file.size)} — the limit is 5 MB per file`,
      });
      continue;
    }

    // Re-picking the same file should not silently double it up.
    if (accepted.some((kept) => kept.name === file.name && kept.size === file.size)) {
      continue;
    }

    if (accepted.length >= MAX_FILES) {
      rejected.push({ name: file.name, reason: `exceeds the limit of ${MAX_FILES} attachments` });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}

export function describeRejections(rejected: RejectedFile[]): string {
  return rejected.map((file) => `${file.name} ${file.reason}.`).join(" ");
}
