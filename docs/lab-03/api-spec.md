# Lab 3 REST API Contract

**Status:** Draft for peer review
**Base path:** `/api`
**Companion documents:** [`specification.md`](./specification.md) ·
[Lab 2 API contract](../lab-02/api-spec.md)

Every Lab 2 endpoint, payload and error not mentioned here is unchanged. This document
defines what Lab 3 adds or alters.

---

## 1. Conventions

### Authentication

Sign-in sets a session cookie:

```
Set-Cookie: toktickit_session=<opaque token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
```

`Secure` is added when the API is configured for HTTPS; local development is plain HTTP.
The token is never returned in a response body and never accepted from anywhere but the
cookie. The server stores only its SHA-256 hash (BR-13).

The browser client sends every request with `credentials: "include"`. The server allows
exactly the origins in `CLIENT_ORIGINS` (comma-separated; default `http://localhost:5173`)
with `Access-Control-Allow-Credentials: true`. There is no wildcard (D-02).

### Origin check

A `POST`, `PATCH`, `PUT` or `DELETE` request must carry an `Origin` header equal to one of
`CLIENT_ORIGINS`. Otherwise it is refused with `403 ORIGIN_REJECTED` before
authentication or any other processing, and nothing changes (BR-16, D-03). Direct API
evidence captured with `curl` must therefore send `-H "Origin: http://localhost:5173"`.

### Authorization order

Every protected endpoint applies these checks in this order (BR-18):

| Step | Failure |
|---|---|
| 1. Origin, for state-changing methods | `403 ORIGIN_REJECTED` |
| 2. Valid, unexpired session for an active user | `401 UNAUTHENTICATED` |
| 3. No password change pending, except the three auth endpoints | `403 PASSWORD_CHANGE_REQUIRED` |
| 4. Role permitted for the endpoint — **before** any lookup | `403 FORBIDDEN` |
| 5. Resource exists and is visible to this user | `404` with the resource's code |
| 6. Input valid | `400 VALIDATION_FAILED` |
| 7. State permits the change | `409` with a specific code |

### Error envelope and validation

Unchanged from Lab 2:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "fieldErrors": { "email": "..." } } }
```

Every invalid input is `400 VALIDATION_FAILED` with `fieldErrors` where fields failed; `422`
is not used (Lab 2 D-03). Unknown body fields are ignored — in particular `requesterId`,
`authorId`, `createdAt` and `role` are never read from a ticket, comment or note body
(BR-03, BR-36).

### Shared shapes

```jsonc
// UserSummary — used wherever a person is referenced
{ "id": 7, "fullName": "Grace Okafor", "role": "IT_STAFF" }

// CurrentUser — returned by sign-in, current user and password change
{ "id": 7, "fullName": "Grace Okafor", "email": "grace.okafor@toktickit.local",
  "role": "IT_STAFF", "mustChangePassword": false }
