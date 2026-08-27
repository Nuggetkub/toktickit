# Lab 2 REST API Contract

**Status:** Draft for peer review
**Base path:** `/api`
**Companion document:** [`specification.md`](./specification.md)

---

## 1. Conventions

### Identity

Every **requester-scoped** endpoint requires the header:

```
X-Dev-Requester-Id: <requester id>
```

This identifies the Development Requester selected in the browser. It is a Lab 2 testing
mechanism and **is not authentication** (BR-05). The server resolves the header to an
active Requester on every request and enforces ownership itself; a client-side selection
is never trusted (BR-08). In Lab 3 this header is replaced by an authenticated identity
and no path, payload or ownership rule changes (BR-44, D-01).

A missing header, an unparseable value, or an id that does not resolve to an **active**
Requester returns `401` with code `REQUESTER_CONTEXT_REQUIRED`. This is the one place a
`401` appears, and it means "no testing context selected" rather than "not logged in".

### Content types

JSON requests and responses use `application/json`. Attachment upload uses
`multipart/form-data`. Attachment download returns the stored binary with its recorded
MIME type.

### Error envelope

Every error response uses one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The ticket could not be created.",
    "fieldErrors": { "summary": "Summary must be at least 5 characters." }
  }
}
```

`code` is a stable machine-readable identifier that tests assert on. `message` is safe for
display. `fieldErrors` is present only when individual fields failed, and is keyed by the
field name the client uses.

### Validation status

Any invalid client input — malformed body, unknown sort field, out-of-range page size,
failed field rule — returns **`400`** with `code: VALIDATION_FAILED` and, where
applicable, `fieldErrors`. `422` is deliberately not used (D-03).

### Safe failures

An unexpected server error returns `500` with `code: INTERNAL_ERROR` and a fixed message.
A dependency that is unavailable returns `503` with `code: DEPENDENCY_UNAVAILABLE`. Neither
includes a stack trace, SQL, or internal path (BR-41).

---

## 2. Reference and Requester Endpoints

These three are **not** requester-scoped and need no identity header — the selector must
be able to load before a Requester exists.

| Method and path | Purpose | Success |
|---|---|---|
| `GET /api/categories` | Active Categories, ordered by name | `200` `[{ "id", "name" }]` |
| `GET /api/related-systems` | Active Related Systems, ordered by name | `200` `[{ "id", "name" }]` |
| `GET /api/requesters` | Active Development Requesters for the selector, ordered by name | `200` `[{ "id", "fullName", "email" }]` |

Inactive rows are excluded from all three (BR-06). Each returns `503` if the database is
unreachable. An empty array is a valid answer and the interface treats it as an empty
state rather than an error.

---

## 3. Ticket Endpoints

### `POST /api/tickets` — create a Ticket

**Headers:** `X-Dev-Requester-Id` (required), `Idempotency-Key` (required, client-generated
UUID).

**Request**

```json
{
  "categoryId": 2,
  "relatedSystemId": 5,
  "summary": "Cannot connect to Campus Wi-Fi in Building 4",
  "description": "My laptop reports authentication failure on the campus network from Monday afternoon onward. Other devices connect normally in the same room.",
  "requestedPriority": "HIGH"
}
```

The Requester is taken from the header, never from the body (D-01). The Ticket Number,
Ticket Date and status are assigned by the server and are not accepted from the client
(BR-01, BR-03, BR-04).

**Success — `201`**

```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-00042",
  "ticketDate": "2026-08-27T09:14:22.518Z",
  "requester": { "id": 3, "fullName": "Nadia Rahman" },
  "category": { "id": 2, "name": "Network" },
  "relatedSystem": { "id": 5, "name": "Campus Wi-Fi" },
  "summary": "Cannot connect to Campus Wi-Fi in Building 4",
  "description": "My laptop reports authentication failure ...",
  "requestedPriority": "HIGH",
  "currentStatus": "NEW",
  "attachments": [],
  "createdAt": "2026-08-27T09:14:22.518Z",
  "updatedAt": "2026-08-27T09:14:22.518Z"
}
```

**Idempotent replay — `200`.** Reusing an `Idempotency-Key` with an identical payload
returns the originally created Ticket unchanged and creates nothing (BR-19). "Identical"
means the five body fields match after the same trimming that validation applies.

**Failures**

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Any field rule in BR-12 … BR-15 fails, or the body is malformed. `fieldErrors` names each failure. |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | The `Idempotency-Key` header is absent or is not a UUID. |
| `401` | `REQUESTER_CONTEXT_REQUIRED` | No valid active Requester in the identity header. |
| `404` | `REFERENCE_NOT_FOUND` | The Category or Related System does not exist or is inactive (BR-15). |
| `409` | `IDEMPOTENCY_KEY_CONFLICT` | The key was already used with a **different** payload. Nothing is created. |
| `500` / `503` | `INTERNAL_ERROR` / `DEPENDENCY_UNAVAILABLE` | Safe persistence failure. The transaction rolls back, consuming no Ticket Number (BR-20). |

### `GET /api/tickets` — list the selected Requester's Tickets

**Headers:** `X-Dev-Requester-Id` (required).

Results are scoped to that Requester before any other parameter is applied (BR-21).

| Parameter | Values | Default |
|---|---|---|
| `search` | Trimmed substring, matched case-insensitively against Ticket Number and Summary (BR-22) | none |
| `categoryId` | Integer, exact match | none |
| `relatedSystemId` | Integer, exact match | none |
| `requestedPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT`, exact match | none |
| `sortBy` | `ticketDate`, `ticketNumber`, `requestedPriority` | `ticketDate` |
| `sortOrder` | `asc`, `desc` | `desc` |
| `page` | Integer ≥ 1 | `1` |
| `pageSize` | `10`, `25`, `50` | `10` |

Ordering always appends Ticket Number descending as a tie-breaker, so paging is stable
(BR-24). Sorting by `requestedPriority` ascending runs `LOW` → `MEDIUM` → `HIGH` →
`URGENT`, because the column is an enum declared in that order (BR-25).

There is no `currentStatus` filter in Lab 2 (BR-30, D-07).

**Success — `200`**

```json
{
  "items": [
    {
      "id": 42,
      "ticketNumber": "TKT-2026-00042",
      "ticketDate": "2026-08-27T09:14:22.518Z",
      "summary": "Cannot connect to Campus Wi-Fi in Building 4",
      "category": { "id": 2, "name": "Network" },
      "relatedSystem": { "id": 5, "name": "Campus Wi-Fi" },
      "requestedPriority": "HIGH",
      "currentStatus": "NEW",
      "attachmentCount": 2
    }
  ],
  "page": 1,
  "pageSize": 10,
  "totalItems": 1,
  "totalPages": 1
}
```

A page beyond the last returns `200` with an empty `items` array (BR-26). An empty result
and a no-results result are the same response; the interface distinguishes them from
whether a query is active (BR-29).

**Failures:** `400 VALIDATION_FAILED` for an unknown `sortBy`, an unknown `sortOrder`, a
`pageSize` outside the permitted set, a `page` below 1, or an unrecognised
`requestedPriority` (BR-27). `401 REQUESTER_CONTEXT_REQUIRED` for a missing context.

### `GET /api/tickets/:ticketId` — retrieve one owned Ticket

**Headers:** `X-Dev-Requester-Id` (required).

**Success — `200`** returns the same shape as the create response, including full
`attachments` metadata with removed entries present and marked.

**Failures:** `404 TICKET_NOT_FOUND` when the ticket does not exist **or** belongs to a
different Requester — the two are indistinguishable by design (BR-10, D-04).
`401 REQUESTER_CONTEXT_REQUIRED` for a missing context.

---

## 4. Attachment Endpoints

All four are requester-scoped and require ownership of the parent Ticket (BR-40).

### `POST /api/tickets/:ticketId/attachments` — upload

**Headers:** `X-Dev-Requester-Id` (required).
**Body:** `multipart/form-data` with one field `file`.

The server verifies the type from the file's content rather than its extension (BR-31),
enforces the 5 MB ceiling (BR-32) and the five-active limit (BR-33), then writes the file
under a generated `storageKey` (BR-35).

**Success — `201`**

```json
{
  "id": 7,
  "originalFilename": "wifi-error.png",
  "mimeType": "image/png",
  "sizeBytes": 184203,
  "uploadedAt": "2026-08-27T09:20:41.004Z",
  "removedAt": null
}
```

**Failures**

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | No file part, or a malformed multipart request. |
| `401` | `REQUESTER_CONTEXT_REQUIRED` | No valid active Requester. |
| `404` | `TICKET_NOT_FOUND` | Ticket missing or owned by someone else. |
| `409` | `ATTACHMENT_LIMIT_REACHED` | Five active attachments already exist (BR-33). |
| `413` | `ATTACHMENT_TOO_LARGE` | Over 5 MB (BR-32). |
| `415` | `ATTACHMENT_TYPE_NOT_ALLOWED` | Content is not JPEG, PNG, WEBP or PDF (BR-31). |
| `500` / `503` | `INTERNAL_ERROR` / `DEPENDENCY_UNAVAILABLE` | Storage failure. No metadata row is written and the ticket is untouched (BR-36). |

### `GET /api/tickets/:ticketId/attachments` — metadata

**Headers:** `X-Dev-Requester-Id` (required).

**Success — `200`** an array of attachment metadata for an owned Ticket, **including
removed entries**, each carrying `removedAt`, `removedByRequesterId` and `removalReason`
when removed. `storageKey` is never returned.

**Failures:** `404 TICKET_NOT_FOUND`, `401 REQUESTER_CONTEXT_REQUIRED`.

### `GET /api/tickets/:ticketId/attachments/:attachmentId/download` — download

**Headers:** `X-Dev-Requester-Id` (required).

**Success — `200`** the file bytes, with `Content-Type` set from the recorded MIME type
and `Content-Disposition: attachment; filename="<sanitised original filename>"`.

**Failures:** `404 ATTACHMENT_NOT_FOUND` when the attachment does not exist, belongs to
another Requester's ticket, **or has been removed** — a removed file is not downloadable by
anyone (BR-39). `401 REQUESTER_CONTEXT_REQUIRED`.

### `PATCH /api/tickets/:ticketId/attachments/:attachmentId` — soft remove

**Headers:** `X-Dev-Requester-Id` (required).

**Request**

```json
{ "removalReason": "Uploaded the wrong screenshot; it shows another person's account." }
```

**Success — `200`**

```json
{
  "id": 7,
  "originalFilename": "wifi-error.png",
  "mimeType": "image/png",
  "sizeBytes": 184203,
  "uploadedAt": "2026-08-27T09:20:41.004Z",
  "removedAt": "2026-08-27T09:33:10.221Z",
  "removedByRequesterId": 3,
  "removalReason": "Uploaded the wrong screenshot; it shows another person's account."
}
```

The metadata row is retained and the file becomes undownloadable (BR-37, BR-39). The
stored bytes are not deleted in Lab 2, because a removal reason implies an audit trail
that a hard delete would destroy.

**Failures**

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Reason missing, or outside 5–250 characters after trimming (BR-38). |
| `401` | `REQUESTER_CONTEXT_REQUIRED` | No valid active Requester. |
| `404` | `ATTACHMENT_NOT_FOUND` | Missing, or on another Requester's ticket. |
| `409` | `ATTACHMENT_ALREADY_REMOVED` | The attachment is already removed. The first removal's reason and timestamp are authoritative and are not overwritten. |
| `500` / `503` | `INTERNAL_ERROR` / `DEPENDENCY_UNAVAILABLE` | Safe failure; nothing changes. |

---

## 5. Status Code Summary

| Status | Meaning in Lab 2 |
|---|---|
| `200` | Successful retrieval, idempotent create replay, or successful soft removal |
| `201` | Ticket or Attachment created |
| `400` | Any invalid client input, with `fieldErrors` where applicable (D-03) |
| `401` | No valid Development Requester context in `X-Dev-Requester-Id` |
| `404` | Missing, inactive, or not owned — deliberately indistinguishable (D-04) |
| `409` | Idempotency key conflict, attachment limit reached, or already removed |
| `413` | Attachment over 5 MB |
| `415` | Attachment type not permitted |
| `500` | Unexpected server error, safely worded |
| `503` | Database or storage unavailable, safely worded |

`403` is never returned: an ownership failure is reported as `404` so the response does not
confirm that another Requester's resource exists.

---

## 6. Capability Coverage

The ten capabilities the labsheet requires, mapped to the endpoints above:

| Required capability | Endpoint |
|---|---|
| Retrieve active Categories | `GET /api/categories` |
| Retrieve active Related Systems | `GET /api/related-systems` |
| Retrieve active Development Requesters | `GET /api/requesters` |
| Create a Ticket | `POST /api/tickets` |
| Retrieve the selected Requester's Tickets | `GET /api/tickets` |
| Retrieve one owned Ticket | `GET /api/tickets/:ticketId` |
| Upload an Attachment | `POST /api/tickets/:ticketId/attachments` |
| Retrieve Attachment metadata | `GET /api/tickets/:ticketId/attachments` |
| Download an active Attachment | `GET /api/tickets/:ticketId/attachments/:attachmentId/download` |
| Soft-remove an Attachment | `PATCH /api/tickets/:ticketId/attachments/:attachmentId` |
