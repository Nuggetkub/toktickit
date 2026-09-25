# Lab 4 REST API Contract

**Status:** Draft for peer review
**Base path:** `/api`
**Companion documents:** [`specification.md`](./specification.md) ·
[Lab 3 API contract](../lab-03/api-spec.md) · [Lab 2 API contract](../lab-02/api-spec.md)

Every Lab 2 and Lab 3 endpoint, payload and error not mentioned here is unchanged. This
document defines what Lab 4 adds or alters.

---

## 1. Conventions

These carry over from Lab 3 §1 unchanged:

- the session cookie;
- the `Origin` check on state-changing requests;
- the error envelope `{ "error": { "code", "message", "fieldErrors"? } }`;
- `400 VALIDATION_FAILED` for every invalid input (`422` is not used);
- unknown body fields are ignored;
- `404` for another Requester's Ticket, identical to a missing one.

The authorization order is Lab 3 §1's, with one step added for Action creation:

| Step | Failure |
|---|---|
| 1. Origin, for state-changing methods | `403 ORIGIN_REJECTED` |
| 2. Valid, unexpired session for an active user | `401 UNAUTHENTICATED` |
| 3. No password change pending | `403 PASSWORD_CHANGE_REQUIRED` |
| 4. Role permitted for the endpoint — **before** any lookup | `403 FORBIDDEN` |
| 5. Ticket, then Action, exists and is visible to this user | `404 TICKET_NOT_FOUND`, `404 ACTION_NOT_FOUND` |
| 5a. *Action create only:* `Idempotency-Key` present; a replay returns the original | `400 IDEMPOTENCY_KEY_REQUIRED`, `409 IDEMPOTENCY_KEY_CONFLICT`, or `200` replay |
| 6. Input valid | `400 VALIDATION_FAILED` |
| 7. State permits the change, decided under the Ticket row lock (BR-14) | `409` with a specific code |

A replay (5a) is answered before validation and before state. A retry of a create that
already succeeded therefore returns the Action even if the Ticket has since been resolved.
The retry is a question about the past request, not a new write.

Step 7's `409`s for an Action write come in this order, so the answer is always the most
useful true one:

1. `TICKET_TERMINAL`
2. `ACTION_NOT_ALLOWED` (Ticket `RESOLVED`)
3. `ACTION_FINAL`
4. `ACTION_VERSION_CONFLICT`

A final Action refuses whatever its version: telling the user to reload would not help.

### Shared shapes

`UserSummary` is Lab 3's `{ "id", "fullName", "role" }`.

```jsonc
// ActionTaken
{
  "id": 17,
  "ticketId": 42,
  "status": "COMPLETED",                        // OPEN | COMPLETED | CANCELLED
  "actionAt": "2026-09-26T03:10:00.000Z",       // Action Date/Time (BR-07)
  "description": "Reset the Wi-Fi profile on the laptop and rejoined Campus Wi-Fi.",
  "result": "Connected at full signal; browsing works.",       // null while OPEN if not given
  "followUpRequired": false,
  "followUpNote": null,                         // non-null exactly when followUpRequired
  "attachmentNotes": "See screenshot wifi-0926.png in Attachments.",   // or null
  "assignee": { "id": 9, "fullName": "Daniel Reyes", "role": "IT_STAFF" },  // null only after BR-17
  "performedBy": { "id": 9, "fullName": "Daniel Reyes", "role": "IT_STAFF" }, // null unless COMPLETED
  "completedAt": "2026-09-26T03:12:41.118Z",    // null unless COMPLETED
  "cancelledBy": null,                          // UserSummary when CANCELLED
  "cancelledAt": null,
  "cancellationReason": null,
  "createdBy": { "id": 7, "fullName": "Grace Okafor", "role": "IT_STAFF" },  // Recorded by
  "createdAt": "2026-09-26T03:12:41.118Z",      // Recorded At
  "updatedAt": "2026-09-26T03:12:41.118Z",
  "version": 1
}
```

The same shape goes to every permitted role. The owning Requester sees every field (BR-16,
D-04).

---

## 2. Actions Taken

### `GET /api/tickets/:ticketId/actions`

**Roles:** the owning Requester (another Requester gets `404 TICKET_NOT_FOUND`), IT Staff,
Administrator.