```

A password hash, session token or attachment storage key never appears in any response.

---

## 2. Authentication

### `POST /api/auth/login`

**Request** `{ "email": "grace.okafor@toktickit.local", "password": "..." }`

**Success — `200`** `{ "user": CurrentUser }` and a new session cookie. A user with a
pending password change still receives `200`, with `mustChangePassword: true`; the
session they get can reach only the three endpoints in BR-02.

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Email or password missing, or the email is not an address. |
| `401` | `INVALID_CREDENTIALS` | Unknown email, wrong password, or an account with no password yet — one response for all three, with uniform timing (BR-06). Also an inactive account with a wrong password. |
| `403` | `ACCOUNT_INACTIVE` | Inactive account **and** correct password (BR-07). |
| `429` | `LOGIN_THROTTLED` | Five failures for this email in the last 15 minutes. `Retry-After` gives the seconds remaining (BR-09). |

No cookie is set on any failure.

### `GET /api/auth/me`

**Success — `200`** `{ "user": CurrentUser }`. Used by the client at start-up to decide
between Login, Change Password and the application.
**Failure** `401 UNAUTHENTICATED`.

### `POST /api/auth/change-password`

**Request** `{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }`

**Success — `200`** `{ "user": CurrentUser }` with `mustChangePassword: false` and a **new**
session cookie. Every other session of this user is deleted (BR-15).

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `fieldErrors.newPassword` for a BR-11 violation; `fieldErrors.confirmPassword` for a mismatch; `fieldErrors.currentPassword` for a wrong current password. A wrong current password is **not** a `401`: the session is valid, and the client treats every `401` as "session ended" (BR-47). |
| `401` | `UNAUTHENTICATED` | No valid session. |
| `429` | `LOGIN_THROTTLED` | Five wrong current passwords for this account within 15 minutes (BR-09). |

### `POST /api/auth/logout`

**Success — `204`**. The session is deleted and the cookie is cleared with `Max-Age=0`. A
request with no valid session also answers `204` and clears the cookie, so logging out is
always safe to retry.

---

## 3. Reference Data

`GET /api/categories` and `GET /api/related-systems` are unchanged in shape but now require
a signed-in user of any role (step 2 and 3 of the authorization order).

`GET /api/requesters` is **removed** and answers `404`. Nothing in Lab 3 selects a
Requester from a list.

---

## 4. Requester Tickets and Attachments

The Lab 2 endpoints keep their paths, payloads and error codes. What changes:

- The `X-Dev-Requester-Id` header is no longer read. Identity comes from the session
  (BR-03). The error code `REQUESTER_CONTEXT_REQUIRED` is retired; its place is taken by
  `401 UNAUTHENTICATED`.
- Each endpoint's permitted roles follow the authorization matrix:

| Endpoint | Requester | IT Staff / Administrator |
|---|---|---|
| `POST /api/tickets` | Creates, owned by the session user | `403` |
| `GET /api/tickets` | Own tickets only | `403` — IT Staff use the queue |
| `GET /api/tickets/:ticketId` | Own, else `404 TICKET_NOT_FOUND` | Any ticket |
| `GET /api/tickets/:ticketId/attachments` | Own | Any |
| `GET /api/tickets/:ticketId/attachments/:attachmentId/download` | Own | Any active attachment |
| `POST /api/tickets/:ticketId/attachments` | Own; `409 TICKET_TERMINAL` if closed or cancelled | `403` |
| `PATCH /api/tickets/:ticketId/attachments/:attachmentId` | Own; `409 TICKET_TERMINAL` if closed or cancelled | `403` |

- `GET /api/tickets` accepts one new filter, `currentStatus`, with any of the eight status
  values; anything else is `400` (FR-08).

### Ticket detail shape

`GET /api/tickets/:ticketId` returns the Lab 2 shape plus the workflow fields. The same
shape is returned to every permitted role; nothing in it is private.

```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-00042",
  "ticketDate": "2026-09-14T09:14:22.518Z",
  "requester": { "id": 3, "fullName": "Nadia Rahman", "role": "REQUESTER" },
  "category": { "id": 2, "name": "Network" },
  "relatedSystem": { "id": 5, "name": "Campus Wi-Fi" },
  "summary": "Cannot connect to Campus Wi-Fi in Building 4",
  "description": "...",
  "requestedPriority": "HIGH",
  "itPriority": "URGENT",
  "currentStatus": "IN_PROGRESS",
  "owner": { "id": 7, "fullName": "Grace Okafor", "role": "IT_STAFF" },
  "resolutionSummary": null,
  "requesterResolvedAt": null,
  "version": 4,
  "attachments": [],
  "createdAt": "2026-09-14T09:14:22.518Z",
  "updatedAt": "2026-09-14T10:02:51.004Z"
}
```

Internal Notes are never part of this shape, for any role; IT Staff fetch them from their
own endpoint (BR-34).

---

## 5. IT Staff Ticket Queue

### `GET /api/staff/tickets`

**Roles:** IT Staff, Administrator.

| Parameter | Values | Default |
|---|---|---|
| `search` | Trimmed substring, 1–100 characters, matched case-insensitively against Ticket Number, Summary and the Requester's name | none |
| `currentStatus` | One of the eight statuses | none |
| `itPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` | none |
| `categoryId` | Integer | none |
| `owner` | `me`, `unassigned`, or a user id | none |
| `requesterIndicated` | `true` — only tickets whose Requester indicated the problem appears resolved | none |
| `sortBy` | `ticketDate`, `updatedAt`, `ticketNumber`, `itPriority`, `requestedPriority`, `currentStatus` | `ticketDate` |
| `sortOrder` | `asc`, `desc` | `desc` |
| `page` | Integer ≥ 1 | `1` |
| `pageSize` | `10`, `25`, `50` | `10` |

Filters combine with AND. Priority and status sort by their enum declaration order —
severity and lifecycle — not alphabetically. Ticket Number descending is always the
tie-breaker, so paging is stable. A page beyond the last returns `200` with an empty
`items` array and correct totals.

**Success — `200`**

```json
{
  "items": [
    {
      "id": 42,
      "ticketNumber": "TKT-2026-00042",
      "ticketDate": "2026-09-14T09:14:22.518Z",
      "summary": "Cannot connect to Campus Wi-Fi in Building 4",
      "category": { "id": 2, "name": "Network" },
      "requester": { "id": 3, "fullName": "Nadia Rahman", "role": "REQUESTER" },
      "requestedPriority": "HIGH",
      "itPriority": "URGENT",
      "currentStatus": "IN_PROGRESS",
      "owner": { "id": 7, "fullName": "Grace Okafor", "role": "IT_STAFF" },
      "requesterResolvedAt": null,
      "updatedAt": "2026-09-14T10:02:51.004Z"
    }
  ],
  "page": 1, "pageSize": 10, "totalItems": 31, "totalPages": 4
}
```

**Failures:** `400 VALIDATION_FAILED` naming each unrecognised or out-of-range parameter —
never silently ignored (Lab 2 BR-27). `403 FORBIDDEN` for a Requester.

### `GET /api/staff/assignees`

**Roles:** IT Staff, Administrator. **Success — `200`** every active IT Staff and
Administrator as `UserSummary[]`, ordered by name. This is the owner dropdown.

---

## 6. Ticket Workflow

**Roles:** IT Staff, Administrator — `403 FORBIDDEN` for a Requester. Each request carries
the `version` the client last read; each success returns the updated ticket detail (§4)
with `version` incremented (BR-24).

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/tickets/:ticketId/claim` | `{ "version": 4 }` | Caller becomes owner. |
| `PATCH /api/tickets/:ticketId/owner` | `{ "ownerId": 9, "version": 4 }` or `{ "ownerId": null, ... }` | Assign, reassign or unassign. |
| `PATCH /api/tickets/:ticketId/it-priority` | `{ "itPriority": "URGENT", "version": 4 }` | Sets IT Priority only. |
| `POST /api/tickets/:ticketId/status` | `{ "toStatus": "RESOLVED", "version": 4, "resolutionSummary": "..." }` | One transition from BR-29. `resolutionSummary` required for `RESOLVED`; `reason` required for `CANCELLED` and `REOPENED`. |

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Missing or invalid `version`, priority, status, summary or reason. `fieldErrors.ownerId` when the target is not an active IT Staff or Administrator (BR-21). |
| `403` | `FORBIDDEN` | Caller is a Requester. |
| `404` | `TICKET_NOT_FOUND` | No such ticket. |
| `409` | `TICKET_VERSION_CONFLICT` | `version` is stale. The body includes `"ticket"` with the current detail. Nothing changes. |
| `409` | `TICKET_ALREADY_ASSIGNED` | Claim on a ticket that has an owner. |
| `409` | `INVALID_STATUS_TRANSITION` | The pair is not in BR-29, including a status to itself. |
| `409` | `OWNER_REQUIRED` | Entering `IN_PROGRESS`, `WAITING_FOR_REQUESTER` or `RESOLVED` with no owner (BR-28). |
| `409` | `TICKET_TERMINAL` | The ticket is `CLOSED` or `CANCELLED` (BR-27). |

