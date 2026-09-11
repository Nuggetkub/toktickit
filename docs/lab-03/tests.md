# Lab 3 Test Plan and Results

**Status:** Planned — no Lab 3 test has run yet
**Companion document:** [`specification.md`](./specification.md)
**Status convention:** a row reads `Planned` until that test has actually run and passed on
`main`. Nothing is marked `Passed` from a feature branch.

---

## 1. Test Strategy

The Lab 2 strategy carries over unchanged: tests are derived from the acceptance criteria,
written before or alongside the code, and placed at the cheapest level that can prove the
behaviour. Lab 3 adds three emphases.

- **Authorization is tested at the API, exhaustively.** The interface hiding a control proves
  nothing (labsheet §3). `authorization.api.test.ts` drives every protected endpoint as
  nobody, as each role, and as a user with a password change pending, and asserts the exact
  status. A role refusal is also asserted to be identical for an id that exists and one that
  does not, since the check must run before any lookup.
- **Migration is tested against real Lab 2 data.** `migration.test.ts` builds a separate
  schema, applies only the migrations that existed in Lab 2, inserts Lab 2-shaped rows, then
  applies the Lab 3 migration and compares. A migration tested only on an empty database has
  never been tested.
- **Concurrency is tested with real concurrency.** Simultaneous claims, and two
  Administrators each deactivating the other, are sent as parallel requests against
  PostgreSQL. A mocked service cannot prove a row lock.

Each new authorization, workflow and safety test must be seen to fail once against a
deliberately broken implementation before it is trusted (Definition of Done, item 3).

**Regression.** The Lab 2 suites stay in `tests/lab-02/` and keep asserting Lab 2 behaviour;
they change only in *how* they identify the requester — a session instead of the
`X-Dev-Requester-Id` header. `RequesterSelector.test.tsx` and `RequesterRouteGuard.test.tsx`
test the retired selector and are replaced by `Login.test.tsx` and `AppShell.test.tsx`; §7
records that replacement.

---

## 2. Planned Tests

