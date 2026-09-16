// Query parsing for GET /api/staff/tickets (api-spec.md §5, FR-09, BR-33).
//
// Kept apart from the route so the rules can be unit-tested without a database,
// exactly as Lab 2's ticket-query.ts is. Every rule rejects rather than ignores
// (Lab 2 BR-27): an unrecognised filter value must not come back as a
// legitimate-looking result set, because "no tickets match" and "you asked the
// wrong question" are different answers and the caller cannot tell them apart.
//
// **Every parameter is evaluated before the error check below.** That ordering
// is load-bearing, not stylistic: computing a filter inside the returned object
// literal, under an early `if (errors) return`, means the filter is never
// validated when some other parameter already failed — and is accepted and
// silently dropped when it is the only bad one. I found exactly that defect
// while reviewing my peer's queue (Earth2509 PR #46), where
// `?currentStatus=unknown` answered 200 with the unfiltered queue.

export const STAFF_SORT_FIELDS = [
  "ticketDate",
  "updatedAt",
  "ticketNumber",
  "itPriority",
  "requestedPriority",
  "currentStatus",
] as const;
export const STAFF_SORT_ORDERS = ["asc", "desc"] as const;
export const STAFF_PAGE_SIZES = [10, 25, 50] as const;
export const STAFF_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const STAFF_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;

export const STAFF_DEFAULT_PAGE_SIZE = 10;
export const STAFF_SEARCH_MAX = 100;

export type StaffSortField = (typeof STAFF_SORT_FIELDS)[number];
export type StaffSortOrder = (typeof STAFF_SORT_ORDERS)[number];
export type StaffPageSize = (typeof STAFF_PAGE_SIZES)[number];
export type StaffPriority = (typeof STAFF_PRIORITIES)[number];
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** `me` and `unassigned` are the two named owners; anything else is a user id. */
export type OwnerFilter = "me" | "unassigned" | number;

export type StaffQueueQuery = {
  search?: string;
  currentStatus?: StaffStatus;
  itPriority?: StaffPriority;
  categoryId?: number;
  owner?: OwnerFilter;
  requesterIndicated?: true;
  sortBy: StaffSortField;
  sortOrder: StaffSortOrder;
  page: number;
  pageSize: StaffPageSize;
};

export type StaffQueueValidation =
  | { value: StaffQueueQuery; fieldErrors?: never }
  | { value?: never; fieldErrors: Record<string, string> };