A status change that requires a summary or reason also creates the Public Comment described
in BR-30, in the same transaction.

---

## 7. Comments, Notes and Resolution Indication

### Public Comments

`GET /api/tickets/:ticketId/comments` and `POST /api/tickets/:ticketId/comments`

**Roles:** the owning Requester (another Requester gets `404 TICKET_NOT_FOUND`), IT Staff,
Administrator.

**Request** `{ "content": "Thank you — I have restarted the laptop as suggested." }`

**Success** `201` for a post, `200` for a read, newest first:

```json
{ "id": 88, "ticketId": 42,
  "author": { "id": 3, "fullName": "Nadia Rahman", "role": "REQUESTER" },
  "content": "Thank you — I have restarted the laptop as suggested.",
  "statusChangedTo": null,
  "createdAt": "2026-09-14T10:30:02.117Z" }
```

`statusChangedTo` is set on comments created by a status change (BR-30).

### Internal Notes

`GET /api/tickets/:ticketId/internal-notes` and `POST /api/tickets/:ticketId/internal-notes`

**Roles:** IT Staff and Administrator only. **A Requester receives `403 FORBIDDEN` before
the ticket is looked up**, with no content and the same response whether or not the ticket
exists (BR-35). Request and response shapes match Public Comments without
`statusChangedTo`.