| ID | Level | AC | Scenario and expected result | Test file | Status |
|---|---|---|---|---|---|
| UNIT-01 | Unit | AC-01, AC-06 | A hash uses the `scrypt$N$r$p$salt$key` format with a fresh 16-byte salt each time; the correct password verifies, a wrong one does not, and a hash with different parameters still verifies. | `server/tests/lab-03/password.test.ts` | Planned |
| UNIT-02 | Unit | AC-06 | Password rules: 11 characters rejected, 12 accepted, 128 accepted, 129 rejected; whitespace-only rejected; not trimmed; equal to the current password or the email rejected; confirmation mismatch rejected. | `server/tests/lab-03/password.test.ts` | Planned |
| UNIT-03 | Unit | AC-16 | The transition function allows exactly the pairs in BR-29 among all 64, reports owner-required for exactly three target statuses, and treats exactly `CLOSED` and `CANCELLED` as terminal. | `server/tests/lab-03/ticket-workflow.test.ts` | Planned |
| UNIT-04 | Unit | AC-13 | Queue query parsing accepts each whitelisted value, `owner=me`, `owner=unassigned` and a numeric owner, and reports every other value as a field error. | `server/tests/lab-03/staff-queue-query.test.ts` | Planned |
| UNIT-05 | Unit | AC-05 | Login throttle: five failures allowed, the sixth throttled with the correct retry time, the window expiring, success clearing the count, and an unknown email counted identically. | `server/tests/lab-03/login-throttle.test.ts` | Planned |
| UNIT-06 | Unit | AC-17 | Comment and note content: trimmed; 1 and 2000 accepted, 0 and 2001 rejected; whitespace-only rejected; markup kept as literal text. | `server/tests/lab-03/ticket-workflow.test.ts` | Planned |
| API-01 | API | AC-01 | A valid sign-in returns `200` with the user's id, name, email and role, sets an `HttpOnly`, `SameSite=Lax` cookie, and the body contains no hash or token. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-02 | API | AC-05 | An unknown email, a wrong password and an account with no password each return an identical `401 INVALID_CREDENTIALS` body; an inactive account with its correct password returns `403 ACCOUNT_INACTIVE`, and with a wrong one the generic `401`. No cookie is set on any failure. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-03 | API | AC-05 | The sixth sign-in for one email within 15 minutes returns `429 LOGIN_THROTTLED` with `Retry-After`, even with the correct password. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-04 | API | AC-02 | A session with a pending change can use `me`, `change-password` and `logout`; categories, tickets, the queue and user management all return `403 PASSWORD_CHANGE_REQUIRED` until the change is saved. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-05 | API | AC-06 | Change password: each rule violation, a mismatch and a wrong current password return `400` naming the field, change nothing, and do not end the session; a valid change clears the flag, issues a new cookie, and a second session of the same user then gets `401`. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-06 | API | AC-07 | Logout returns `204` and clears the cookie; replaying the old cookie on any endpoint then returns `401`; logout with no session also returns `204`. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-07 | API | AC-08 | A session whose user is deactivated, has their role changed, or has an initial password set by an Administrator returns `401` on the next request; a session past its expiry returns `401`. | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-08 | API | AC-04, AC-18 | A Requester calling `GET` and `POST /internal-notes` on their own ticket, another's, and a nonexistent id receives the same `403 FORBIDDEN` with no note content; nothing is written. | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-09 | API | AC-09, AC-23 | Every protected endpoint, called with no session, as each role, and with a pending password change, returns exactly the status in the authorization matrix; each role refusal is identical for an existing and a nonexistent id. | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-10 | API | AC-03 | A Requester sending another Requester's id as `requesterId` in the query, in the body, or as `X-Dev-Requester-Id` still receives only their own tickets, and a created ticket is owned by the session user. | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-11 | API | AC-09 | A state-changing request with no `Origin` or an unlisted one returns `403 ORIGIN_REJECTED` and changes nothing; a CORS preflight from a configured origin is allowed with credentials, and one from any other origin is not. | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-12 | API | AC-09, AC-10 | `GET /api/requesters` returns `404`; categories and related systems return `401` with no session and `200` for every role. | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-13 | API | AC-10 | Every Lab 2 ticket and attachment API test passes under a signed-in Requester instead of the header, including the `404` for another Requester's ticket and attachment. | `server/tests/lab-02/create-ticket.api.test.ts`, `server/tests/lab-02/my-tickets.api.test.ts`, `server/tests/lab-02/ticket-detail.api.test.ts`, `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-14 | API | AC-10 | My Tickets filters by each of the eight statuses and rejects any other value with `400`; IT Staff and Administrators can read any ticket and download its active attachments but receive `403` for upload and removal. | `server/tests/lab-03/requester-tickets.api.test.ts` | Planned |
| DB-01 | Migration | AC-11 | A schema built from the Lab 2 migrations and populated with requesters, tickets and attachments — one soft-removed — is migrated; every id, Ticket Number, `requesterId`, `removedByRequesterId` and stored file checksum is unchanged, IT Priority equals Requested Priority, and each migrated user is a Requester with no password who cannot sign in. | `server/tests/lab-03/migration.test.ts` | Planned |
| DB-02 | Migration | AC-11 | Two Lab 2 requesters whose emails differ only in case make the migration fail with an explicit message, leaving every table unchanged. | `server/tests/lab-03/migration.test.ts` | Planned |
| DB-03 | Migration | AC-11 | After the migration, `prisma migrate diff` from the database to `schema.prisma` reports no difference. | `server/tests/lab-03/migration.test.ts` | Planned |
| DB-04 | Seed | AC-12 | After two seed runs: four active and one inactive Requester, three active and one inactive IT Staff, and an active Administrator each exist once; tickets cover all eight statuses, assigned and unassigned; comments and notes exist; a password changed between the runs still verifies afterwards. | `server/tests/lab-03/seed.test.ts` | Planned |
| API-15 | API | AC-13 | The queue returns the correct subset and paging metadata for search, each filter, `owner=me`, `owner=unassigned` and `requesterIndicated=true`; priority and status sort by severity and lifecycle order; a page beyond the last is empty with `200`. | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-16 | API | AC-13 | Each invalid queue parameter returns `400` naming it; a Requester receives `403`. | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-17 | API | AC-14 | Claim sets the caller as owner on an unassigned ticket; claiming an assigned ticket returns `409 TICKET_ALREADY_ASSIGNED`; a stale `version` returns `409 TICKET_VERSION_CONFLICT` with the current ticket; two simultaneous claims produce exactly one `200` and one `409`. | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-18 | API | AC-14 | Assign and reassign to an active IT Staff or Administrator succeed; a Requester, an inactive user or a nonexistent id as target returns `400` on `ownerId`; unassign succeeds; the assignee list contains exactly the active IT Staff and Administrators. | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-19 | API | AC-15 | A new ticket's IT Priority equals its Requested Priority; IT Staff change IT Priority and Requested Priority stays; a Requester receives `403`; a closed ticket returns `409 TICKET_TERMINAL`. | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-20 | API | AC-16 | Every transition in BR-29 succeeds from a real ticket in its source status; every other pair returns `409 INVALID_STATUS_TRANSITION`; an unassigned ticket entering an owner-required status returns `409 OWNER_REQUIRED`; missing or out-of-range summaries and reasons return `400`; each summary or reason also appears as a status-change Public Comment. | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-21 | API | AC-16 | On a closed and on a cancelled ticket, owner, priority, status, comment, note, upload, removal and indication each return `409 TICKET_TERMINAL`, while detail, comments, notes and downloads still return `200`. | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-22 | API | AC-17 | The owning Requester, IT Staff and an Administrator post and read comments; another Requester gets `404`; author and time come from the server even when the body supplies others; invalid content returns `400`; results are newest first; `PUT`, `PATCH` and `DELETE` return `404`. | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-23 | API | AC-04, AC-18 | IT Staff and an Administrator post and read notes; for a Requester, no ticket detail, ticket list, comment list or error body contains any note's content, even after notes exist on their ticket. | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-24 | API | AC-19 | The owning Requester's indication returns `200` with the status unchanged, and repeating it keeps the first time; another Requester gets `404` and IT Staff `403`; it is refused on `RESOLVED` and terminal tickets; it appears in the queue row and the `requesterIndicated` filter; `REOPENED` clears it. | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-25 | API | AC-20 | The user list searches name and email case-insensitively, filters by each role, combines both, and returns `400` for an unknown role. | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-26 | API | AC-20 | Creating a user returns `201` with a pending password change and no password in the body; the new user can sign in only with that password; a duplicate email in different case returns `409 EMAIL_ALREADY_EXISTS`; each invalid field returns `400` naming it. | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-27 | API | AC-21, AC-08 | Editing name, email, role and activation persists; setting an initial password makes the user's next sign-in land in a pending change and ends their open session. | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-28 | API | AC-22 | Self-deactivation returns `409 CANNOT_DEACTIVATE_SELF` and own role change `409 CANNOT_CHANGE_OWN_ROLE`; removing the last active Administrator returns `409 LAST_ACTIVE_ADMINISTRATOR`; two Administrators deactivating each other simultaneously leave exactly one active; deactivating IT Staff unassigns their open tickets but not closed ones and reports the count. | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-29 | API | AC-23 | IT Staff and a Requester receive `403` from every User Management endpoint, including for a nonexistent user id. | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| UI-01 | UI | AC-01, AC-05 | Login shows field validation, the "Signing in…" busy state, and distinct invalid, inactive, throttled and unreachable messages with no raw network text; the password toggle has an accessible name. | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-02 | UI | AC-02, AC-06 | Mandatory mode offers only Change Password and Log out; the live checklist ticks as rules are met; a wrong current password shows beneath its field; success lands on the role's page. | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-03 | UI | AC-07, AC-09, AC-10 | The shell shows name and role badge and each role's navigation only; a direct unpermitted route shows Forbidden; a `401` mid-session returns to Login with the session-ended notice and cleared data; no selector or Change Requester exists. | `client/tests/lab-03/AppShell.test.tsx` | Planned |
| UI-04 | UI | AC-13 | Queue controls produce the right request and reset to page 1; badges, Unassigned and the resolved marker render; loading, empty, no-results and failure are distinct; a stale response is discarded; a row opens detail. | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-05 | UI | AC-14, AC-15, AC-16 | Ticket information is read-only and the Work panel editable; Claim, owner and priority save independently; the status control lists only allowed next statuses; dialogs require summary or reason; a `409` shows Reload and keeps input; a terminal ticket disables the Work panel. | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-06 | UI | AC-17, AC-18, AC-19 | Public and internal composers are separate, labelled and keep separate drafts; notes use the private surface; the Requester indication banner shows name and time. | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-07 | UI | AC-04, AC-17, AC-19 | Requester detail shows comments and a composer, the confirmed "Problem Appears Resolved" flow leaves the status badge unchanged, and no internal-notes control is rendered or requested. | `client/tests/lab-03/RequesterDiscussion.test.tsx` | Planned |
| UI-08 | UI | AC-20, AC-21, AC-22 | User list columns, search and role filter; create and edit panels with field-level errors including duplicate email; set initial password; own Active and Role disabled with the reason; the last-Administrator error shown. | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-09 | UI | AC-10 | The Lab 2 Create Ticket, My Tickets and Requester Ticket Detail suites pass with a signed-in Requester in place of the selector; My Tickets offers the status filter. | `client/tests/lab-02/CreateTicket.test.tsx`, `client/tests/lab-02/MyTickets.test.tsx`, `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Planned |
| STYLE-01 | UI style | AC-24 | Status, priority and role badges carry text and their specified tone classes; the notes panel uses `--zen-private`; Work panel fields are editable and ticket information read-only; focus rings are present. | `client/tests/lab-03/ZenGreen.lab3.styles.test.tsx` | Planned |
| E2E-01 | E2E | AC-01, AC-02, AC-05, AC-07 | A first-login account is forced to change its password and then lands on its page; a wrong password and an inactive account show their messages; after logout, a direct URL shows Login and a direct API call with the old cookie returns `401`. | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-02 | E2E | AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19 | A Requester creates a ticket; IT Staff find it in the queue, claim it, raise IT Priority, move it to In Progress, post a comment and a note; the Requester sees the comment but not the note and indicates resolved; IT Staff see the marker, resolve with a summary, and close. | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-03 | E2E | AC-20, AC-21, AC-22, AC-23 | An Administrator searches, filters by role, creates an IT Staff user; that user must change the password at first sign-in; the Administrator deactivates them and their sign-in is then refused; own deactivation is prevented; IT Staff are shown Forbidden on Users. | `e2e/lab-03/user-administration.spec.ts` | Planned |
| E2E-04 | E2E | AC-10 | The Lab 2 journeys — create and find, attachments, ownership — pass after signing in, with no selector anywhere. | `e2e/lab-03/requester-regression.spec.ts` | Planned |
| RESP-01 | Responsive | AC-24 | Login, Change Password, the shell, the queue, staff Ticket Detail and User Management at 1440×900, 834×1112 and 390×844: no page-level horizontal scroll, no clipped label, no control outside the viewport, 44 px mobile targets; screenshots written to `artifacts/lab-03/screenshots/`. | `e2e/lab-03/responsive.spec.ts` | Planned |

