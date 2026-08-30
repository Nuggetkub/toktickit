// Query parsing for GET /api/tickets (api-spec.md §3, BR-21 to BR-28).
//
// Kept apart from the route so the rules can be unit-tested without a database.
// Every rule here rejects rather than ignores: a typo in a query string must not
// come back as a legitimate-looking empty list (BR-27), because "no results" and
// "you asked the wrong question" are different answers and the user cannot tell
// them apart from the outside.

export const SORT_FIELDS = ["ticketDate", "ticketNumber", "requestedPriority"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;
export const PAGE_SIZES = [10, 25, 50] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const DEFAULT_PAGE_SIZE = 10;
export const SEARCH_MAX = 120;

export type SortField = (typeof SORT_FIELDS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];
export type PageSize = (typeof PAGE_SIZES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type TicketListQuery = {
  search?: string;
  categoryId?: number;
  relatedSystemId?: number;
  requestedPriority?: Priority;
  sortBy: SortField;
  sortOrder: SortOrder;
  page: number;
  pageSize: PageSize;
};

export type QueryValidation =
  | { value: TicketListQuery; fieldErrors?: never }
  | { value?: never; fieldErrors: Record<string, string> };

export function validateTicketListQuery(raw: Record<string, unknown>): QueryValidation {
  const fieldErrors: Record<string, string> = {};

  const search = optionalSearch(raw.search, fieldErrors);
  const categoryId = optionalId(raw.categoryId, "categoryId", fieldErrors);
  const relatedSystemId = optionalId(raw.relatedSystemId, "relatedSystemId", fieldErrors);
  const requestedPriority = optionalChoice(raw.requestedPriority, "requestedPriority", PRIORITIES, fieldErrors);
  const sortBy = optionalChoice(raw.sortBy, "sortBy", SORT_FIELDS, fieldErrors) ?? "ticketDate";
  const sortOrder = optionalChoice(raw.sortOrder, "sortOrder", SORT_ORDERS, fieldErrors) ?? "desc";
  const page = optionalPage(raw.page, fieldErrors);
  const pageSize = optionalPageSize(raw.pageSize, fieldErrors);

  // Lab 2 has no Current Status filter (BR-30, decision D-07): every ticket is
  // NEW, so the control could never change a result set. Rejecting it rather
  // than ignoring it means a client written against a later lab is told, instead
  // of silently receiving unfiltered results it believes are filtered.
  if (raw.currentStatus !== undefined) {
    fieldErrors.currentStatus =
      "Current Status filtering arrives in Lab 3. Every Lab 2 Ticket is NEW.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  return {
    value: {
      ...(search ? { search } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(relatedSystemId ? { relatedSystemId } : {}),
      ...(requestedPriority ? { requestedPriority } : {}),
      sortBy,
      sortOrder,
      page: page ?? 1,
      pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    },
  };
}

/** Total pages, never below 1 — a reader is always on page 1 of at least 1. */
export function totalPages(totalItems: number, pageSize: number): number {
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
  if (search.length > SEARCH_MAX) {
    fieldErrors.search = `Search must be ${SEARCH_MAX} characters or fewer.`;
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

function optionalPage(value: unknown, fieldErrors: Record<string, string>): number | undefined {
  const raw = only(value, "page", fieldErrors);
  if (raw === undefined) return undefined;

  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    fieldErrors.page = "Page must be a whole number of 1 or more.";
    return undefined;
  }
  return Number(raw);
}

function optionalPageSize(value: unknown, fieldErrors: Record<string, string>): PageSize | undefined {
  const raw = only(value, "pageSize", fieldErrors);
  if (raw === undefined) return undefined;

  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !(PAGE_SIZES as readonly number[]).includes(parsed)) {
    fieldErrors.pageSize = `Page size must be one of: ${PAGE_SIZES.join(", ")}.`;
    return undefined;
  }
  return parsed as PageSize;
}