**Success — `200`** `{ "items": ActionTaken[] }`, ordered by `actionAt` newest first, then
`id` descending (BR-11). The list is not paginated, and an empty list is `{ "items": [] }`.

### `POST /api/tickets/:ticketId/actions`

**Roles:** IT Staff, Administrator. **Headers:** `Idempotency-Key`, a client-generated UUID
(BR-15).

**Request**

```json
{
  "status": "OPEN",
  "actionAt": "2026-09-27T02:00:00.000Z",
  "description": "Replace the access point in Building 4, room 402.",
  "result": null,
  "followUpRequired": false,
  "followUpNote": null,
  "attachmentNotes": null,
  "assigneeId": 9
}
```

| Field | Rule |
|---|---|
| `status` | `OPEN` or `COMPLETED`. `CANCELLED` is refused: nothing is created cancelled. |
| `actionAt` | ISO 8601 with offset. Not before the Ticket's creation. If `COMPLETED`, not more than 5 minutes after now. If `OPEN`, not more than 365 days after now (BR-07). |
| `description` | 5–2000 characters after trimming. |
| `result` | Required for `COMPLETED`: 5–2000 after trimming. Optional for `OPEN`: at most 2000, and empty becomes `null`. |
| `followUpRequired` | Boolean, required. |
| `followUpNote` | Required when `followUpRequired` is true: 5–1000 after trimming. When false it must be absent, `null` or empty, and anything else is a field error (BR-09). |
| `attachmentNotes` | Optional, at most 500 characters. Empty becomes `null`. |
| `assigneeId` | Required. The id of an active `IT_STAFF` or `ADMINISTRATOR` user. Anyone else is a field error on `assigneeId` (BR-06). |

**Success — `201`** `ActionTaken`. `createdBy` is the caller. For `COMPLETED`, `performedBy`
is the caller and `completedAt` is now (BR-05). The Ticket's `updatedAt` moves and its
`version` does not (BR-13).

**Replay — `200`** the originally created `ActionTaken`, when the key was used before with an
identical payload.

| Status | `code` | When |
|---|---|---|
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | The header is missing or is not a UUID. |
| `400` | `VALIDATION_FAILED` | `fieldErrors` names **every** failing field, not just the first. |
| `403` | `FORBIDDEN` | Caller is a Requester. |
| `404` | `TICKET_NOT_FOUND` | No such Ticket. |
| `409` | `IDEMPOTENCY_KEY_CONFLICT` | The key was used with a different payload. Nothing is created. |
| `409` | `TICKET_TERMINAL` | The Ticket is `CLOSED` or `CANCELLED`. |
| `409` | `ACTION_NOT_ALLOWED` | The Ticket is `RESOLVED`: "Reopen the ticket to record more work." (BR-12). |

### `PATCH /api/tickets/:ticketId/actions/:actionId`

**Roles:** IT Staff, Administrator. Edits an **open** Action (BR-08).

**Request** is `version` plus any of `actionAt`, `description`, `result`, `followUpRequired`,
`followUpNote`, `attachmentNotes` and `assigneeId`, each with its rule from the create table
(read with `status` = `OPEN`). The request must contain at least one of them. An Action whose
assignee was cleared by BR-17 must receive an `assigneeId` in its first edit.

**Success — `200`** `ActionTaken` with `version` incremented.

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Missing `version`, no editable field, or any field rule broken. |
| `403` | `FORBIDDEN` | Caller is a Requester. |
| `404` | `TICKET_NOT_FOUND` / `ACTION_NOT_FOUND` | No such Ticket, or no such Action **on this Ticket**. |
| `409` | `TICKET_TERMINAL` / `ACTION_NOT_ALLOWED` | As for create. |
| `409` | `ACTION_FINAL` | The Action is `COMPLETED` or `CANCELLED`. |
| `409` | `ACTION_VERSION_CONFLICT` | `version` is stale. The error carries `"action"` with the current Action. Nothing changes. |

### `POST /api/tickets/:ticketId/actions/:actionId/complete`

**Roles:** IT Staff, Administrator.

**Request** `{ "version": 2, "result": "...", "followUpRequired": false, "followUpNote": null, "actionAt": "..." }`.
`result` is required (5–2000). `followUpRequired`, `followUpNote` and `actionAt` are
optional, and each keeps its stored value when absent. If the stored `actionAt` is more than
5 minutes in the future, as a planned Action's may be, the request must supply an `actionAt`
that satisfies BR-07 for a completed Action. Otherwise it's a field error.