---

## 3. Acceptance-Criterion Traceability

Every acceptance criterion in `specification.md` §9 maps to at least one planned test. This
table and the AC column above were checked against each other by script.

| AC | Planned tests |
|---|---|
| AC-01 Valid sign-in returns the identity and role | UNIT-01, API-01, UI-01, E2E-01 |
| AC-02 Pending password change blocks the application | API-04, UI-02, E2E-01 |
| AC-03 A forged `requesterId` changes nothing | API-10 |
| AC-04 Requesters are refused Internal Notes | API-08, API-23, UI-07 |
| AC-05 Invalid, inactive and throttled sign-in | UNIT-05, API-02, API-03, UI-01, E2E-01 |
| AC-06 Password change rules and session rotation | UNIT-01, UNIT-02, API-05, UI-02 |
| AC-07 Logout ends access | API-06, UI-03, E2E-01 |
| AC-08 Administrative changes and expiry end sessions | API-07, API-27 |
| AC-09 Role navigation, Forbidden, `403` before lookup, Origin check | API-09, API-11, API-12, UI-03 |
| AC-10 Lab 2 Requester journeys under sign-in | API-12, API-13, API-14, UI-03, UI-09, E2E-04 |
| AC-11 Migration preserves Lab 2 data | DB-01, DB-02, DB-03 |
| AC-12 Seed is idempotent and complete | DB-04 |
| AC-13 Queue search, filter, sort and paging | UNIT-04, API-15, API-16, UI-04, E2E-02 |
| AC-14 Ownership rules and concurrent claims | API-17, API-18, UI-05, E2E-02 |
| AC-15 IT Priority versus Requested Priority | API-19, UI-05, E2E-02 |
| AC-16 Status transition matrix and terminal freeze | UNIT-03, API-20, API-21, UI-05, E2E-02 |
| AC-17 Public Comments | UNIT-06, API-22, UI-06, UI-07, E2E-02 |
| AC-18 Internal Notes stay private | API-08, API-23, UI-06, E2E-02 |
| AC-19 Resolution indication | API-24, UI-06, UI-07, E2E-02 |
| AC-20 User list, search, role filter, create | API-25, API-26, UI-08, E2E-03 |
| AC-21 Edit and set initial password | API-27, UI-08, E2E-03 |
| AC-22 Administrator safety rules | API-28, UI-08, E2E-03 |
| AC-23 Non-Administrators refused | API-09, API-29, E2E-03 |
| AC-24 Zen Green and three viewports | STYLE-01, RESP-01 |