### Failures for both

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Content missing, only whitespace, or over 2000 characters after trimming. |
| `403` | `FORBIDDEN` | Internal Notes requested by a Requester. |
| `404` | `TICKET_NOT_FOUND` | No such ticket, or another Requester's. |
| `409` | `TICKET_TERMINAL` | Posting on a closed or cancelled ticket. Reading still works. |

No `PUT`, `PATCH` or `DELETE` route exists for either; such a request answers `404`
(BR-37).

### `POST /api/tickets/:ticketId/resolution-indication`

**Roles:** the owning Requester only; IT Staff and Administrators get `403`, another
Requester `404`. No body.

**Success — `200`** the ticket detail with `requesterResolvedAt` set. Repeating it returns
the same timestamp and changes nothing.

**Failures:** `409 INDICATION_NOT_ALLOWED` when the ticket is `RESOLVED`;
`409 TICKET_TERMINAL` when it is closed or cancelled.

---

## 8. Administrator User Management

**Roles:** Administrator only. IT Staff and Requesters receive `403 FORBIDDEN` before any
lookup.

```jsonc
// AdminUser
{ "id": 9, "fullName": "Arthit Chaiyaporn", "email": "arthit.chaiyaporn@toktickit.local",
  "role": "IT_STAFF", "isActive": true, "mustChangePassword": false,
  "createdAt": "...", "updatedAt": "..." }
```

| Endpoint | Request | Success |
|---|---|---|
| `GET /api/admin/users?search=&role=` | `search`: 1–100 characters, matched case-insensitively against name or email. `role`: one of the three roles. Both optional. | `200` `{ "items": AdminUser[] }` ordered by name then id. Not paginated (BR-38). |
| `POST /api/admin/users` | `{ fullName, email, role, isActive, initialPassword }` | `201` `AdminUser` with `mustChangePassword: true`. |
| `PATCH /api/admin/users/:userId` | Any of `{ fullName, email, role, isActive }` | `200` `{ "user": AdminUser, "unassignedTicketCount": 3 }` |
| `POST /api/admin/users/:userId/initial-password` | `{ initialPassword }` | `200` `AdminUser` with `mustChangePassword: true`. The password is never echoed. |

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Name, email, role, activation state or password invalid; an unrecognised `role` filter. |
| `403` | `FORBIDDEN` | Caller is not an Administrator. |
| `404` | `USER_NOT_FOUND` | No such user. |
| `409` | `EMAIL_ALREADY_EXISTS` | Another user has this email after normalisation. |
| `409` | `CANNOT_DEACTIVATE_SELF` | An Administrator deactivating their own account. |
| `409` | `CANNOT_CHANGE_OWN_ROLE` | An Administrator changing their own role. |
| `409` | `LAST_ACTIVE_ADMINISTRATOR` | The change would leave no active Administrator (BR-42). |

