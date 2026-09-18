import { normalizeEmail, validateNewPassword } from "./password.js";

// Policy for Administrator user management (api-spec.md §8, BR-38 to BR-42).
//
// No Express and no Prisma here, so every rule is unit-testable without a
// database — the same split as ticket-workflow.ts. The route file owns the
// transaction and the row lock; this file owns what the rules *say*.

export const USER_ROLES = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** BR-39, after trimming. */
export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const USER_SEARCH_MAX = 100;

type Validation<T> =
  | { value: T; fieldErrors?: never }
  | { value?: never; fieldErrors: Record<string, string> };

export type UserListQuery = { search?: string; role?: UserRole };

export type NewUser = {
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  initialPassword: string;
};

export type UserEdit = {
  fullName?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
};

const LIST_PARAMS = new Set(["search", "role"]);
const EDIT_FIELDS = new Set(["fullName", "email", "role", "isActive"]);

function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * BR-38's filters.
 *
 * Both parameters are computed before the error check, and an unrecognised
 * parameter is rejected rather than ignored (Lab 2 BR-27). That ordering is
 * load-bearing rather than stylistic: evaluating a filter inside the returned
 * object, below an early `if (errors) return`, leaves it unvalidated whenever
 * another parameter already failed — which is exactly the defect I found in my
 * peer's queue validator on his PR #46, where `?currentStatus=unknown` answered
 * `200` with an unfiltered list.
 */
export function validateUserListQuery(raw: Record<string, unknown>): Validation<UserListQuery> {
  const fieldErrors: Record<string, string> = {};

  const search = optionalSearch(raw.search, fieldErrors);
  const role = optionalRole(raw.role, fieldErrors);

  for (const key of Object.keys(raw)) {
    if (!LIST_PARAMS.has(key)) fieldErrors[key] = "Unknown query parameter.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return {
    value: {
      ...(search === undefined ? {} : { search }),
      ...(role === undefined ? {} : { role }),
    },
  };
}

function optionalSearch(raw: unknown, fieldErrors: Record<string, string>): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    fieldErrors.search = "Search must be text.";
    return undefined;
  }
  const trimmed = raw.trim();
  // An empty search is the caller asking a question they did not mean to ask;
  // answering the unfiltered list would look like a match.
  if (trimmed.length === 0 || trimmed.length > USER_SEARCH_MAX) {
    fieldErrors.search = `Search for 1 to ${USER_SEARCH_MAX} characters.`;
    return undefined;
  }
  return trimmed;
}

function optionalRole(raw: unknown, fieldErrors: Record<string, string>): UserRole | undefined {
  if (raw === undefined) return undefined;
  if (!isRole(raw)) {
    fieldErrors.role = `Choose one of ${USER_ROLES.join(", ")}.`;
    return undefined;
  }
  return raw;
}

function validateName(raw: unknown, fieldErrors: Record<string, string>): string | undefined {
  if (typeof raw !== "string") {
    fieldErrors.fullName = "Enter a name.";
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    fieldErrors.fullName = `Use ${NAME_MIN} to ${NAME_MAX} characters.`;
    return undefined;
  }
  return trimmed;
}

/**
 * BR-11's password rules, reported under the field this endpoint actually has.
 *
 * `validateNewPassword` keys its errors as `newPassword`, because that is what
 * the change-password form calls it. Renaming here rather than at the call site
 * keeps one implementation of the rules and still puts the message beneath the
 * field the Administrator is looking at.
 */
function validateInitial(raw: unknown, email: string | undefined, fieldErrors: Record<string, string>): string | undefined {
  const check = validateNewPassword({ newPassword: raw, ...(email === undefined ? {} : { email }) });
  if (check.ok) return raw as string;
  fieldErrors.initialPassword = check.fieldErrors.newPassword ?? "That initial password cannot be used.";
  return undefined;
}

export function validateUserCreate(body: unknown): Validation<NewUser> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  // Every field is computed before the error check — see validateUserListQuery.
  const fullName = validateName(raw.fullName, fieldErrors);
  const email = normalizeEmail(raw.email);
  if (email === undefined) fieldErrors.email = "Enter a valid email address.";

  const role = raw.role;
  if (!isRole(role)) fieldErrors.role = `Choose one of ${USER_ROLES.join(", ")}.`;

  const isActive = raw.isActive;
  if (typeof isActive !== "boolean") fieldErrors.isActive = "Choose whether the account is active.";

  const initialPassword = validateInitial(raw.initialPassword, email, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return {
    value: {
      fullName: fullName!,
      email: email!,
      role: role as UserRole,
      isActive: isActive as boolean,
      initialPassword: initialPassword!,
    },
  };
}