---

## 4. Responsive and Visual Checklist

| Viewport | Size | Required behaviour |
|---|---|---|
| Desktop | 1440×900 | Multi-column layouts; the queue table; User Management list and side panel together |
| Tablet | 834×1112 | Two columns where practical; the queue drops the Requester column; the user panel opens over the list |
| Mobile | 390×844 | Fields stack; queue and user list become cards; 44 px targets; no page-level horizontal scroll |

The checklist itself is `ui-spec.md` §13, completed against the running application.

---

## 5. Commands

```bash
# unit, API and migration — the migration test builds its own schema
cd server && npm test

# UI component and UI style
cd client && npm test

# responsive and E2E, from the repository root
npm run e2e
```

The Lab 2 isolation rules continue: Vitest resets its own schema on every run, the E2E run
uses its own schema, ports and upload directory, and `migration.test.ts` uses a third schema,
`lab3_migration_test`, which it drops when it finishes. None may be `public`.

---

## 6. Final Results

Not yet run. This section is filled from `main` after the release merge (issue #57), with
the commit, the commands and their complete output copied from the run by script.

---

## 7. Known Limitations and Deferred Tests

- **Login throttling is per process** (D-16). Restarting the API clears the counts. Tests
  cover the rule within one process; a multi-process deployment would need a shared store.
- **Retired Lab 2 suites.** `client/tests/lab-02/RequesterSelector.test.tsx` and
  `client/tests/lab-02/RequesterRouteGuard.test.tsx` tested the Development Requester
  selector, which Lab 3 removes. Their protective intent — nothing private is shown without
  an identity — moves to UI-03 and E2E-01. `server/tests/lab-02/requester-context.api.test.ts`
  tested the retired header and is replaced by API-09 and API-10. Each removal happens in the
  pull request that retires the feature, and names its replacement.
- **Session expiry** is tested by moving the stored expiry into the past, not by waiting
  eight hours.