**Success — `200`** `ActionTaken`, now `COMPLETED`, with `performedBy` the caller and
`completedAt` now (BR-05). Failures are as for `PATCH`.

### `POST /api/tickets/:ticketId/actions/:actionId/cancel`

**Roles:** IT Staff, Administrator.

**Request** `{ "version": 2, "reason": "Duplicate of action 15." }`, where `reason` is 5–500
characters after trimming.

**Success — `200`** `ActionTaken`, now `CANCELLED`, with `cancelledBy`, `cancelledAt` and
`cancellationReason` set, and `performedBy` still `null`. Failures are as for `PATCH`.

No endpoint deletes an Action. `DELETE` on any Action path answers `404`, as it does for
comments.

---

## 3. Status History

### `GET /api/tickets/:ticketId/history`

**Roles:** the owning Requester (another Requester gets `404`), IT Staff, Administrator.

**Success — `200`**

```json
{
  "items": [
    { "id": 301, "fromStatus": null, "toStatus": "NEW",
      "actor": { "id": 3, "fullName": "Nadia Rahman", "role": "REQUESTER" },
      "createdAt": "2026-09-26T01:00:00.000Z" },
    { "id": 305, "fromStatus": "NEW", "toStatus": "OPEN",
      "actor": { "id": 7, "fullName": "Grace Okafor", "role": "IT_STAFF" },
      "createdAt": "2026-09-26T01:20:00.000Z" }
  ],
  "recordedFromCreation": true
}
```

- Order: `createdAt` oldest first, then `id` (BR-23).
- `recordedFromCreation` is `false` for a Ticket that existed before the migration, whose
  first event (if any) is not its creation. The interface then says earlier changes were not
  recorded (BR-24).
- History is append-only: there is no write endpoint, and `POST`, `PATCH`, `PUT` and `DELETE`
  on the path answer `404`.

---

## 4. Ticket Detail and Status Change

### `GET /api/tickets/:ticketId` — added field

Every role that can read the Ticket receives the Lab 3 shape plus:

```json
"resolutionGate": {
  "openActions": 1,
  "completedActions": 2,
  "latestFollowUpRequired": false,
  "ready": false
}
```

`ready` is true exactly when BR-19's three conditions hold now. It is advice for the screen.
The status change re-decides under the lock.

### `POST /api/tickets/:ticketId/status` — added refusal and cascade

The body and every Lab 3 answer are unchanged. The gate is decided **after** every Lab 3
check, so a Ticket that Lab 3 would refuse is refused for the same reason as before:

| Status | `code` | When |
|---|---|---|
| `409` | `RESOLUTION_BLOCKED` | `toStatus` is `RESOLVED` and BR-19 fails. Nothing changes. |

```json
{ "error": { "code": "RESOLUTION_BLOCKED",
  "message": "This ticket cannot be resolved until its actions are finished.",
  "unmet": [
    { "condition": "OPEN_ACTIONS", "count": 1 },
    { "condition": "FOLLOW_UP_REQUIRED", "actionId": 17 }
  ] } }
```

`unmet` lists **every** failed condition, in the order `OPEN_ACTIONS`,
`NO_COMPLETED_ACTION`, `FOLLOW_UP_REQUIRED`. `NO_COMPLETED_ACTION` and `FOLLOW_UP_REQUIRED`
are never both present.

The route now takes the Ticket row lock before deciding (BR-14). Every successful change
appends a Status Event in the same transaction (BR-22). Entering `CANCELLED` also cancels
every `OPEN` Action, with the Ticket's `reason` and the caller (BR-20).

---

## 5. List Filters

`currentStatus` on `GET /api/tickets` (My Tickets) and on `GET /api/staff/tickets` (Queue)
accepts one status or a comma-separated list, such as
`currentStatus=NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED` (BR-30).

- Each member must be one of the eight statuses and appear once. Otherwise:
  `400 VALIDATION_FAILED` with `fieldErrors.currentStatus`.
- An empty value (`currentStatus=`) is an error, not "no filter".
- A single value behaves exactly as in Lab 3, so every Lab 3 queue test is unchanged.