export function validateUserEdit(body: unknown): Validation<UserEdit> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const edit: UserEdit = {};

  for (const key of Object.keys(raw)) {
    if (!EDIT_FIELDS.has(key)) fieldErrors[key] = "Unknown field.";
  }

  if (raw.fullName !== undefined) {
    const fullName = validateName(raw.fullName, fieldErrors);
    if (fullName !== undefined) edit.fullName = fullName;
  }

  if (raw.email !== undefined) {
    const email = normalizeEmail(raw.email);
    if (email === undefined) fieldErrors.email = "Enter a valid email address.";
    else edit.email = email;
  }

  if (raw.role !== undefined) {
    if (!isRole(raw.role)) fieldErrors.role = `Choose one of ${USER_ROLES.join(", ")}.`;
    else edit.role = raw.role;
  }

  if (raw.isActive !== undefined) {
    if (typeof raw.isActive !== "boolean") fieldErrors.isActive = "Choose whether the account is active.";
    else edit.isActive = raw.isActive;
  }

  // An empty edit is not a no-op to be accepted quietly: it means the request
  // did not say what to change, and answering 200 would claim a change happened.
  if (Object.keys(raw).length === 0) fieldErrors.fullName = "Send at least one field to change.";

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return { value: edit };
}

export function validateInitialPasswordReset(body: unknown, email: string): Validation<{ initialPassword: string }> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const initialPassword = validateInitial(raw.initialPassword, email, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return { value: { initialPassword: initialPassword! } };
}

export type SelfProtection = {
  code: "CANNOT_DEACTIVATE_SELF" | "CANNOT_CHANGE_OWN_ROLE";
  message: string;
};

/**
 * BR-41. An Administrator may edit their own name and email; what they may not
 * do is remove their own access, in either of the two ways that would.
 */
export function selfProtectionRefusal(input: {
  actorId: number;
  targetId: number;
  targetRole: UserRole;
  edit: UserEdit;
}): SelfProtection | null {
  if (input.actorId !== input.targetId) return null;

  if (input.edit.isActive === false) {
    return {
      code: "CANNOT_DEACTIVATE_SELF",
      message: "You cannot deactivate your own account. Ask another Administrator to do it.",
    };
  }

  if (input.edit.role !== undefined && input.edit.role !== input.targetRole) {
    return {
      code: "CANNOT_CHANGE_OWN_ROLE",
      message: "You cannot change your own role. Ask another Administrator to do it.",
    };
  }

  return null;
}

/**
 * BR-42, decided from a count the caller must have read under the row lock.
 *
 * Pure on purpose: the rule is "would this change leave zero active
 * Administrators", and that is separable from how the count was obtained. The
 * locking is the route's job, and the concurrency test is what proves the route
 * does it — a pure function cannot promise that, so it does not pretend to.
 */
export function removesLastActiveAdministrator(input: {
  targetRole: UserRole;
  targetIsActive: boolean;
  edit: UserEdit;
  activeAdministratorCount: number;
}): boolean {
  const isActiveAdministrator = input.targetIsActive && input.targetRole === "ADMINISTRATOR";
  if (!isActiveAdministrator) return false;

  const deactivated = input.edit.isActive === false;
  const demoted = input.edit.role !== undefined && input.edit.role !== "ADMINISTRATOR";
  if (!deactivated && !demoted) return false;

  return input.activeAdministratorCount <= 1;
}

/**
 * BR-25. Losing operator access is what unassigns the tickets — not merely
 * being edited. A Requester never owned any, so demoting one changes nothing.
 */
export function losesOperatorAccess(input: { targetRole: UserRole; edit: UserEdit }): boolean {
  const wasOperator = input.targetRole === "IT_STAFF" || input.targetRole === "ADMINISTRATOR";
  if (!wasOperator) return false;
  return input.edit.isActive === false || input.edit.role === "REQUESTER";
}

/**
 * BR-15. A role change, a deactivation or a new initial password ends every
 * session that account holds; renaming somebody does not.
 */
export function revokesSessions(input: { targetRole: UserRole; targetIsActive: boolean; edit: UserEdit }): boolean {
  const roleChanged = input.edit.role !== undefined && input.edit.role !== input.targetRole;
  const activationChanged = input.edit.isActive !== undefined && input.edit.isActive !== input.targetIsActive;
  return roleChanged || activationChanged;
}