export function validateStaffQueueQuery(raw: Record<string, unknown>): StaffQueueValidation {
  const fieldErrors: Record<string, string> = {};

  // All ten are computed first. See the note at the top of this file.
  const search = optionalSearch(raw.search, fieldErrors);
  const currentStatus = optionalChoice(raw.currentStatus, "currentStatus", STAFF_STATUSES, fieldErrors);
  const itPriority = optionalChoice(raw.itPriority, "itPriority", STAFF_PRIORITIES, fieldErrors);
  const categoryId = optionalId(raw.categoryId, "categoryId", fieldErrors);
  const owner = optionalOwner(raw.owner, fieldErrors);
  const requesterIndicated = optionalIndicated(raw.requesterIndicated, fieldErrors);
  const sortBy = optionalChoice(raw.sortBy, "sortBy", STAFF_SORT_FIELDS, fieldErrors) ?? "ticketDate";
  const sortOrder = optionalChoice(raw.sortOrder, "sortOrder", STAFF_SORT_ORDERS, fieldErrors) ?? "desc";
  const page = optionalPage(raw.page, fieldErrors);
  const pageSize = optionalPageSize(raw.pageSize, fieldErrors);

  // An unknown parameter is refused too. A client that misspells `itPriority`
  // would otherwise believe it had filtered the queue.
  const known = new Set([
    "search",
    "currentStatus",
    "itPriority",
    "categoryId",
    "owner",
    "requesterIndicated",
    "sortBy",
    "sortOrder",
    "page",
    "pageSize",
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) fieldErrors[key] = "This query parameter is not supported.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  return {
    value: {
      ...(search ? { search } : {}),
      ...(currentStatus ? { currentStatus } : {}),
      ...(itPriority ? { itPriority } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(requesterIndicated ? { requesterIndicated } : {}),
      sortBy,
      sortOrder,
      page: page ?? 1,
      pageSize: pageSize ?? STAFF_DEFAULT_PAGE_SIZE,
    },
  };
}

/** Total pages, never below 1 — a reader is always on page 1 of at least 1. */
export function staffTotalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

function only(value: unknown, field: string, fieldErrors: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  // Express turns a repeated parameter into an array. Picking one silently would
  // make ?page=1&page=99 mean something the caller did not write.
  if (Array.isArray(value)) {
    fieldErrors[field] = "Provide this parameter once.";
    return undefined;
  }
  if (typeof value !== "string") {
    fieldErrors[field] = "Provide a single text value.";
    return undefined;
  }
  return value;
}

function optionalSearch(value: unknown, fieldErrors: Record<string, string>): string | undefined {
  const raw = only(value, "search", fieldErrors);
  if (raw === undefined) return undefined;

  const search = raw.trim();
  if (search.length === 0) return undefined;
  if (search.length > STAFF_SEARCH_MAX) {
    fieldErrors.search = `Search must be ${STAFF_SEARCH_MAX} characters or fewer.`;
    return undefined;
  }
  return search;
}

function optionalId(value: unknown, field: string, fieldErrors: Record<string, string>): number | undefined {
  const raw = only(value, field, fieldErrors);
  if (raw === undefined) return undefined;

  if (!/^\d+$/.test(raw)) {
    fieldErrors[field] = "Provide a positive whole number.";
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fieldErrors[field] = "Provide a positive whole number.";
    return undefined;
  }
  return parsed;
}

/**
 * `owner=me`, `owner=unassigned`, or a user id (api-spec.md §5).
 *
 * `me` is resolved in the route rather than here, because this module has no
 * caller — keeping it free of identity is what lets the whole parameter set be
 * unit-tested without a session.
 */
function optionalOwner(value: unknown, fieldErrors: Record<string, string>): OwnerFilter | undefined {
  const raw = only(value, "owner", fieldErrors);
  if (raw === undefined) return undefined;

  if (raw === "me" || raw === "unassigned") return raw;

  if (!/^\d+$/.test(raw)) {
    fieldErrors.owner = "Choose one of: me, unassigned, or a user id.";
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fieldErrors.owner = "Choose one of: me, unassigned, or a user id.";
    return undefined;
  }
  return parsed;
}

/**
 * Only `true` is accepted (BR-33). `requesterIndicated=false` is refused rather
 * than treated as "no filter": the two mean different things to whoever typed
 * it, and quietly answering the unfiltered queue would be the silent-drop
 * failure this module exists to prevent.
 */
function optionalIndicated(value: unknown, fieldErrors: Record<string, string>): true | undefined {
  const raw = only(value, "requesterIndicated", fieldErrors);
  if (raw === undefined) return undefined;

  if (raw !== "true") {
    fieldErrors.requesterIndicated = "Use requesterIndicated=true, or omit it.";
    return undefined;
  }
  return true;
}

function optionalPage(value: unknown, fieldErrors: Record<string, string>): number | undefined {
  const raw = only(value, "page", fieldErrors);
  if (raw === undefined) return undefined;

  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    fieldErrors.page = "Page must be a whole number of 1 or more.";
    return undefined;
  }
  return Number(raw);
}

function optionalPageSize(value: unknown, fieldErrors: Record<string, string>): StaffPageSize | undefined {
  const raw = only(value, "pageSize", fieldErrors);
  if (raw === undefined) return undefined;

  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !(STAFF_PAGE_SIZES as readonly number[]).includes(parsed)) {
    fieldErrors.pageSize = `Page size must be one of: ${STAFF_PAGE_SIZES.join(", ")}.`;
    return undefined;
  }
  return parsed as StaffPageSize;
}

function optionalChoice<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
  fieldErrors: Record<string, string>,
): T[number] | undefined {
  const raw = only(value, field, fieldErrors);
  if (raw === undefined) return undefined;

  if (!allowed.includes(raw)) {
    fieldErrors[field] = `Choose one of: ${allowed.join(", ")}.`;
    return undefined;
  }
  return raw as T[number];
}
