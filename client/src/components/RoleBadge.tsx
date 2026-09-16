import type { Role } from "../api.js";

const LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

const TONES: Record<Role, string> = {
  REQUESTER: "zen-badge--role-requester",
  IT_STAFF: "zen-badge--role-staff",
  ADMINISTRATOR: "zen-badge--role-admin",
};

/**
 * ui-spec.md §1 — the role in words, always. The tone reinforces the label and
 * never replaces it, so the badge still reads correctly in monochrome or to
 * anyone who cannot distinguish the three fills.
 */
export function RoleBadge({ role }: { role: Role }) {
  return <span className={`zen-badge ${TONES[role]}`}>{LABELS[role]}</span>;
}
