# Lab 3 Sprint Engineering Specification

**Status:** Draft for peer review
**Issue:** [#44 Sprint specification and test plan](https://github.com/Nuggetkub/toktickit/issues/44)
**Branch:** `feature/44-engineering-contract`
**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub
**Peer reviewer:** Pattharapon Kijjanukij — 67070501069 — @Earth2509
**Extends:** [`docs/lab-02/specification.md`](../lab-02/specification.md), released on `main` at `56416c2`

This document is the engineering contract for Sprint 3. It is written before
implementation and updated through the sprint. The coding agent may report a feature
"done" only when this contract and the Product Definition of Done in §10 are satisfied.
Lab 2 rules are cited as **Lab 2 BR-nn**; rules in this document are cited as **BR-nn**.

---

## 1. Sprint Goal

Replace the Development Requester selector with real sign-in and role-based
authorization, and give TokTickIT its first operational workflow: IT Staff find work in a
shared Ticket Queue, take ownership, set IT Priority, move tickets through a defined
status lifecycle, talk to the Requester through Public Comments and to each other through
Internal Notes. An Administrator manages accounts through one deliberately small screen.
Every Lab 2 Requester function keeps working, now under the signed-in identity.

## 2. Stakeholder Request Interpretation

Five things in the request are load-bearing and are treated as requirements, not
preferences:

1. **Identity comes from the session, never from the client.** Lab 2 built one seam for
   this — the `X-Dev-Requester-Id` header resolved in a single function (Lab 2 BR-44). Lab 3
   replaces what feeds that seam and keeps every ownership rule behind it unchanged.
2. **"Hiding a button is not authorization."** Every protected operation is refused by the
   server for the wrong role or the wrong owner. The interface hides what a role cannot do,
   but that is a courtesy, and the tests prove the server refuses regardless.
3. **Requesters signal; IT Staff decide.** A Requester can say the problem appears
   resolved. Only IT Staff (or an Administrator) can formally resolve or close a ticket.
4. **Public versus private is a data boundary, not a styling choice.** Internal Notes are
   stored separately from Public Comments and are never serialised into anything a
   Requester can receive.
5. **Administration is minimal and must be safe.** The screen is small on purpose, but the
   safety rules — no self-deactivation, never zero active Administrators, deactivation
   instead of deletion — hold even under concurrent requests.

The request is silent on session mechanism, password policy, the status transition
matrix, queue query semantics and several edge cases. Those are resolved here and
recorded in §11.

## 3. Scope

### Included

- Sign-in, sign-out, current user, mandatory first-login password change, and voluntary
  password change.
- Three roles with server-side authorization, and the authorization matrix in §5.
- Migration of the Lab 2 Development Requesters into the User model, and removal of the
  selector, the Change Requester action and their client-side state.
- All Lab 2 Requester functions under the authenticated identity, plus a Current Status
  filter on My Tickets (promised by Lab 2 decision D-07).
- IT Staff Ticket Queue, IT Staff Ticket Detail, Ticket Owner, IT Priority and the status
  lifecycle.
- Public Comments, Internal Notes, and the Requester's "Problem Appears Resolved" signal.
- Minimal Administrator User Management.
- Idempotent seed with accounts for every role and realistic tickets.
- Automated unit, API, authorization, migration, UI component, UI style, responsive and
  end-to-end tests.

### Excluded

- Email of any kind: invitations, password-reset links, notifications.
- Password reset by the user, MFA, social login, SSO, self-registration.
- Multiple roles per user, user deletion, bulk operations, import or export, account or
  role history screens, departments, profile photos.
- Pagination, multi-column sorting and multiple simultaneous filters on the user list.
- Account unlocking and approval workflows. Login throttling expires on its own (BR-09).
- Actions Taken, and the Lab 4 rule that blocks resolution while Actions Taken remain open.
- SLA calculation, escalation, dashboards and KPI analytics.
- Production deployment and cloud infrastructure.

### Where the labsheet mockups contradict its text

The illustrations on pages 8–12 show controls the written scope excludes. **The text
wins**, and each deviation is listed in [`ui-spec.md`](./ui-spec.md) §12: the "Forgot your
password?" link, the "Send password reset email" checkbox, pagination on the user list,
the "Service Actions" tab, a "Pending" status that is not one of the eight, and a
Deactivate button on the Create User panel.

## 4. Functional Requirements

- **FR-01** A user shall sign in with an email address and password. Only an active user
  with valid credentials is admitted.
- **FR-02** A user whose password must be changed shall be admitted only to the Change
  Password screen until a valid new password is saved.
- **FR-03** A signed-in user shall be able to change their own password.
- **FR-04** Logout shall end the session on the server so the old session can no longer
  be used.
- **FR-05** The application shell shall show the signed-in user's name and role and only
  the navigation that role is permitted.
- **FR-06** The server shall enforce role and ownership on every protected endpoint,
  independently of the interface.
- **FR-07** The Lab 2 Development Requesters shall be migrated into User accounts with
  every ticket and attachment keeping its owner.
- **FR-08** Every Lab 2 Requester function shall work under the authenticated identity,
  and My Tickets shall gain a Current Status filter.
- **FR-09** IT Staff shall search, filter, sort and page a shared Ticket Queue and open any
  ticket from it.
- **FR-10** IT Staff shall claim an unassigned ticket, assign or reassign it to an eligible
  user, or unassign it.
- **FR-11** IT Staff shall set a ticket's IT Priority without altering its Requested
  Priority.
- **FR-12** IT Staff shall move a ticket through the status transition matrix, supplying a
  resolution summary or reason where one is required.
- **FR-13** The owning Requester, IT Staff and Administrators shall read and post Public
  Comments on a ticket.
- **FR-14** IT Staff and Administrators shall read and post Internal Notes; Requesters
  shall have no access to them at all.
- **FR-15** The owning Requester shall indicate that the problem appears resolved, and IT
  Staff shall see that indication in the queue and on Ticket Detail.
- **FR-16** An Administrator shall list users with search and an optional role filter,
  create a user, edit name, email, role and activation state, and set a new initial
  password.
- **FR-17** Every screen shall present loading, saving, success, validation, empty,
  no-results, forbidden, not-found, conflict and safe-failure feedback where meaningful, at
  desktop, tablet and mobile widths.

## 5. Business Rules

### Authentication

- **BR-01** Only an active user with valid credentials may authenticate.
- **BR-02** A user marked as requiring a password change cannot enter the normal
  application until a new valid password is saved. The server enforces this: such a
  session may call only `GET /api/auth/me`, `POST /api/auth/change-password` and
  `POST /api/auth/logout`. Every other endpoint answers `403 PASSWORD_CHANGE_REQUIRED`.
- **BR-03** The authenticated user identity, not a `requesterId` supplied by the client,
  determines ownership of Requester operations. Any `requesterId` in a body or query
  string, and any `X-Dev-Requester-Id` header, is ignored.
- **BR-04** Public Comments are visible to the Requester, IT Staff, and Administrator.
  Internal Notes are visible only to IT Staff and Administrator.
- **BR-05** A Requester may indicate that the problem appears resolved, but cannot
  formally set the Ticket to Resolved or Closed.
- **BR-06** An unknown email, a wrong password, and an account with no password yet all
  receive the same `401 INVALID_CREDENTIALS` response. The server verifies against a fixed
  dummy hash when there is no user or no hash, so response time does not reveal which
  accounts exist.
- **BR-07** An inactive account receives the distinct `403 ACCOUNT_INACTIVE` —
  "This account has been deactivated. Contact your administrator." — **only when the
  password is correct**. With a wrong password it receives the generic response in BR-06,
  so deactivation is never revealed to someone who does not hold the password.
- **BR-08** An email address is trimmed and lowercased before storage and before every
  comparison, must be a valid address of at most 254 characters, and is unique across all
  users.
- **BR-09** Five failed sign-in attempts for one normalised email within 15 minutes cause
  every further attempt for that email — including one with the correct password — to
  receive `429 LOGIN_THROTTLED` with a `Retry-After` header until the window expires.
  Unknown emails are counted identically. A successful sign-in clears the count. A wrong
  current password on the Change Password endpoint counts against the same email.

### Passwords

- **BR-10** Passwords are never stored, logged or returned in plaintext. Each is hashed
  with scrypt (N = 32768, r = 8, p = 3, 16-byte random salt, 64-byte key) and stored as a
  self-describing string `scrypt$32768$8$3$<salt>$<key>` so parameters can change later
  without breaking existing hashes. Verification uses a constant-time comparison.
- **BR-11** A new password is 12 to 128 characters, is not only whitespace, is not trimmed,
  differs from the current password, and differs from the account's email address. The
  confirmation must match. No composition rule is imposed (decision D-05).
- **BR-12** An initial password is set only by an Administrator, or by the development seed
  for its own accounts. Setting one always marks the account as requiring a password
  change and ends every session the account has.

### Sessions

- **BR-13** A session is a 32-byte random token in an `HttpOnly`, `SameSite=Lax` cookie
  named `toktickit_session`. The database stores only its SHA-256 hash. A session expires
  eight hours after sign-in.
- **BR-14** Every request re-checks that its session exists, has not expired, and belongs
  to an active user. A deactivated user's open session stops working on their next
  request.
- **BR-15** Logout deletes the session. A password change deletes every session of that
  user and issues a new one. An Administrator setting an initial password, changing a
  role, or deactivating an account deletes every session of the affected user.
- **BR-16** A state-changing request (`POST`, `PATCH`, `PUT`, `DELETE`) whose `Origin`
  header is absent or not one of the configured client origins is refused with
  `403 ORIGIN_REJECTED` before anything else runs. CORS allows exactly the configured
  origins, with credentials.

### Roles and authorization

- **BR-17** Each user has exactly one role: `REQUESTER`, `IT_STAFF` or `ADMINISTRATOR`.
- **BR-18** Checks run in a fixed order: no valid session → `401 UNAUTHENTICATED`;
  password change pending → `403 PASSWORD_CHANGE_REQUIRED`; role not permitted for the
  endpoint → `403 FORBIDDEN`, **before** any resource is looked up, so the answer is the
  same for an id that exists and one that does not; ticket or attachment not visible to
  this user → `404`; invalid input → `400`; state conflict → `409`.
- **BR-19** A Requester's access to another Requester's ticket or attachment remains
  `404`, identical to a nonexistent id (Lab 2 BR-10).
- **BR-20** An Administrator may perform every IT Staff ticket operation (decision D-08).
  An Administrator does not use Requester functions. IT Staff have no access to user
  management.

### Authorization matrix

Every cell assumes an active, signed-in user with no password change pending.

| Operation | Requester | IT Staff | Administrator |
|---|---|---|---|
| Create Ticket, My Tickets | Own | — | — |
| Read Ticket Detail, attachment metadata, download active attachment | Own | Any | Any |
| Upload or soft-remove an attachment | Own | — | — |
| Ticket Queue, assignee list | — | Yes | Yes |
| Claim, assign, reassign, unassign | — | Yes | Yes |
| Set IT Priority, change status | — | Yes | Yes |
| Read and post Public Comments | Own | Any | Any |
| Read and post Internal Notes | — | Any | Any |
| Indicate "Problem Appears Resolved" | Own | — | — |
| User Management (list, create, edit, set initial password) | — | — | Yes |
| Own session: current user, change password, logout | Yes | Yes | Yes |

"—" is refused with `403 FORBIDDEN` by the server, and the interface does not offer it.

### Ticket Owner and IT Priority

- **BR-21** A ticket has zero or one Ticket Owner. The owner must be an active `IT_STAFF` or
  `ADMINISTRATOR` user at the moment of assignment. A new ticket is unassigned.
- **BR-22** Claim makes the caller the owner only when the ticket is unassigned; an
  assigned ticket answers `409 TICKET_ALREADY_ASSIGNED`. Assign sets any eligible user;
  assigning to anyone else answers `400` with a field error on `ownerId`. Unassign sets no
  owner.
- **BR-23** Requested Priority never changes after creation. IT Priority equals Requested
  Priority when a ticket is created — and migrated tickets receive the same value — and
  afterwards changes only through IT Staff or an Administrator.
- **BR-24** Claim, assign, IT Priority and status changes each carry the ticket `version`
  the client last read. A mismatch answers `409 TICKET_VERSION_CONFLICT` with the current
  ticket and changes nothing. Success increments `version`. Posting a comment or note, or
  the Requester's indication, updates Last Updated but not `version`, so a conversation
  never invalidates someone's pending status change.
- **BR-25** Deactivating a user, or changing their role to `REQUESTER`, unassigns every
  non-terminal ticket they own in the same transaction. Terminal tickets keep their
  historical owner. The response reports how many tickets were unassigned.

### Ticket status

- **BR-26** A ticket is always in exactly one of eight statuses:

| Status | Meaning | Terminal | Owner required to enter |
|---|---|---|---|
| `NEW` | Submitted, not yet looked at | No | No |
| `OPEN` | Triaged and accepted, waiting to be worked | No | No |
| `IN_PROGRESS` | Being worked on | No | **Yes** |
| `WAITING_FOR_REQUESTER` | Blocked on information from the Requester | No | **Yes** |
| `RESOLVED` | IT Staff consider the problem fixed | No | **Yes** |
| `CLOSED` | Finished | **Yes** | — |
| `REOPENED` | A resolved ticket that needs more work | No | No |
| `CANCELLED` | Withdrawn, duplicate, or will not be done | **Yes** | — |

- **BR-27** A **terminal** ticket (`CLOSED`, `CANCELLED`) is frozen: no status change, no
  owner or IT Priority change, no new comment or note, no attachment upload or removal, and
  no resolution indication — each answers `409 TICKET_TERMINAL`. Everything on it remains
  readable, and active attachments remain downloadable.
- **BR-28** "Owner required to enter" is a condition on the transition, not an invariant.
  Moving an unassigned ticket into `IN_PROGRESS`, `WAITING_FOR_REQUESTER` or `RESOLVED`
  answers `409 OWNER_REQUIRED`. A ticket already in one of those statuses may later be
  unassigned — by hand or by BR-25 — and shows as Unassigned in the queue until someone
  takes it.
- **BR-29** Only IT Staff and Administrators change status, and only along these
  transitions. Any other pair, including a status to itself, answers
  `409 INVALID_STATUS_TRANSITION`.

| From | Allowed next statuses |
|---|---|
| `NEW` | `OPEN`, `IN_PROGRESS`, `CANCELLED` |
| `OPEN` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` |
| `IN_PROGRESS` | `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` |
| `WAITING_FOR_REQUESTER` | `IN_PROGRESS`, `RESOLVED`, `CANCELLED` |
| `RESOLVED` | `CLOSED`, `REOPENED` |
| `REOPENED` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` |
| `CLOSED` | none |
| `CANCELLED` | none |

- **BR-30** Entering `RESOLVED` requires a resolution summary of 10 to 2000 characters
  after trimming. Entering `CANCELLED` or `REOPENED` requires a reason of 5 to 500
  characters after trimming. The summary or reason is also posted as a Public Comment by
  the acting user, marked as a status change, so the Requester sees why and the history is
  kept. Entering `REOPENED` clears the stored resolution summary and the Requester's
  indication.
- **BR-31** The interface asks for confirmation before `RESOLVED`, `CLOSED`, `CANCELLED`
  and `REOPENED`. The server does not depend on that confirmation.

### Resolution indication

- **BR-32** The owning Requester may indicate "Problem Appears Resolved" while the ticket is
  `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER` or `REOPENED`. It records the time,
  does not change the status, and repeating it changes nothing and answers `200`. On a
  `RESOLVED` or terminal ticket it answers `409 INDICATION_NOT_ALLOWED`.
- **BR-33** IT Staff see the indication as a marker on the queue row, as a filter, and as a
  banner with its time on Ticket Detail.

### Public Comments and Internal Notes

- **BR-34** Public Comments and Internal Notes are stored in separate tables. Internal Notes
  are never included in a Ticket Detail, list, comment, error or any other response to a
  Requester.
- **BR-35** A Requester requesting Internal Notes, by any method, receives
  `403 FORBIDDEN` before the ticket is looked up — no content, and no hint whether the
  ticket exists.
- **BR-36** Content is trimmed and must be 1 to 2000 characters; whitespace alone is
  rejected. Author and creation time are set by the server; any author or time in the
  request is ignored. Content is rendered as plain text with line breaks preserved — never
  as HTML.
- **BR-37** Comments and notes are append-only: no endpoint edits or deletes them. They are
  returned newest first.

### User administration

- **BR-38** The user list supports a case-insensitive substring search on name or email and
  an optional filter on one role, ordered by name then id. It is not paginated.
- **BR-39** Creating a user requires a name of 2 to 100 characters after trimming, a valid
  unique email, one role, an activation state and an initial password meeting BR-11. The
  account is created requiring a password change. A duplicate email, compared after
  normalisation, answers `409 EMAIL_ALREADY_EXISTS`.
- **BR-40** An Administrator may edit a user's name, email, role and activation state, and
  set a new initial password (BR-12). Users are deactivated, never deleted; a deactivated
  account keeps all its history and can be reactivated.
- **BR-41** An Administrator cannot deactivate their own account
  (`409 CANNOT_DEACTIVATE_SELF`) or change their own role (`409 CANNOT_CHANGE_OWN_ROLE`).
- **BR-42** At least one active Administrator always exists. A deactivation or role change
  that would leave none answers `409 LAST_ACTIVE_ADMINISTRATOR`. The check and the update
  run in one transaction that locks the active Administrator rows, so two concurrent
  changes cannot both pass.

### Migration and seed

- **BR-43** Every Lab 2 Requester becomes a User with the **same id**, name, email
  (lowercased), activation state and timestamps, role `REQUESTER`, no password, and a
  pending password change. An account with no password cannot sign in (BR-06) until an
  Administrator, or the development seed, sets an initial password. Every existing ticket
  keeps its Requester, receives IT Priority equal to its Requested Priority, no owner,
  and `version` 1.
- **BR-44** The seed is idempotent. It creates missing accounts and, for existing seeded
  accounts, restores the seeded role and activation state (as Lab 2 did for Requesters). It
  sets a password only where none exists, so it never undoes a password someone changed.
  Seeded tickets carry fixed idempotency keys, so a second run creates none.
- **BR-45** Seeded credentials are for local development only, use the reserved
  `toktickit.local` domain, share one documented development password, and are listed in
  the README. No real personal password or secret is committed.

### Continuity from Lab 2

- **BR-46** Lab 2 BR-01 to Lab 2 BR-43 remain in force except where replaced:
  - Lab 2 BR-05 to Lab 2 BR-08 (Development Requester) and Lab 2 BR-11 (Change Requester)
    are replaced by this document's BR-01 to BR-16.
  - Lab 2 BR-30 (no status filter) is replaced by FR-08.
  - Lab 2 BR-40 (owner-only attachment access) is widened by the authorization matrix, so
    IT Staff and Administrators can read metadata and download.
  - Lab 2 BR-44 (the identity seam) is fulfilled by this document's BR-03.
- **BR-47** On any `401` other than from sign-in, the interface clears the signed-in
  user's data and returns to Login with "Your session has ended. Please sign in again." On
  `403 PASSWORD_CHANGE_REQUIRED` it goes to Change Password.

## 6. UI Specification Summary

The full contract is [`ui-spec.md`](./ui-spec.md). Lab 3 reuses every Lab 2 token, control
state, button variant, announcement rule, breakpoint and accessibility rule unchanged, and
adds: the authenticated shell with the user's name, a role badge and role-specific
navigation; Login and Change Password; Forbidden and session-ended states; the IT Staff
Ticket Queue as a table on desktop and cards below 768 px; the IT Staff Ticket Detail with
read-only ticket facts separated from the editable Work panel; Public Comments and Internal
Notes in visibly different panels, the notes panel tinted and labelled as private; and one
User Management screen with a list and a side panel. Status, Requested Priority, IT
Priority and role each have one badge component, always carrying text.

## 7. Data Changes

### Models

| Model | Change | Fields |
|---|---|---|
| `User` | **Renamed from `Requester`** — same table, same ids | `id`, `fullName`, `email` (unique, lowercase), `role`, `isActive`, `passwordHash` (nullable), `mustChangePassword`, `createdAt`, `updatedAt` |
| `Session` | New | `id`, `tokenHash` (unique), `userId`, `createdAt`, `expiresAt` |
| `Ticket` | Extended | adds `ownerId` (nullable FK to `User`), `itPriority`, `version` (default 1), `resolutionSummary` (nullable), `requesterResolvedAt` (nullable) |
| `PublicComment` | New | `id`, `ticketId`, `authorId`, `content`, `statusChangedTo` (nullable), `createdAt` |
| `InternalNote` | New | `id`, `ticketId`, `authorId`, `content`, `createdAt` |
| `Category`, `RelatedSystem`, `Attachment`, `TicketNumberSequence` | Unchanged | `Attachment.removedByRequesterId` keeps its name and now references `User` |

### Enums

```prisma
enum Role              { REQUESTER IT_STAFF ADMINISTRATOR }
enum TicketStatus      { NEW OPEN IN_PROGRESS WAITING_FOR_REQUESTER RESOLVED CLOSED REOPENED CANCELLED }
enum RequestedPriority { LOW MEDIUM HIGH URGENT }   // also the type of Ticket.itPriority
```

`TicketStatus` gains its seven new values in the declared order, so sorting by status
follows the lifecycle rather than the alphabet, as Lab 2 D-08 did for priority.
`itPriority` reuses the `RequestedPriority` enum because the scale is identical; renaming
the type would touch every Lab 2 reference for no behavioural gain.

### Relationships

- `User` 1—∞ `Ticket` as Requester (`requesterId`, unchanged)
- `User` 1—∞ `Ticket` as Ticket Owner (`ownerId`, optional)
- `User` 1—∞ `Session`, `PublicComment` (author), `InternalNote` (author)
- `Ticket` 1—∞ `PublicComment`, `InternalNote`, `Attachment`

### Constraints and indexes

| Decision | Reason |
|---|---|
| Unique `User.email`, stored lowercase | Uniqueness is then case-insensitive with an ordinary unique index (BR-08). |
| Unique `Session.tokenHash`; index `Session(userId)` | Lookup on every request; deletion of all a user's sessions (BR-15). |
| Index `User(role, isActive)` | The assignee list and the last-Administrator check both filter on exactly this. |
| Index `Ticket(ownerId)`, `Ticket(currentStatus)`, `Ticket(updatedAt)` | The queue's owner filter, status filter and Last Updated sort. |
| Index `PublicComment(ticketId, createdAt DESC)` and the same on `InternalNote` | Every read is one ticket's entries, newest first. |
| `ON DELETE RESTRICT` on every new foreign key | Nothing in Lab 3 deletes users or tickets; the database should refuse rather than cascade if something tries. |

**Justified design decision.** Public Comments and Internal Notes are two tables rather
than one table with a visibility flag. With one table, every query a Requester can reach
must remember `WHERE visibility = 'PUBLIC'`, and a single forgotten clause leaks private
notes. With two tables, a Requester-facing query cannot return a note even when written
carelessly, because it never touches the table notes live in. The cost is two near-identical
routes; that duplication is the point.

### Migration

One migration, with its generated SQL hand-edited where Prisma would otherwise drop and
recreate:

1. Preflight: stop with an explicit error if any two Requester emails collide once trimmed
   and lowercased. Nothing is changed in that case.
2. `ALTER TABLE "Requester" RENAME TO "User"` and rename its primary-key and unique
   constraints to Prisma's names for `User`, so the result matches `schema.prisma` exactly.
   Existing foreign keys follow the table automatically.
3. Lowercase and trim every email; add `role` (default `REQUESTER`), `passwordHash` (null),
   `mustChangePassword` (default true).
4. Add the seven `TicketStatus` values; add the new `Ticket` columns and backfill
   `itPriority` from `requestedPriority`.
5. Create `Session`, `PublicComment`, `InternalNote`, and the indexes above.

No column is dropped and no id changes. Rollback is by restoring the pre-migration backup,
not by a down-migration: a reverse script that drops tables would discard any comments or
sessions created since.

### Seed

`seedReferenceData` keeps doing what Lab 2's did — categories, related systems, accounts —
and still creates no tickets, so the test harness and Lab 2's seed test are unaffected.
A second function, `seedDemoTickets`, is run by `prisma db seed` and the E2E preparation.

| Accounts | Active | Inactive |
|---|---|---|
| Requester | Nadia Rahman, Somchai Pattana, Marisa Chen and Tobias Lindqvist (the four migrated from Lab 2), plus Ananya Wong | Priya Anand (migrated from Lab 2) |
| IT Staff | Arthit Chaiyaporn, Grace Okafor, Daniel Reyes | Wichai Boonmee |
| Administrator | Pim Srisawat | — |

Demo tickets: at least 30, spread across all eight statuses, all four priorities, every
category, at least three Requesters, assigned and unassigned owners, at least one ticket
with a resolution indication, and example comments and notes containing no sensitive
information.

## 8. API Contract

The full contract is in [`api-spec.md`](./api-spec.md). It covers every capability in
labsheet §6: sign-in, sign-out, current user and password change; the Lab 2 Requester
ticket and attachment APIs under authentication; the IT Staff queue with search, filters,
sorting and pagination; one ticket for IT Staff; claim, assign and reassign; IT Priority
and status; Public Comments; Internal Notes for permitted roles only; and the
Administrator user list, create, update and set-initial-password operations. The Lab 2
error envelope, the single-`400` validation rule and the `404` ownership rule carry over
unchanged. `403` enters the API for the first time, carrying four codes: `FORBIDDEN` for a
role refusal, `PASSWORD_CHANGE_REQUIRED` while a password change is pending,
`ACCOUNT_INACTIVE` at sign-in, and `ORIGIN_REJECTED` for an untrusted origin. None of them
depends on whether a particular resource exists, so none discloses one — an ownership
refusal is still `404`.

## 9. Acceptance Criteria

- **AC-01** Given an active user with valid credentials, when the user logs in, then the
  backend establishes authenticated access and returns the permitted user identity and
  role.
- **AC-02** Given a user who must change the initial password, when login succeeds, then
  normal application screens remain unavailable until a valid new password is saved.
- **AC-03** Given an authenticated Requester, when the client supplies another
  `requesterId`, then the backend still applies the authenticated identity and does not
  return another Requester's data.
- **AC-04** Given a Requester account, when an Internal Note endpoint is requested, then the
  operation is rejected without exposing note content.
- **AC-05** Given an unknown email, a wrong password, or an inactive account, when sign-in
  is attempted, then the first two receive the same safe failure, the inactive account is
  told it is deactivated only if its password was correct, no session is created, and a
  sixth failure for one email within 15 minutes is throttled.
- **AC-06** Given a signed-in user changing their password, when the new password breaks a
  rule, the confirmation differs, or the current password is wrong, then the matching field
  shows an error and nothing changes; when it is valid, the pending flag clears, the session
  is replaced, and every other session of that user stops working.
- **AC-07** Given a signed-in user, when they log out, then the old session is refused by
  every API endpoint and a direct application URL shows Login instead of any data.
- **AC-08** Given a user with an open session, when an Administrator deactivates them,
  changes their role or sets a new initial password, or the session passes eight hours,
  then their next request is refused as unauthenticated.
- **AC-09** Given each role, when the application and the API are used directly, then each
  role sees only its permitted navigation, an unpermitted screen shows Forbidden, an
  unpermitted endpoint answers `403` before any lookup, and a state-changing request from
  an unlisted origin is refused.
- **AC-10** Given an authenticated Requester, when every Lab 2 journey is repeated — create,
  find, filter including by status, open, upload, download, remove — then it behaves as in
  Lab 2, another Requester's ticket is still not found, and no selector or Change Requester
  control exists.
- **AC-11** Given a populated Lab 2 database, when the Lab 3 migration runs, then every
  Requester, Ticket, Attachment, owner link, removal attribution, Ticket Number and stored
  file is unchanged, IT Priority equals Requested Priority, the resulting schema matches
  `schema.prisma`, and a colliding email stops the migration before any change.
- **AC-12** Given an empty database, when the seed runs twice, then the minimum accounts for
  each role and activation state exist once, tickets cover every status and both assigned
  and unassigned, comments and notes exist, and a password changed between the runs is not
  reset.
- **AC-13** Given IT Staff on the Ticket Queue, when search, a filter, a sort or a page is
  applied, then the returned set matches the query with correct paging metadata, and an
  invalid parameter is rejected rather than ignored.
- **AC-14** Given IT Staff on a ticket, when they claim, assign, reassign or unassign it,
  then only an active IT Staff or Administrator can become owner, claiming an assigned
  ticket is refused, and a stale version never overwrites a newer change — including two
  simultaneous claims, of which exactly one wins.
- **AC-15** Given a new ticket, when it is created, then IT Priority equals Requested
  Priority; when IT Staff change IT Priority, then Requested Priority is unchanged; and a
  Requester cannot change either.
- **AC-16** Given a ticket in each status, when each of the 64 status pairs is attempted,
  then exactly the transitions in BR-29 succeed with their required summary or reason, every
  other pair is refused, an unassigned ticket cannot enter an owner-required status, and a
  terminal ticket accepts no change of any kind.
- **AC-17** Given a ticket, when a Public Comment is posted by its Requester, IT Staff or an
  Administrator, then it is stored with its author and time from the server, shown newest
  first as plain text, invalid content is rejected, and no edit or delete is possible.
- **AC-18** Given a ticket with Internal Notes, when IT Staff or an Administrator read it,
  then the notes are shown in a separate private panel; and no response to a Requester, of
  any kind, contains note content.
- **AC-19** Given a Requester's own open ticket, when they indicate the problem appears
  resolved, then the status is unchanged, IT Staff see the indication in the queue and on
  Ticket Detail, and reopening the ticket clears it.
- **AC-20** Given an Administrator on User Management, when they search by name or email,
  filter by role, or create a user, then the list matches, and a duplicate email or invalid
  input is rejected beside its field.
- **AC-21** Given an Administrator editing a user, when name, email, role or activation
  state change, or a new initial password is set, then the change is saved and a new
  initial password forces a password change at that user's next sign-in.
- **AC-22** Given an Administrator, when they try to deactivate themselves, change their own
  role, or remove the last active Administrator — including through two concurrent
  requests — then each is refused; and deactivating an IT Staff member unassigns their open
  tickets.
- **AC-23** Given an IT Staff or Requester account, when any User Management endpoint or
  screen is requested, then it is refused and no Users navigation is shown.
- **AC-24** Given every major Lab 3 screen at desktop, tablet and mobile widths, when each
  renders, then badges, editable and read-only fields, validation placement and focus
  follow `ui-spec.md`, and nothing is clipped, overlapping, or scrolls the page sideways.

## 10. Definition of Done

### Part 1 — Product completion

The coding agent may report Lab 3 complete only when **all** of the following hold:

1. Every FR, BR and AC in this document is implemented, and any deviation was agreed and
   recorded here first.
2. Every acceptance criterion is linked in [`tests.md`](./tests.md) to at least one
   automated test, and every such test passes.
3. No test is skipped, disabled, weakened, or asserts something that cannot fail. Each new
   authorization and workflow test has been seen to fail against a deliberately broken
   implementation.
4. The Lab 2 suites pass unchanged in behaviour; any Lab 2 test altered only because the
   selector was retired is listed in `tests.md` with the reason.
5. The migration has been proven against a populated Lab 2 database, and the migrated
   schema matches `schema.prisma` with no drift.
6. Every protected endpoint has been exercised directly as each role and as nobody, and
   answers exactly as the authorization matrix says.
7. No response to a Requester contains Internal Note content, a password hash, a session
   token or a storage key — asserted, not assumed.
8. The API matches [`api-spec.md`](./api-spec.md), including every status code and error
   code.
9. Every screen matches [`ui-spec.md`](./ui-spec.md) at three viewports, and the visual
   inspection checklist is completed against the running application.
10. The README states how to migrate, seed, sign in with the development accounts, and run
    every suite, and those instructions work on a fresh clone.

### Part 2 — Course delivery

Checked separately from product completion:

1. Each issue #44–#57 was implemented on its own feature branch and reached `lab3-staging`
   through a Pull Request approved by the peer reviewer, recorded in
   [`reviewer.md`](./reviewer.md).
2. This contract merged before any implementation Pull Request did.
3. `lab3-staging` was released to `main` through a reviewed Pull Request, and the final
   results in `tests.md` were captured on `main` after that merge.
4. [`ai-use.md`](./ai-use.md) names the LLM and records 6–10 real prompts and a reflection.
5. The GitHub Project shows every Lab 3 issue in Done.
6. One PDF, headed Answer Part 1 to Answer Part 9, carries readable evidence and working
   links.

## 11. Assumptions and Decisions

| # | Decision | Reasoning |
|---|---|---|
| D-01 | Server-side sessions in PostgreSQL behind an opaque cookie, not JWTs. | BR-14 and BR-15 require that logout, deactivation and a role change take effect on the next request. A stateless token stays valid until it expires unless a revocation list is added — which is a session table under another name. |
| D-02 | The client keeps calling the API cross-origin through `VITE_API_URL`, with CORS pinned to the configured origins and credentials allowed; no Vite proxy. | Lab 2 already pins CORS to one origin (`server/src/config.ts`) and the E2E run already uses separate ports. `localhost:5173` and `localhost:3000` are the same *site*, so a `SameSite=Lax` cookie is sent. The change is `credentials: true` on the server and `credentials: "include"` on the client, not a new transport. |
| D-03 | CSRF protection is `SameSite=Lax` plus an `Origin` allowlist on state-changing requests, not a synchronizer token. | `SameSite=Lax` stops cross-site requests carrying the cookie. It does not stop a *same-site* page — another app on a different localhost port — which is exactly what the `Origin` check refuses. A token would add a round trip and client state for no additional protection in this deployment. |
| D-04 | scrypt from Node's built-in `crypto`, with an OWASP-listed parameter set (N = 2^15, r = 8, p = 3). | bcrypt and Argon2 need native modules that must compile on every contributor's machine, including Windows. scrypt is memory-hard, in the standard library, and needs no build step. The self-describing hash format lets the cost rise later without a migration. |
| D-05 | Passwords need length (12–128) rather than character classes, although the labsheet mockup shows composition rules. | Current NIST guidance (SP 800-63B) finds composition rules produce predictable passwords (`Password1!`) and recommends length instead. The Change Password screen still shows a live checklist, of the rules that actually apply. |
| D-06 | An inactive account gets a distinct message, but only after its password verifies (BR-07). | Labsheet §8.1 asks for a clear response for inactive accounts without exposing unnecessary information. Revealing deactivation only to someone who already holds the correct password discloses nothing an attacker could use, and the dummy-hash verification in BR-06 keeps timing uniform. |
| D-07 | `403` enters the API for refusals that do not depend on a resource — `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_INACTIVE` and `ORIGIN_REJECTED`; ownership refusals stay `404`. | Lab 2 never returned `403`, because the only refusal was ownership, and a `403` there confirms the resource exists. These four are decided before any lookup (BR-18) — from the caller's role, their own pending password change, their own account state, or the request's origin — so each reveals only something the caller already knows, while an ownership refusal stays indistinguishable from a missing record. |
| D-08 | Administrators may perform every IT Staff ticket operation. | Labsheet §4.3 allows this only if the matrix says so, and §4.5 already implies it: the Ticket Owner may be "an active IT Staff or Administrator user", IT Priority may be changed "by IT Staff or Administrator", and Internal Notes are visible to Administrators. An Administrator's landing page is still User Management. |
| D-09 | `CLOSED` is final; `RESOLVED` is the state that can be reopened. | This gives the Requester a window — the ticket is resolved but not yet closed — to reply that the problem persists. Letting a closed ticket reopen would make Closed mean nothing. A problem that returns after closure is a new ticket. |
| D-10 | Resolution summaries and cancel/reopen reasons are also posted as Public Comments marked as status changes. | The Requester needs to see why their ticket changed, and the comment thread becomes the ticket's history without a separate audit table, which Lab 3 excludes. |
| D-11 | Public Comments and Internal Notes are separate tables. | See the justified design decision in §7. |
| D-12 | Ticket workflow uses optimistic concurrency through a `version` column. | Two IT Staff on one ticket is the normal case for a shared queue. Without a version, the second save silently reverts the first. Comments do not bump the version, so a conversation never blocks a status change. |
| D-13 | The seed now creates tickets, reversing Lab 2 D-11, but only through a separate `seedDemoTickets`. | Labsheet §5.3 requires seeded tickets. Keeping them out of `seedReferenceData` means the automated tests still start with no tickets and create what they assert on. |
| D-14 | `Requester` is renamed to `User` in place rather than copied into a new table. | Renaming keeps every id, so every foreign key — tickets, attachment removals — stays correct with no data rewritten. A copy would need every foreign key re-pointed and could not be verified as simply. |
| D-15 | One shared, documented development password for seeded accounts. | The reviewer and the grader must be able to sign in as every role on a fresh clone. The accounts are `.local` fixtures, and labsheet §5.3 permits documented local-development credentials. |
| D-16 | Login throttling is kept in memory in the API process. | It is correct for the single-process local deployment Lab 3 targets. A restart clears the counts, which is recorded in `tests.md` §7 as a known limitation. |
| D-17 | Comments and notes are not paginated, and are shown newest first. | A ticket's thread is short. Newest first matches the labsheet illustration and puts the latest reply where both parties look first. |
| D-18 | This contract was written independently of the peer's Lab 3 contract, which I reviewed on 2026-09-11 in `Earth2509/toktickit` PR #35. | The fixed constraints match because both derive from one labsheet. The session design, the Origin-based CSRF rule, the password policy, the status model — `CLOSED` final and owner as an entry condition — and the concurrency rules are this repository's own, and several points I raised in that review are resolved here: the role filter, the defined terminal states, the indication shown to IT Staff, and timing-safe sign-in. |