Changing a role, deactivating, or setting an initial password deletes all of that user's
sessions (BR-15). Deactivating a user, or changing their role to `REQUESTER`, unassigns
their non-terminal tickets in the same transaction (BR-25). No endpoint deletes a user.

---

## 9. Status and Error Code Summary

| Status | Codes |
|---|---|
| `200` | Retrieval, idempotent replay, workflow change, repeated indication |
| `201` | Ticket, attachment, comment, note or user created |
| `204` | Logout |
| `400` | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED` |
| `401` | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| `403` | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_INACTIVE`, `ORIGIN_REJECTED` |
| `404` | `TICKET_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `REFERENCE_NOT_FOUND`, `USER_NOT_FOUND` |
| `409` | `IDEMPOTENCY_KEY_CONFLICT`, `ATTACHMENT_LIMIT_REACHED`, `ATTACHMENT_ALREADY_REMOVED`, `TICKET_VERSION_CONFLICT`, `TICKET_ALREADY_ASSIGNED`, `INVALID_STATUS_TRANSITION`, `OWNER_REQUIRED`, `TICKET_TERMINAL`, `INDICATION_NOT_ALLOWED`, `EMAIL_ALREADY_EXISTS`, `CANNOT_DEACTIVATE_SELF`, `CANNOT_CHANGE_OWN_ROLE`, `LAST_ACTIVE_ADMINISTRATOR` |
| `413` | `ATTACHMENT_TOO_LARGE` |
| `415` | `ATTACHMENT_TYPE_NOT_ALLOWED` |
| `429` | `LOGIN_THROTTLED` |
| `500` | `INTERNAL_ERROR` |
| `503` | `DEPENDENCY_UNAVAILABLE` |

`REQUESTER_CONTEXT_REQUIRED` (Lab 2) is retired.

---

## 10. Capability Coverage

Every capability required by labsheet §6:

| Required capability | Endpoint |
|---|---|
| Login, logout, current user, mandatory password change | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Authenticated Lab 2 Requester Ticket and Attachment APIs | §4 |
| IT Staff Ticket Queue with search, filters, sorting, pagination | `GET /api/staff/tickets` |
| Retrieve one Ticket for IT Staff operations | `GET /api/tickets/:ticketId` |
| Claim, assign or reassign ownership | `POST /api/tickets/:ticketId/claim`, `PATCH /api/tickets/:ticketId/owner`, `GET /api/staff/assignees` |
| Update IT Priority and permitted status | `PATCH /api/tickets/:ticketId/it-priority`, `POST /api/tickets/:ticketId/status` |
| Create and retrieve Public Comments | `GET`/`POST /api/tickets/:ticketId/comments` |
| Create and retrieve Internal Notes, permitted roles only | `GET`/`POST /api/tickets/:ticketId/internal-notes` |
| User list with name/email search and optional role filter | `GET /api/admin/users` |
| Create a user with one permitted role | `POST /api/admin/users` |
| Update name, email, role and activation state | `PATCH /api/admin/users/:userId` |
| Set a new initial password, changed at next login | `POST /api/admin/users/:userId/initial-password` |
| Requester indicates the problem appears resolved | `POST /api/tickets/:ticketId/resolution-indication` |
