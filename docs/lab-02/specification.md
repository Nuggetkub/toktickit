# Lab 2 Sprint Engineering Specification

**Status:** Draft for peer review
**Issue:** [#17 Sprint specification and test plan](https://github.com/Nuggetkub/toktickit/issues/17)
**Branch:** `feature/17-engineering-contract`
**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub
**Peer reviewer:** Pattharapon Kijjanukij — 67070501069 — @Earth2509

This document is the engineering contract for Sprint 2. It is written before
implementation and updated through the sprint. The coding agent may report a feature
"done" only when the contract is satisfied and the required tests pass.

---

## 1. Sprint Goal

Deliver the Requester-facing half of TokTickIT: a person picked from a temporary
Development Requester selector can raise an IT support ticket, receive an official
backend-generated Ticket Number, attach supporting evidence, find their own tickets
again through search, filtering, sorting and paging, open a read-only Ticket Detail
screen, and manage the attachments on their own tickets. Every screen is built from one
reusable Zen Green component set that later labs extend rather than replace.

## 2. Stakeholder Request Interpretation

The stakeholder asked for a professional, responsive ticketing experience for end users,
with a temporary way to choose "who is logged in" until real authentication arrives in
Lab 3. Four things in that request are load-bearing and are treated as requirements
rather than preferences:

1. **The system generates the official Ticket Number**, not the browser. The number is
   the record's public identity, so it must be produced server-side and be unique.
2. **One Requester must not see another Requester's ticket.** The selector is a testing
   convenience and is trivially forgeable, so ownership is enforced on the server for
   every requester-scoped operation. The client-side selection is never trusted.
3. **Attachments have a lifecycle, not just an upload.** Evidence must be addable to an
   existing ticket, downloadable while active, and removable in a way that preserves the
   audit trail — which is why removal is soft and requires a reason.
4. **The Zen Green conventions are an asset for later labs.** Form, list, badge,
   validation, loading, empty, error and responsive behaviour are specified once here so
   that Lab 3's IT Staff screens inherit them.

The request is deliberately incomplete on validation limits, query semantics, storage
strategy and failure behaviour. Those gaps are resolved in this document and recorded in
§11.

## 3. Scope

### Included

- Development Requester selection, switching, display, and the guarded routes behind it.
- Create Ticket: reference data, validation, submission, official Ticket Number, and the
  full set of loading, success and failure states.
- My Tickets: requester-scoped list with search, filters, sorting, pagination, and
  distinct empty and no-results states.
- Requester Ticket Detail in read-only view mode.
- Attachment lifecycle: upload, metadata, download, and soft removal with a reason.
- PostgreSQL and Prisma models, one migration, and a repeatable seed.
- REST API covering the ten required capabilities.
- Automated unit, API, UI component, UI style, responsive and end-to-end tests.
- The Zen Green visual specification and its inspection checklist.

### Excluded

Deferred to Lab 3 or later, and deliberately absent from this sprint:

- Real authentication: login, logout, passwords, password hashing, sessions, tokens,
  authenticated identity, and role-based authorization. **The Development Requester
  selector is a testing mechanism and is not security.**
- IT Staff workflow: staff dashboard and queue, claiming or reassigning tickets, setting
  IT Priority, and any other ticket-owner function.
- Ticket collaboration: Public Comments, Internal Notes, and Actions Taken.
- Ticket lifecycle after creation: any status change beyond the initial `NEW`, including
  resolution confirmation, resolving, closing, reopening and cancelling.
- Administration: management of users, requesters, roles, or reference data.

## 4. Functional Requirements

- **FR-01** The system shall list active Development Requesters for selection and shall
  exclude inactive ones.
- **FR-02** The system shall require a selected Development Requester before any
  requester-scoped screen can be used, and shall return an unselected visitor to the
  selector.
- **FR-03** The application shell shall display the selected Requester and shall provide
  a Change Requester action that clears requester-scoped state.
- **FR-04** The Create Ticket screen shall load active Categories and active Related
  Systems from the backend.
- **FR-05** The backend shall validate a submitted ticket, persist exactly one Ticket for
  the selected Requester, generate its official Ticket Number, and return the saved
  record.
- **FR-06** The system shall prevent a repeated submission of the same ticket from
  creating a duplicate.
- **FR-07** The My Tickets screen shall list only tickets owned by the selected Requester
  and shall support search, filtering, sorting and pagination.
- **FR-08** The Ticket Detail screen shall display one owned ticket read-only, and shall
  refuse a ticket owned by anyone else.
- **FR-09** A Requester shall add a permitted attachment to a ticket they own.
- **FR-10** A Requester shall download an active attachment on a ticket they own.
- **FR-11** A Requester shall soft-remove an active attachment on a ticket they own,
  supplying a removal reason.
- **FR-12** The interface shall present explicit loading, validation, submitting, success,
  empty, no-results and safe-failure states at desktop, tablet and mobile widths.

## 5. Business Rules

### Ticket identity and defaults

- **BR-01** The official Ticket Number is generated by the backend and is unique across
  the system. The client never supplies or predicts it.
- **BR-02** The Ticket Number format is `TKT-<YYYY>-<NNNNN>`, where `<YYYY>` is the
  creation year and `<NNNNN>` is a zero-padded per-year sequence, for example
  `TKT-2026-00042`.
- **BR-03** A new Ticket begins with Current Status `NEW`. Lab 2 exposes no transition
  away from `NEW`.
- **BR-04** Ticket Date is the server-assigned creation timestamp. It is read-only and is
  displayed on Create Ticket after a successful save and on Ticket Detail.

### Requester selection and ownership

- **BR-05** Lab 2 uses a Development Requester selector in place of login. The selected
  identity is a testing context and is **not** authentication.
- **BR-06** Only active Requesters appear in the selector. An inactive Requester cannot be
  selected and cannot become the active context.
- **BR-07** The browser stores only the selected Requester's identifier. No credential,
  token, or password is stored, because none exists in this sprint.
- **BR-08** Every requester-scoped API request carries the selected Requester in the
  `X-Dev-Requester-Id` request header. The server resolves and validates it on every such
  request; the client's claim is never trusted on its own.
- **BR-09** A Ticket belongs to exactly one Requester, fixed at creation and never
  reassigned in Lab 2.
- **BR-10** A request for a Ticket or Attachment owned by a different Requester is
  answered as **not found**, not as forbidden, so that the response does not confirm the
  resource exists.
- **BR-11** Changing Requester clears requester-scoped client state — list filters, paging
  and any cached ticket — before the replacement context loads.

### Validation

- **BR-12** Ticket Summary is required. It is trimmed before validation and must be 5 to
  120 characters after trimming. The limit keeps a summary readable as one line in the My
  Tickets table at tablet width.
- **BR-13** Description is required. It is trimmed before validation and must be 20 to
  4000 characters after trimming. The lower bound exists because a one-word description
  cannot be actioned by IT staff in Lab 3.
- **BR-14** Requested Priority is required and must be one of `LOW`, `MEDIUM`, `HIGH`,
  `URGENT`.
- **BR-15** Category and Related System are required, must exist, and must be active at
  the moment of creation.
- **BR-16** Validation runs on both the client and the server. The client provides
  immediate field-level feedback; the server re-validates every rule and is the authority,
  because the client can be bypassed.
- **BR-17** A validation failure creates nothing, returns field-level errors keyed by
  field name, and leaves the submitted values intact in the form.

### Duplicate submission

- **BR-18** The submit control is disabled while a submission is in flight.
- **BR-19** Every create request carries an `Idempotency-Key` header holding a
  client-generated UUID. Replaying that key with an identical ticket payload returns the
  originally created Ticket and creates nothing further. Replaying it with a different
  payload is a conflict and creates nothing.
- **BR-20** The Ticket row and its official number are written in one database
  transaction. A failure rolls back both, so a number is never consumed by a ticket that
  does not exist.

### Search, filtering, sorting and pagination

- **BR-21** My Tickets is scoped to the selected Requester before any other filter is
  applied.
- **BR-22** Search matches Ticket Number and Ticket Summary, case-insensitively, on a
  trimmed substring.
- **BR-23** Filters are exact matches on Category, Related System and Requested Priority.
- **BR-24** Sorting is permitted on Ticket Date, Ticket Number and Requested Priority. The
  default is Ticket Date descending, with Ticket Number descending as the tie-breaker so
  that ordering is stable across pages.
- **BR-25** Requested Priority is a Postgres enum declared in severity order `LOW`,
  `MEDIUM`, `HIGH`, `URGENT`. Ascending sort therefore runs least to most severe rather
  than alphabetically.
- **BR-26** Pages are numbered from 1. Permitted page sizes are 10, 25 and 50; the default
  is 10. An out-of-range page returns an empty result set rather than an error.
- **BR-27** An unrecognised sort field, sort direction, page size, or filter value is
  rejected with a field-level error rather than silently ignored, so that a typo in a
  query cannot masquerade as a legitimate empty result.
- **BR-28** The list response carries `page`, `pageSize`, `totalItems` and `totalPages`
  alongside the items.
- **BR-29** The interface distinguishes an **empty** list — this Requester owns no tickets
  — from **no results** — a search or filter matched nothing. They carry different
  explanations and different recovery actions.
- **BR-30** Current Status is not offered as a filter in Lab 2. Every ticket in this
  sprint is `NEW`, so the control could never change a result set; it is introduced in
  Lab 3 with the statuses that make it meaningful.

### Attachments

- **BR-31** Permitted attachment types are JPEG, PNG, WEBP and PDF. The server determines
  the type from the file's own content, not from its filename extension.
- **BR-32** Each attachment must not exceed 5 MB.
- **BR-33** A Ticket may hold at most five **active** attachments. Soft-removed
  attachments do not count toward the limit.
- **BR-34** Attachments are uploaded to a Ticket that already exists. Ticket creation and
  attachment upload are separate operations, so an upload failure never costs the user a
  valid ticket.
- **BR-35** Stored attachments are written under a server-generated storage key. The
  original filename is display and download metadata only and is never used to build a
  server path.
- **BR-36** A failed upload stores no metadata row, leaves the ticket and its other
  attachments untouched, and reports which file failed and why.
- **BR-37** Removal is soft. It records the removal timestamp, the removing Requester and
  a removal reason, and it never deletes the metadata row.
- **BR-38** The removal reason is required, trimmed, and must be 5 to 250 characters.
- **BR-39** A removed attachment remains visible in Ticket Detail as metadata marked
  Removed, and cannot be downloaded or previewed by anyone.
- **BR-40** Only the owner of a Ticket may upload to it, download from it, or remove its
  attachments.

### Failure behaviour

- **BR-41** An unexpected server error returns a safe message with no stack trace, SQL, or
  internal path.
- **BR-42** A failed request never discards what the user typed. Create Ticket keeps its
  field values and the user can retry without re-entering them.
- **BR-43** Raw browser network errors — for example `TypeError: Failed to fetch` — are
  translated at the API client boundary into a human message before they reach the
  interface.

### Transition to Lab 3

- **BR-44** The `X-Dev-Requester-Id` header is the single seam where identity enters the
  system. In Lab 3 it is replaced by an authenticated identity resolved from a session or
  token, and no endpoint path, payload, or ownership rule needs to change.
- **BR-45** The Ticket-to-Requester ownership relationship persists unchanged into Lab 3;
  the authenticated user becomes the Requester rather than replacing the concept.

## 6. UI Specification Summary

The full visual contract is in [`ui-spec.md`](./ui-spec.md). In summary: the Zen Green
palette is fixed by the labsheet — primary `#006B3C`, secondary `#0B7A46`, pale
`#EAF6EF`, page background `#F5F7F6`, white surfaces, dark charcoal-green text, dark red
errors, amber warnings. Labels sit above their controls, required fields carry an
asterisk, and validation messages appear directly beneath the field they concern rather
than as a single message at the top of the form. Read-only fields are visually distinct
from editable ones. Buttons always carry text, and every state — primary, secondary,
tertiary, destructive, disabled, busy — is defined once and reused. Loading and success
are announced through `role="status"`; actionable failures use `role="alert"`. Layout is
multi-column at 992 px and wider, two-column where practical from 768 to 991 px, and
stacked below 768 px with no page-level horizontal scrolling.

## 7. Data Changes

### Models

| Model | Fields | Notes |
|---|---|---|
| `Requester` | `id`, `fullName`, `email` (unique), `isActive`, `createdAt`, `updatedAt` | Owns tickets. The persistent identity that Lab 3 authentication will attach to. |
| `Category` | existing `id`, `name` (unique), `createdAt`; **add** `isActive` | Lab 1 model, extended so retrieval can be limited to active rows. |
| `RelatedSystem` | `id`, `name` (unique), `isActive`, `createdAt`, `updatedAt` | The specific service, application or device a ticket concerns. |
| `Ticket` | `id`, `ticketNumber` (unique), `requesterId`, `categoryId`, `relatedSystemId`, `summary`, `description`, `requestedPriority`, `currentStatus`, `idempotencyKey` (unique, nullable), `createdAt`, `updatedAt` | `createdAt` is the Ticket Date. |
| `Attachment` | `id`, `ticketId`, `storageKey` (unique), `originalFilename`, `mimeType`, `sizeBytes`, `uploadedAt`, `removedAt`, `removedByRequesterId`, `removalReason` | The four removal-related columns are nullable; a row with `removedAt = NULL` is active. |

### Enums

```prisma
enum RequestedPriority { LOW MEDIUM HIGH URGENT }
enum TicketStatus      { NEW }
```

`RequestedPriority` is declared in severity order so that Postgres orders it by severity
rather than alphabetically (BR-25). `TicketStatus` holds only `NEW` in Lab 2; Lab 3 adds
its remaining members without a data migration.

### Relationships

- `Requester` 1—∞ `Ticket`
- `Ticket` 1—∞ `Attachment`
- `Category` 1—∞ `Ticket`
- `RelatedSystem` 1—∞ `Ticket`
- `Requester` 1—∞ `Attachment` through `removedByRequesterId`, recording who removed what

### Constraints and indexes

| Decision | Reason |
|---|---|
| Unique `Ticket.ticketNumber` | It is the record's public identity (BR-01). |
| Unique `Ticket.idempotencyKey`, nullable | Enforces BR-19 at the database level rather than trusting application logic. Postgres permits many `NULL`s, so tickets created by other means are unaffected. |
| Unique `Requester.email`, `Category.name`, `RelatedSystem.name` | Gives the seed a natural key to upsert on, which is what makes reruns idempotent. |
| Unique `Attachment.storageKey` | Two rows must never point at one file on disk. |
| Index on `Ticket(requesterId, createdAt DESC)` | Every My Tickets query filters by requester and orders by date; this is the query the index exists for. |
| Index on `Ticket(categoryId)` and `Ticket(relatedSystemId)` | Supports the two exact-match filters. |
| Index on `Attachment(ticketId, removedAt)` | The active-attachment count in BR-33 is the hottest attachment query. |

**Justified design decision.** Soft removal is represented by nullable removal columns on
`Attachment` rather than by an `isRemoved` boolean or a separate `RemovedAttachment`
table. A boolean would record *that* a file was removed but not *when*, *by whom*, or
*why*, which BR-37 requires. A separate table would split one concept across two
relations and make "list all attachments, marking removed ones" a union query on the
screen that needs it most. Nullable columns keep the audit trail on the row it describes,
and `removedAt IS NULL` is a single, indexable definition of "active" used identically by
the list query, the download guard and the five-attachment count.

### Migration

One additive migration. `Category` gains `isActive` with default `true`, so existing Lab 1
rows remain valid and the migration needs no backfill. No column is dropped or renamed.

### Seed

The seed is idempotent: it upserts on the unique natural keys above, so running it twice
produces no duplicates and no errors. It creates:

- the four required Categories: **Account and Access**, **Hardware**, **Software**,
  **Network**;
- at least six Related Systems: Email, Campus Wi-Fi, VPN, LEB2 App, Grade Submission App,
  Printer, and Corporate Laptop;
- four **active** Development Requesters with realistic names and e-mail addresses;
- one **inactive** Development Requester, which must never appear in the selector (BR-06).

The seed creates no tickets. Every ticket that exists during evidence capture was created
through the application, which is what makes the Part 6 and Part 7 screenshots evidence
of working software rather than of seed data.

## 8. API Contract

The full contract — paths, parameters, payloads, responses, status codes and errors — is
in [`api-spec.md`](./api-spec.md). It covers the ten required capabilities: active
Categories, active Related Systems, active Development Requesters, create Ticket, list the
selected Requester's Tickets, retrieve one owned Ticket, upload an Attachment, list
Attachment metadata, download an active Attachment, and soft-remove an Attachment.

## 9. Acceptance Criteria

- **AC-01** Given four active and one inactive Requester are seeded, when the selector
  loads, then the four active Requesters are offered, the inactive one is absent, and the
  screen states that this is a testing mechanism rather than a login.
- **AC-02** Given no Requester has been selected, when a requester-scoped route is opened
  directly, then the selector is shown instead of any ticket data.
- **AC-03** Given a Requester is selected, when Create Ticket opens, then Categories and
  Related Systems are loaded from the backend and the Requester field shows the selected
  person as read-only.
- **AC-04** Given a valid ticket form, when it is submitted, then exactly one Ticket is
  saved with the selected `requesterId`, status `NEW`, a server-assigned Ticket Date, and
  an official Ticket Number matching `TKT-<YYYY>-<NNNNN>`, and that number is displayed.
- **AC-05** Given an invalid ticket form, when submission is attempted, then each invalid
  field shows its own message beneath it, nothing is created, and the entered values
  remain.
- **AC-06** Given a create request is retried with the same `Idempotency-Key` and an
  identical payload, when it reaches the server, then the originally created Ticket is
  returned and no second Ticket exists.
- **AC-07** Given the backend is unreachable, when a ticket is submitted, then a safe
  error message is shown with no raw network text, and every entered value is preserved
  for retry.
- **AC-08** Given Requester A owns tickets, when My Tickets loads for A and the selection
  is then changed to Requester B, then A's tickets are listed for A and are absent for B.
- **AC-09** Given a Requester owns tickets, when a search term, a filter, a sort or a page
  is applied, then the returned set matches that query, remains scoped to the Requester,
  and the response reports `page`, `pageSize`, `totalItems` and `totalPages`.
- **AC-10** Given sorting by Requested Priority ascending, when the list renders, then
  tickets appear in severity order `LOW`, `MEDIUM`, `HIGH`, `URGENT` rather than
  alphabetical order.
- **AC-11** Given a Requester who owns no tickets and, separately, a filter that matches
  none, when My Tickets renders, then the two situations show different messages and
  different recovery actions.
- **AC-12** Given Requester B requests a Ticket or Attachment owned by Requester A, when
  the request reaches the server, then it is answered as not found and no ticket data is
  disclosed.
- **AC-13** Given an owned Ticket with fewer than five active attachments, when a
  permitted file of 5 MB or less is uploaded, then it is stored under a server-generated
  key and appears as active metadata.
- **AC-14** Given an owned Ticket, when an unsupported type, an oversize file, or a sixth
  active attachment is uploaded, then the upload is rejected with a message naming the
  reason, and no metadata row is created.
- **AC-15** Given an active attachment on an owned Ticket, when it is soft-removed with a
  valid reason, then it is marked Removed with a timestamp, remover and reason, its
  metadata remains visible, and a subsequent download of it is refused.
- **AC-16** Given Create Ticket, My Tickets and Ticket Detail at desktop, tablet and
  mobile widths, when each renders, then labels, controls, validation messages and
  attachment names are fully visible, nothing overlaps or is clipped, and the page does
  not scroll horizontally.

## 10. Definition of Done

A Lab 2 feature is done when **all** of the following hold:

1. The behaviour matches this specification, and any deviation has been agreed and
   recorded here first.
2. Its acceptance criteria are covered by automated tests at the levels named in
   [`tests.md`](./tests.md), and those tests pass.
3. No test is skipped, disabled, weakened, or replaced by an assertion that cannot fail.
4. The Prisma schema, one migration, and the idempotent seed match §7.
5. The API matches [`api-spec.md`](./api-spec.md), including validation, ownership,
   status codes and safe errors.
6. The interface matches [`ui-spec.md`](./ui-spec.md) at all three viewports, and the
   visual inspection checklist is completed against the real screens.
7. The work reached `lab2-staging` through a peer-reviewed Pull Request from its own
   feature branch, with the review recorded in [`reviewer.md`](./reviewer.md).
8. Documentation — this file, `tests.md`, `ui-spec.md`, `api-spec.md`, `ai-use.md` and the
   README — reflects what was actually built.
9. The final unit, API and UI test output in `tests.md` was captured from `main` after the
   release merge, not from a feature branch.

## 11. Assumptions and Decisions

| # | Decision | Reasoning |
|---|---|---|
| D-01 | The selected Requester travels in an `X-Dev-Requester-Id` header rather than as a query parameter or body field on every endpoint. | It keeps identity out of the resource's own payload, so `POST /api/tickets` describes a ticket and nothing else. It also gives ownership checks one place to live — a single middleware — and makes Lab 3 a substitution at that seam rather than a change to every route signature (BR-44). |
| D-02 | Idempotency travels in an `Idempotency-Key` header rather than in the request body. | Same reasoning as D-01: it is transport metadata, not part of the ticket. It also matches the convention most payment and messaging APIs use, so it is a recognisable pattern rather than a local invention. |
| D-03 | Every invalid client input returns `400` with `fieldErrors`, and `422` is not used. | One rule is easier to implement consistently and to test than a split between malformed and semantically invalid input, and the boundary between those two is genuinely ambiguous for a JSON body. The response body, not the status code, tells the client which fields failed. |
| D-04 | Cross-requester access returns `404`, never `403`. | A `403` confirms the resource exists, which is itself a disclosure. `404` is indistinguishable from a wrong identifier (BR-10). |
| D-05 | Ticket creation and attachment upload are separate requests. | A ticket is worth keeping even when one file fails to upload. Combining them would mean either losing a valid ticket to a transient upload failure or accepting a partially-created ticket, and neither is defensible (BR-34). |
| D-06 | Attachments are stored on the server filesystem under a generated key, with metadata in Postgres. | Keeping binaries out of the database keeps backups and query performance sane, and the generated key removes any path built from user input (BR-35). The storage boundary is behind an interface so Lab 3 can move to object storage without touching the routes. |
| D-07 | Current Status is not exposed as a filter in Lab 2. | Every ticket is `NEW` (BR-03), so the control could never change a result set. Shipping a filter that cannot filter is worse than omitting it, and Part 7 evidence uses Category, Related System and Requested Priority instead (BR-30). |
| D-08 | Requested Priority is a Postgres enum declared in severity order. | A string column sorts alphabetically — `HIGH`, `LOW`, `MEDIUM`, `URGENT` — which is meaningless to a user. Declaration order gives severity sorting with no application-side comparator (BR-25). |
| D-09 | Summary is 5–120 characters; Description is 20–4000. | The Summary bound keeps one line readable in the tablet-width table; the Description lower bound exists because Lab 3's IT staff must be able to act on it. Both are enforced after trimming so that whitespace cannot satisfy them. |
| D-10 | Page sizes are 10, 25 and 50, defaulting to 10. | A closed set keeps the query bounded, which prevents a hand-edited `pageSize` from becoming an accidental denial of service. |
| D-11 | The seed creates no tickets. | Tickets in the evidence screenshots must have come through the application, or the screenshots prove nothing about the software. |
| D-12 | This contract was written independently of the peer's Lab 2 contract, which was reviewed on 2026-08-26 in `Earth2509/toktickit` PR #12. | Both derive from the same labsheet, so fixed constraints — the palette, the attachment limits, the four categories, the breakpoints — necessarily agree. The decisions above are this repository's own: the header-based identity seam, the single `400` rule, the omitted status filter, the storage strategy, and the validation bounds all differ from the peer's. |