On My Tickets this replaces the Lab 2/3 refusal ("Current Status filtering arrives in
Lab 3"). That half is issue #78.

---

## 6. Dashboards

Both endpoints are `GET`, take **no** query parameters (any parameter is
`400 VALIDATION_FAILED`), and read one `REPEATABLE READ` snapshot (BR-25).

- Each card is `{ "value": <integer>, "query": <object or null> }`. The `query` holds the
  exact list parameters for that card's drill-down, so the client builds its link from the
  server rather than from a second copy of the rules.
- Lists are `{ "total": <integer>, "items": [...] }`, capped as stated.
- `windowStart` is the start of the 168-hour window used by the time-based metrics.

### `GET /api/dashboard/requester`

**Roles:** Requester. IT Staff and Administrators get `403 FORBIDDEN` (BR-29).

```jsonc
{
  "generatedAt": "2026-09-26T04:00:00.000Z",
  "windowStart": "2026-09-19T04:00:00.000Z",
  "cards": {
    "activeTickets":           { "value": 3, "query": { "currentStatus": "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED" } },
    "waitingForMe":            { "value": 1, "query": { "currentStatus": "WAITING_FOR_REQUESTER" } },
    "resolvedAwaitingClosure": { "value": 2, "query": { "currentStatus": "RESOLVED" } },
    "resolvedLast7Days":       { "value": 1, "query": null }
  },
  "lists": {
    "needsAttention":   { "total": 3, "items": [ RequesterTicketCard ] },   // cap 5
    "recentlyUpdated":  { "total": 9, "items": [ RequesterTicketCard ] },   // cap 5
    "recentlyResolved": { "total": 1, "items": [ RequesterTicketCard & { "resolvedAt": "..." } ] }  // cap 5
  }
}
```

`RequesterTicketCard` is
`{ "id", "ticketNumber", "summary", "currentStatus", "requestedPriority", "updatedAt" }`.

| Card | Calculation (always `requesterId` = caller) | Drill-down target |
|---|---|---|
| `activeTickets` (R-1) | `currentStatus` in the five active statuses | `/tickets?<query>` |
| `waitingForMe` (R-2) | `currentStatus = WAITING_FOR_REQUESTER` | `/tickets?<query>` |
| `resolvedAwaitingClosure` (R-3) | `currentStatus = RESOLVED` | `/tickets?<query>` |
| `resolvedLast7Days` (R-4) | distinct Tickets with a Status Event `toStatus = RESOLVED` and `createdAt >= windowStart` | the `recentlyResolved` list on the page |

| List | Rows and order |
|---|---|
| `needsAttention` | `WAITING_FOR_REQUESTER` rows, then `RESOLVED` rows; each group by `updatedAt` desc, then `id` desc |
| `recentlyUpdated` | all own Tickets by `updatedAt` desc, then `id` desc |
| `recentlyResolved` | own Tickets whose **latest** event into `RESOLVED` has `createdAt >= windowStart`, by that event desc, then Ticket `id` desc; `resolvedAt` is that event's time |

### `GET /api/dashboard/staff`

**Roles:** IT Staff, Administrator. A Requester gets `403 FORBIDDEN`.

```jsonc
{
  "generatedAt": "...",
  "windowStart": "...",
  "cards": {
    "unassignedActive":   { "value": 4, "query": { "owner": "unassigned", "currentStatus": "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED" } },
    "myActive":           { "value": 6, "query": { "owner": "me", "currentStatus": "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED" } },
    "myOpenActions":      { "value": 2, "query": null },
    "requesterIndicated": { "value": 1, "query": { "requesterIndicated": "true", "currentStatus": "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED" } }
  },
  "byStatus": {                     // all eight keys, always present, zeros included
    "NEW": { "value": 5, "query": { "currentStatus": "NEW" } }
    // ... OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER, RESOLVED, CLOSED, REOPENED, CANCELLED
  },
  "activeByItPriority": {           // all four keys, always present
    "URGENT": { "value": 2, "query": { "itPriority": "URGENT", "currentStatus": "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED" } }
    // ... HIGH, MEDIUM, LOW
  },
  "lists": {
    "myOpenActions":   { "total": 2,  "items": [ { "actionId", "ticketId", "ticketNumber", "summary", "actionAt", "description" } ] },  // cap 10
    "urgentActive":    { "total": 2,  "items": [ StaffTicketCard ] },   // cap 5
    "recentlyUpdated": { "total": 38, "items": [ StaffTicketCard ] }    // cap 10
  },
  "users": {                        // ADMINISTRATOR only; absent for IT Staff (BR-28)
    "REQUESTER":     { "active": 5, "inactive": 1, "query": { "role": "REQUESTER" } },
    "IT_STAFF":      { "active": 3, "inactive": 1, "query": { "role": "IT_STAFF" } },
    "ADMINISTRATOR": { "active": 1, "inactive": 0, "query": { "role": "ADMINISTRATOR" } }
  }
}
```

`StaffTicketCard` is `{ "id", "ticketNumber", "summary", "currentStatus", "itPriority",
"owner": UserSummary | null, "updatedAt" }`.

| Card or list | Calculation | Drill-down target |
|---|---|---|
| `unassignedActive` (S-1) | `ownerId IS NULL` and active | `/queue?<query>` |
| `myActive` (S-2) | `ownerId` = caller and active | `/queue?<query>` |
| `myOpenActions` (S-3) | Actions `status = OPEN` and `assigneeId` = caller | each list row opens `/queue/:ticketId` |
| `requesterIndicated` (S-4) | `requesterResolvedAt IS NOT NULL` and active | `/queue?<query>` |
| `byStatus.*` (S-5) | `currentStatus` = key | `/queue?<query>` |
| `activeByItPriority.*` (S-6) | `itPriority` = key and active | `/queue?<query>` |
| `myOpenActions` list | S-3's Actions by `actionAt` asc, then `id` asc | row opens `/queue/:ticketId` |
| `urgentActive` list | active and `itPriority = URGENT`, by `updatedAt` asc, then `id` asc | row opens `/queue/:ticketId` |
| `recentlyUpdated` list | all Tickets by `updatedAt` desc, then `id` desc | row opens `/queue/:ticketId` |
| `users.*` (Administrator) | `User` counts by `role` and `isActive` | `/users?role=<role>` |

**Invariants the API test asserts, not assumes:**

- Every card's `query`, sent to the list endpoint as the same user, returns `totalItems`
  equal to the card's `value` (BR-30).
- `byStatus` sums to the total number of Tickets.
- No Action counted by S-3 belongs to a non-active Ticket (BR-27).

### Failures for both

| Status | `code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Any query parameter. |
| `401` / `403` | per §1 | No session, a pending password change, or the wrong role. |
| `503` | `DEPENDENCY_UNAVAILABLE` | The database is unreachable. Nothing partial is returned. |

---

## 7. Administrator User Management — altered response

`PATCH /api/admin/users/:userId` adds `unassignedActionCount` beside the existing
`unassignedTicketCount`. Both are `0` for an edit that neither deactivates nor demotes
(BR-17).

---

## 8. Status and Error Code Summary — Lab 4 additions

| Status | `code` | Endpoints |
|---|---|---|
| `200` | — | Action create replay, and every read |
| `201` | — | Action create |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Action create |
| `400` | `VALIDATION_FAILED` | every Lab 4 write, the list filters, the dashboards |
| `404` | `ACTION_NOT_FOUND` | Action edit, complete and cancel |
| `409` | `IDEMPOTENCY_KEY_CONFLICT` | Action create |
| `409` | `ACTION_NOT_ALLOWED` | Action writes on a `RESOLVED` Ticket |
| `409` | `ACTION_FINAL` | edit, complete or cancel of a final Action |
| `409` | `ACTION_VERSION_CONFLICT` | edit, complete, cancel |
| `409` | `RESOLUTION_BLOCKED` | status change to `RESOLVED` |

Every other code keeps its Lab 2 or Lab 3 meaning. No existing code is renamed.

---

## 9. Capability Coverage

| Labsheet §6 capability | Where |
|---|---|
| Create and update Actions Taken as permitted | §2 |
| Retrieve Requester dashboard data | §6 `GET /api/dashboard/requester` |
| Retrieve IT Staff dashboard data | §6 `GET /api/dashboard/staff` |
| Continue all approved APIs from Labs 2 and 3 | §1, §4, §5, §7 — altered only by addition |
| Final health, validation and regression behaviour | `GET /api/health` unchanged; §1's order; §8 |
| §6.1 Resolution and conflict behaviour | §2 versions, §4 gate under the row lock |
| §6.2 Dashboard contract | §6: calculations, window, drill-down queries, empty values |
