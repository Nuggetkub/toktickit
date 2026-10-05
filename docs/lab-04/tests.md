# Lab 4 Test Plan and Results

**Status:** Planned — no Lab 4 test has run yet
**Companion document:** [`specification.md`](./specification.md)
**Status convention:** a row reads `Planned` until that test has actually run and passed on
`main`. Nothing is marked `Passed` from a feature branch. At the release, every named file is
also checked to **exist** before its row moves. A green suite total says nothing about a file
that was never written: Lab 3's STYLE-01 and API-14 named files that did not exist, and the
release caught them only by that check.

---

## 1. Test Strategy

The Lab 2 and Lab 3 strategy carries over. Tests are derived from the acceptance criteria,
written before or alongside the code, and placed at the cheapest level that can prove the
behaviour. Lab 4 adds five emphases.

- **Rules are transcribed by hand, not imported.** The resolution gate, the Action lifecycle
  and the transition matrix are each written out independently in their unit test and
  compared with the implementation's table. A test that reads the same table as the code
  cannot notice the table drifting from the specification (the finding on Earth2509 PR #47,
  turned inward in our Lab 3 #51).
- **Every dashboard number is checked twice, independently.** First against a count the test
  computes itself with a separate Prisma query. Then by sending the card's own drill-down
  `query` to the list endpoint and comparing `totalItems`. A number that matches its own SQL
  but not the screen it links to is still wrong.
- **Races are constructed, never waited for.** The complete-versus-resolve race, the
  create-open-Action-versus-resolve race, and two edits from one version are forced. The test
  holds the Ticket row lock in its own transaction, dispatches the request (`.then()` is
  called, because supertest is lazy and a request never dispatched proves nothing), changes
  the state, and releases. Lab 3's #66 lost a review round to exactly that trap.
- **The migration is tested in both directions, on real Lab 3 data.** Apply, compare, roll
  back, compare, in a schema of its own.
- **Every new authorization, workflow, gate and concurrency test is break-proved.** Each is
  seen to fail against a deliberately broken implementation, with a no-op **control** run
  beside it (Definition of Done Part 1, item 3). A break harness that reported success
  without running any test is why the control is mandatory.

**Regression.** The Lab 1, Lab 2 and Lab 3 suites stay where they are and keep asserting
their own behaviour. A Lab 3 test may change only where a Lab 4 rule deliberately widens
behaviour, and each such change is listed in §7 with its reason:

- the status filter becomes a list (BR-30);
- `RESOLVED` now needs a completed Action (BR-19), so a Lab 3 test that resolves a Ticket
  first records one;
- the user-edit response gains a field (BR-17).

---

## 2. Planned Tests

| ID | Level | AC | Scenario and expected result | Test file | Status |
|---|---|---|---|---|---|
| UNIT-01 | Unit | AC-03, AC-05 | Action field rules, transcribed by hand from BR-03 to BR-10: each length boundary on both sides; the follow-up note required when true and refused when false; `result` required only to complete; each `actionAt` bound — before the Ticket, 5 minutes past now for completed, 365 days ahead for open; only `OPEN → COMPLETED` and `OPEN → CANCELLED` allowed, and both final states refuse every operation. Every failing field is reported, not only the first. | `server/tests/lab-04/actions-taken.test.ts` | Planned |
| UNIT-02 | Unit | AC-11, AC-12 | The gate function returns exactly the unmet conditions in BR-19, in order, for: no Actions; only cancelled; one open; completed with follow-up as the latest; completed with follow-up superseded by a later completed one; two completed sharing an `actionAt` (the id decides); reopened with no work since, and with work completed since, decided by the history order even where `completedAt` reads the other way (D-16); and all satisfied. | `server/tests/lab-04/resolution-gate.test.ts` | Planned |
| UNIT-03 | Unit | AC-22 | `currentStatus` parsing: each single status, a list of all eight, and the five active; refused for an unknown member, a repeated member, an empty value, a trailing comma, and a lower-case value. The queue parser keeps accepting every Lab 3 single value unchanged. | `server/tests/lab-04/status-filter.test.ts` | Planned |
| UNIT-04 | Unit | AC-11, AC-20 | Client helpers: the resolution-needs text built from `resolutionGate` for each combination; a card `query` turned into a `/tickets` or `/queue` URL and parsed back by the list screen into the same filters. | `client/tests/lab-04/dashboard-links.test.ts` | Planned |
| API-01 | API | AC-01 | IT Staff create a `COMPLETED` Action with valid data: `201`, stored under the path's Ticket, `createdBy` and `performedBy` are the caller, the assignee is as sent, and the Ticket's `updatedAt` moves while its `version` does not. The same as an Administrator. An `OPEN` Action has no performer. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-02 | API | AC-03 | Each invalid field in AC-03 returns `400` naming that field, and a request with four invalid fields names all four. A `performedById`, `createdById` or `createdAt` in the body is ignored. No row is written for any failure. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-03 | API | AC-04 | `assigneeId` set to an inactive IT Staff member, a Requester, or a nonexistent id returns `400` on `assigneeId`. An active IT Staff member who is not the Ticket Owner succeeds, and the Ticket's `ownerId` is unchanged. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-04 | API | AC-05 | Edit changes only the sent fields and bumps `version`. Complete sets `status`, `performedBy` = the completer (not the creator), and `completedAt`, and requires a result. Completing a planned Action dated tomorrow without a new `actionAt` is refused on `actionAt`. Cancel records canceller, time and reason. Afterwards, edit, complete and cancel each return `409 ACTION_FINAL`, even with the current version. `DELETE` returns `404`. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-05 | API | AC-06 | Two edits of one open Action from the same `version`, forced to interleave: exactly one `200`, and one `409 ACTION_VERSION_CONFLICT` carrying the current Action. The stored Action matches the winner. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-06 | API | AC-07, AC-26 | The same `Idempotency-Key` and payload sent twice gives `201`, then `200` with the same `id`, and exactly one row. The same key with a different payload returns `409 IDEMPOTENCY_KEY_CONFLICT`. A missing or non-UUID key returns `400`. Two identical creates dispatched together still produce one row. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-07 | API | AC-08 | On a `RESOLVED` Ticket, create, edit, complete and cancel each return `409 ACTION_NOT_ALLOWED`. On `CLOSED` and `CANCELLED`, `409 TICKET_TERMINAL`. Nothing changes in either case. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-08 | API | AC-09 | The owning Requester, IT Staff and an Administrator each read the list, and the Requester's response contains every field. Another Requester gets `404`. Three Actions forced to share one `actionAt` come back in `id` order, newest first. An Action id from a different Ticket returns `404 ACTION_NOT_FOUND`. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-09 | API | AC-10 | An Administrator deactivates, then separately demotes, an IT Staff member with two open Actions and one completed Action. The open ones become unassigned in the same transaction, the completed one keeps its `performedBy`, and the response reports `unassignedActionCount` and `unassignedTicketCount`. An edit of an unassigned Action without `assigneeId` is refused on it. | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| AUTH-01 | Authorization | AC-09, AC-21 | Every Lab 4 endpoint is called with no session, as each role, and with a password change pending, and returns exactly the status in §8 of the specification. Every Requester write refusal, and every refusal by the wrong dashboard, is identical for an existing and a nonexistent Ticket, since the role check precedes any lookup. The endpoint list is built once and swept, as Lab 3's `authorization.api.test.ts` does. | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| WF-01 | Workflow | AC-11, AC-12 | Resolving through the API directly, with no client involved, is refused with `409 RESOLUTION_BLOCKED` and the exact `unmet` list for: an open Action; no completed Action; a latest completed Action with follow-up; and a Ticket reopened and returned to work with nothing completed since, which succeeds once new work is completed, and is refused again after a second reopen with only the work between the two. The reopen condition holds, for work recorded finished and for planned work completed, with the API server's clock set a minute behind the database's and a minute ahead of it (D-16). The status is unchanged and no Status Event is written. Once the gate is open, the same request succeeds. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-02 | Workflow | AC-13 | Two forced interleavings. First, completing the last open Action while another request resolves: the outcome is always a serial order. Second, creating a new open Action while another request resolves: a Ticket never ends `RESOLVED` with an open Action. Break-proved by removing the row lock from the status route. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-03 | Workflow | AC-14 | All 64 status pairs from real Tickets: exactly the BR-18 transitions succeed, with a completed Action present where `RESOLVED` is the target. Every Lab 3 refusal code is returned exactly as before for the same input. The expected matrix is transcribed by hand in the test. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-04 | Workflow | AC-15 | Cancelling a Ticket with two open Actions and one completed Action cancels the two with the Ticket's reason and actor, in the same transaction, and leaves the completed one untouched. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-05 | Workflow | AC-16 | Create, then four transitions, produce five Status Events: from none to `NEW`, then each change, with actor and time from the server. Events forced to share a `createdAt` come back in `id` order. `POST`, `PATCH`, `PUT` and `DELETE` on the history path return `404`. A pre-migration Ticket reports `recordedFromCreation: false`. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-06 | Workflow | AC-17 | A Requester's indication on a Ticket with no completed Action leaves the status unchanged, and `resolutionGate.ready` stays false. Resolving is still refused. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| API-10 | API | AC-02, AC-19 | For two Requesters with different Tickets, each R-card equals an independent count over that Requester's rows only. Each list contains only their Tickets, in BR-26's order and cap, and a canary Ticket of the other Requester appears nowhere in the response. A Status Event one minute inside and one minute outside the 168-hour window is counted and not counted respectively, and a Ticket resolved twice counts once, at its later resolution. A Requester with no Tickets gets every value `0` and every list `[]`. | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-11 | API | AC-18, AC-19 | Every S-card and every breakdown row equals an independent count. `byStatus` sums to the Ticket total. Lists follow BR-27's content, order and caps, and S-3 includes no Action on a non-active Ticket. A staff member with no work gets `0` on S-2 and S-3. Each response is one snapshot: a Ticket committed while a request is paused between its reads appears in none of the reads after the pause, on both dashboards (BR-25). | `server/tests/lab-04/staff-dashboard.api.test.ts`, `server/tests/lab-04/dashboard-snapshot.api.test.ts` | Planned |
| API-12 | API | AC-20 | For every card and breakdown row on both dashboards, the card's own `query` sent to `/api/tickets` or `/api/staff/tickets` as the same user returns `totalItems` equal to its `value`. | `server/tests/lab-04/requester-dashboard.api.test.ts`, `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-13 | API | AC-21 | An Administrator's staff dashboard includes `users`, whose counts match the User table. An IT Staff member's does not include the key at all. A Requester gets `403` from the staff endpoint, and staff get `403` from the Requester endpoint. Any query parameter returns `400`. | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-14 | API | AC-22 | My Tickets and the Queue each filter by a list of statuses and return only those. A single status behaves as in Lab 3. An unknown or repeated member returns `400` naming `currentStatus`. My Tickets no longer answers "arrives in Lab 3" (issue #78). | `server/tests/lab-04/status-filter.api.test.ts` | Planned |
| API-15 | API | AC-20 | My Tickets sorts by `updatedAt` in both directions, with ties broken by Ticket Number high to low. Tickets created in one order and updated in another prove it is not the Ticket date. Another Requester's newer update never appears. An unknown `sortBy` is still `400` naming `sortBy` (D-17). | `server/tests/lab-04/my-tickets-sort.api.test.ts` | Planned |
| DB-01 | Migration | AC-23 | A schema built from the Lab 3 migrations is populated with users of each role, Tickets in every status, attachments (one removed), comments and notes. The Lab 4 migration is applied: every row and id is unchanged, and `prisma migrate diff` against `schema.prisma` is empty. The rollback script is run: the schema equals the Lab 3 schema, and every row is still unchanged. | `server/tests/lab-04/migration.test.ts` | Planned |
| DB-02 | Seed | AC-24 | After two seed runs: Tickets with zero, one and several Actions exist; every Action status and an unassigned open Action exist; Status Events exist inside the window; and Ananya Wong and Kanya Srisuk have nothing to count. There are no duplicates. An Action edited between the runs is not reverted. | `server/tests/lab-04/seed.test.ts` | Planned |
| REG-01 | Regression | AC-25 | The Lab 1, Lab 2 and Lab 3 server suites pass against the Lab 4 codebase. Any test changed because of a Lab 4 rule is listed in §7 with its reason, and no assertion is weakened. | `server/tests/lab-01/`, `server/tests/lab-02/`, `server/tests/lab-03/` | Planned |
| PERF-01 | Performance smoke | AC-29 | Against the seeded database, 50 sequential requests to each dashboard endpoint and to the Action list: the 95th percentile is under 500 ms. The measured figures are printed, so a regression is visible rather than just a pass or fail. | `server/tests/lab-04/dashboard-performance.test.ts` | Planned |
| UI-01 | UI | AC-01, AC-03, AC-05, AC-09 | Actions section: the list renders every field, and final Actions offer no controls. Add action defaults to "Record completed work" with the current user as assignee. The Follow-up note appears and becomes required only when ticked. Validation sits beneath each field. The Complete and Cancel dialogs require their text. A Requester sees the list with no controls, and no write request is ever made. | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| UI-02 | UI | AC-06, AC-26, AC-27 | A `409 ACTION_VERSION_CONFLICT` shows Reload and keeps the input. A network failure keeps every entered field, and Retry re-sends the **same** `Idempotency-Key`. A double-click on Save sends one request. | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| UI-03 | UI | AC-11, AC-14, AC-15 | The status control lists exactly the BR-18 next statuses for each of the eight, transcribed by hand. Resolved is disabled with the right "Resolution needs" lines for each `resolutionGate` combination. A server `RESOLUTION_BLOCKED` is shown with its `unmet` list and the summary is kept. Success refreshes the badge, Actions and history without a reload. Cancelling with open Actions warns how many will be cancelled. | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-04 | UI | AC-16 | The History disclosure lists events oldest first, with both statuses in words, and shows the "Earlier changes…" line only when `recordedFromCreation` is false. | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-05 | UI | AC-18, AC-19, AC-20, AC-21 | Staff dashboard: four cards, all eight status rows and all four priority rows including zeros. Each link's href is built from its `query`. The My open actions rows open their Ticket, with an Overdue marker. The Administrator's User accounts panel is shown only to them. The loading, empty, forbidden and failure states are distinct, and no stale number stays beside a failure. | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-06 | UI | AC-02, AC-19, AC-20 | Requester dashboard: four cards and three panels, with links into My Tickets. A Requester with no Tickets sees the empty message and Create Ticket. No request is ever made to `/api/dashboard/staff` or any `/api/staff` path. | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| UI-07 | UI | AC-20, AC-22 | My Tickets, the Queue and User Management read `currentStatus`, `owner`, `itPriority`, `requesterIndicated` and `role` from the URL and request exactly those filters. The Active tickets option maps to the five statuses. A later filter change replaces the URL. An invalid URL filter shows the server's refusal with Clear filters. My Tickets and the Queue also take a link's `sortBy` and `sortOrder` when the Sort control offers that pair, and otherwise keep the default. The URL follows the sort and drops both parameters at the default (D-17). The Lab 3 "Back to queue" restore still wins over the URL. | `client/tests/lab-04/DrillDownFilters.test.tsx` | Planned |
| UI-08 | UI | AC-27 | Create Ticket, the comment and note composers, the Action form and the user panel each keep every entered value after a `500` and after a network failure, and clear only on success or an explicit Cancel. | `client/tests/lab-04/FormPreservation.test.tsx` | Planned |
| UI-09 | UI | AC-27 | Requester Ticket Detail after a `409` (issue #89): a comment, upload, removal or indication refused because the Ticket changed elsewhere keeps the refusal where it happened, and the Ticket is re-read in place. While the re-read is on its way, the old Ticket stays with no "Loading". Afterwards the badge and the controls match the server. Only the latest re-read lands, and a write that succeeds after a re-read started supersedes it. A re-read that fails says so, with an in-place Retry, keeping the refusal and the draft (Earth2509, PR #105). Any other failure re-reads nothing and keeps what was typed. | `client/tests/lab-04/RequesterConflict.test.tsx` | Planned |
| STYLE-01 | UI style | AC-28 | `MetricCard` has a label, value and focus ring. `ActionStatusBadge` carries its word and tone class. The active navigation item has `aria-current="page"` and the underline class, not colour alone. The Follow-up note field has `aria-controls` wiring. | `client/tests/lab-04/ZenGreen.lab4.styles.test.tsx` | Planned |
| E2E-01 | E2E | AC-01, AC-04, AC-05, AC-09 | In a browser: IT Staff record a completed Action and plan an open one assigned to a colleague; the colleague signs in, sees it under My open actions, and completes it; an inactive user is not offered as an assignee, and a forged request with one is refused; the Requester sees both Actions read-only. | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-02 | E2E | AC-11, AC-12, AC-15, AC-16 | Resolved shows as disabled with its reasons while an Action is open; completing it enables Resolved; resolving succeeds; the History shows each change. A second Ticket, cancelled with an open Action, shows that Action cancelled. | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-03 | E2E | AC-02, AC-18, AC-20, AC-21 | For a Requester, IT Staff and an Administrator, each dashboard card clicked through lands on a list whose "Showing … of N" equals the card. The Administrator sees User accounts and IT Staff do not. A Requester opening `/queue` sees Forbidden. | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-04 | E2E | AC-25 | The Lab 2 and Lab 3 browser journeys pass against the Lab 4 application, unchanged except as §7 records. | `e2e/lab-02/`, `e2e/lab-03/` | Planned |
| E2E-05 | E2E | AC-26, AC-27 | With the create request held at the network edge, Save is clicked twice: one Action is created. With a `500` forced, the form keeps its values, and Retry succeeds with one Action. | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| RESP-01 | Responsive | AC-28 | Both dashboards, both Actions sections, the Action form and the resolution-blocked state at 1440×900, 834×1112 and 390×844: no page-level horizontal scroll, nothing clipped, 44 px mobile targets, and no console error. The screenshots are written to the paths in `ui-spec.md` §9. | `e2e/lab-04/responsive.spec.ts` | Planned |

---

## 3. Acceptance-Criterion Traceability

Every acceptance criterion in `specification.md` §9 maps to at least one planned test. This
table is **generated from the AC column above** by script, and checked against the
specification in the same run, so the two cannot disagree.

| AC | Planned tests |
|---|---|
| AC-01 An Action is created under the right Ticket, creator and assignee | API-01, UI-01, E2E-01 |
| AC-02 The Requester dashboard returns only the caller's data | API-10, UI-06, E2E-03 |
| AC-03 Invalid Action fields are refused beside each field | UNIT-01, API-02, UI-01 |
| AC-04 Assignee must be active IT Staff or Administrator | API-03, E2E-01 |
| AC-05 Edit, complete and cancel; final Actions are frozen | UNIT-01, API-04, UI-01, E2E-01 |
| AC-06 Concurrent Action edits: one wins | API-05, UI-02 |
| AC-07 Idempotent Action creation | API-06 |
| AC-08 No Action writes on resolved or terminal Tickets | API-07 |
| AC-09 Action visibility, order and role refusals | API-08, AUTH-01, UI-01, E2E-01 |
| AC-10 Deactivation unassigns open Actions | API-09 |
| AC-11 The resolution gate refuses unfinished work | UNIT-02, UNIT-04, WF-01, UI-03, E2E-02 |
| AC-12 An open gate lets a Ticket be resolved | UNIT-02, WF-01, E2E-02 |
| AC-13 Completing and resolving cannot interleave | WF-02 |
| AC-14 The 64 status pairs | WF-03, UI-03 |
| AC-15 Cancelling a Ticket cancels its open Actions | WF-04, UI-03, E2E-02 |
| AC-16 Append-only, stably ordered status history | WF-05, UI-04, E2E-02 |
| AC-17 The Requester indication stays advisory | WF-06 |
| AC-18 Staff metrics equal independent counts | API-11, UI-05, E2E-03 |
| AC-19 Zero metrics and empty states | API-10, API-11, UI-05, UI-06 |
| AC-20 Every drill-down lands on exactly what was counted | UNIT-04, API-12, API-15, UI-05, UI-06, UI-07, E2E-03 |
| AC-21 Dashboard roles and the Administrator's user counts | AUTH-01, API-13, UI-05, E2E-03 |
| AC-22 Multi-status list filters | UNIT-03, API-14, UI-07 |
| AC-23 Migration and rollback preserve Lab 3 data | DB-01 |
| AC-24 Idempotent Lab 4 seed | DB-02 |
| AC-25 Labs 1-3 regression | REG-01, E2E-04 |
| AC-26 No duplicate records from double-clicks or retries | API-06, UI-02, E2E-05 |
| AC-27 Forms keep input after recoverable failures | UI-02, UI-08, UI-09, E2E-05 |
| AC-28 Zen Green, three viewports, no console errors | STYLE-01, RESP-01 |
| AC-29 Dashboard performance smoke | PERF-01 |

---

## 4. Coverage by Required Level

Labsheet §10 requires every level below. Each is met by a named row, not by an intention.

| Level | Rows |
|---|---|
| Unit | UNIT-01 to UNIT-04 |
| API / integration | API-01 to API-15 |
| UI component | UI-01 to UI-09 |
| UI style | STYLE-01 |
| Responsive | RESP-01 |
| Authorization | AUTH-01, plus the role clauses of API-08, API-13 and UI-06 |
| Workflow | WF-01 to WF-06, UI-03, E2E-02 |
| Migration / regression | DB-01, DB-02, REG-01, E2E-04 |
| Performance smoke | PERF-01 |
| End-to-end | E2E-01 to E2E-05 |

---

## 5. Commands

Every command runs from the repository root, and none changes directory, so the block can be
pasted as it stands (Lab 3 tests.md §5).

```bash
# unit, API, authorization, workflow, migration and performance smoke
npm --prefix server test

# UI component and UI style
npm --prefix client test

# responsive and E2E
npm run e2e         # Lab 2 journeys             -> artifacts/lab-02
npm run e2e:lab3    # Lab 3 journeys             -> artifacts/lab-03
npm run e2e:lab4    # Lab 4 journeys + RESP-01   -> artifacts/lab-04
```

`e2e:lab4` and `playwright.lab4.config.ts` are added by issue #90, following the Lab 3 pattern:
the config calls the shared webServer factory, the run uses its own schema `lab4_e2e`, and it
writes under `artifacts/lab-04/`. The migration test uses its own schemas,
`lab4_migration_test` and `lab4_migration_lab3_reference`, and the seed test uses
`lab4_seed_test`, each dropped when its file finishes. None of these may be `public`.

---

## 6. Final Results

To be captured on `main` after the release (issue #91), from the run itself and never
transcribed.

---

## 7. Known Limitations and Changed Suites

- **Lab 3 tests that resolve a Ticket now record a completed Action first** (BR-19, issue #83).
  That is a deliberate change in the rule, not a weakening of the test. Each affected test calls
  `recordCompletedWork()` (`server/tests/support/tickets.ts`) as setup and keeps every
  assertion:
  - `staff-ticket-detail.api.test.ts`: the whole matrix (API-20), and "stores the resolution
    summary";
  - `comments-notes.api.test.ts`: "carries the status-change comment" and "is cleared when IT
    Staff reopen".
- **The Lab 3 staff journey records one completed Action before it resolves** (issue #83).
  `e2e/lab-03/staff-ticket-flow.spec.ts` resolves through the UI, and the Lab 3 screens have no
  way to record an Action until #85. `recordCompletedAction()` in `e2e/lab-03/support.ts` posts
  one through the real Actions API, as the signed-in staff member, from inside the page. With
  that call removed, the journey fails at "Status changed to Resolved", which shows the gate
  reaches the UI. With it, all 27 Lab 3 journeys pass.
- **Four Lab 3 suites delete their Tickets through `deleteTickets()`** (issue #83). Creating a
  Ticket or changing its status now writes a Status Event (BR-22), and every Lab 4 foreign key
  is `RESTRICT`, so a plain `ticket.deleteMany` in an `afterAll` was refused. The helper deletes
  a Ticket's Actions and history first. Touched: `authorization`, `comments-notes`,
  `staff-queue` and `staff-ticket-detail` in `server/tests/lab-03/`.
- **The race tests wait for the lock, not for a timer** (issue #83, Earth2509's note on PR
  #94). `whileHolding()` in `server/tests/support/locks.ts` releases the held row only once
  Postgres reports that the dispatched request is blocked by that transaction, counted
  transitively and filtered to the holder's own pid, so parallel test files cannot satisfy it.
  The #82 tests use it too, and each race test still fails with its lock removed.
- **Lab 3's `currentStatus` refusal of a list** becomes acceptance (BR-30). No Lab 3 test sent
  a list, so none is expected to change. This is recorded in case one does.
- **Two Lab 2 tests that pinned My Tickets' refusal of `currentStatus` now pin its rules**
  (BR-30, issue #78). Lab 2 refused the filter because every Lab 2 Ticket was `NEW`, and Lab 3
  left that refusal in place (Lab 3 API-14). Lab 4 adds the filter, so the refusal of a valid
  status had to go:
  - `server/tests/lab-02/ticket-query.test.ts` now asserts that `NEW` is accepted as `["NEW"]`
    and that `new` is still refused;
  - `server/tests/lab-02/my-tickets.api.test.ts` keeps its guarantee, that an unusable filter is
    refused rather than ignored, with an unknown status (`DONE`) instead of a valid one;
  - `client/tests/lab-02/MyTickets.test.tsx` asserted that My Tickets offers **no** Current
    Status filter. It now asserts the filter, with all eight statuses in words, and the new
    Status column, and the filter joins the "replaces the rows on screen" table.

  The full rules are UNIT-03 and API-14. Lab 3's API-14 file,
  `server/tests/lab-03/requester-tickets.api.test.ts`, which Lab 3 named and never wrote, is
  added too (see the addendum in `docs/lab-03/tests.md`).
- **One Lab 3 queue unit assertion now expects a list of one** (BR-30, issue #84).
  `server/tests/lab-03/staff-queue-query.test.ts` "accepts currentStatus=%s" read the parsed
  value as a single string. The queue now takes a list, so the parsed value is `[status]`; what
  the queue returns for a single status is unchanged, and every `staff-queue.api.test.ts` test
  passes untouched.
- **The dashboards' single snapshot is proven by pausing a request mid-read** (BR-25, from
  Earth2509's follow-up on PR #97). PR #97 recorded that no test covered it: with the
  transaction removed, every dashboard test still passed. `dashboard-snapshot.api.test.ts` now
  holds an exclusive lock on a table each dashboard reads only after its first queries, commits
  a new Ticket while the request waits there, and releases. The reads after the pause must
  still exclude that Ticket. With the transaction removed, or its isolation lowered to
  `READ COMMITTED`, both tests fail.
- **Two earlier-lab screen suites answer one more request** (issue #85). Both Ticket Detail
  screens now load the Actions taken section, and `client/tests/lab-02/RequesterTicketDetail.test.tsx`
  and `client/tests/lab-03/StaffTicketDetail.test.tsx` refuse any request they do not know.
  Each mock now answers `GET /api/tickets/42/actions` with an empty list, as Lab 3 did for the
  comments panel. No assertion changed: before the line was added, they failed only because the
  section's own "could not be loaded" alert appeared beside the alert under test.
  Issue #86 added the History disclosure, so the same two mocks also answer
  `GET /api/tickets/42/history` with an empty history. History is collapsed by default, so
  without that line the request was refused silently and every test still passed; it was added
  rather than left as a hidden failure.
- **IT Staff now land on the Dashboard, so a Lab 3 shell test and the staff journeys start
  there** (issue #87, Lab 4 ui-spec §2). `client/tests/lab-03/AppShell.test.tsx` asserted that
  IT Staff land on the Ticket Queue. It now asserts the Dashboard, with Dashboard first and
  Ticket Queue second in the navigation, and its real claim, that no Requester screen is offered
  to IT Staff, is unchanged; its mock answers the staff dashboard. In the Lab 3 browser suite,
  `STAFF.landing` is "Dashboard", a new `openQueue()` helper in `e2e/lab-03/support.ts` opens the
  queue from the navigation where a journey works from it (and `openInQueue()` uses it when not
  already there), and the two assertions of the old landing heading name the Dashboard. Before
  the change 11 of the 27 journeys failed on the landing alone; after it all 27 pass.
- **Requesters now land on the Dashboard, so Lab 2 and Lab 3 tests that began on My Tickets
  open it first** (issue #88, Lab 4 ui-spec §2). Each keeps what it asserted:
  - `client/tests/lab-03/Login.test.tsx` (two tests) and `ChangePassword.test.tsx` (one) expected
    a Requester to land on My Tickets; they now expect the Dashboard, and their mocks answer it.
    What is sent, and how, is unchanged.
  - `client/tests/lab-02/MyTickets.test.tsx`: the Current Status options gain "Active tickets".
  - `client/tests/lab-04/StaffDashboard.test.tsx` asserted that `/dashboard` refuses a Requester
    (true only until #88); it now asserts that a Requester gets their own dashboard and never
    asks for the staff one.
  - Lab 2 browser suite: `signIn()` in `e2e/lab-02/support.ts` keeps its documented contract,
    "signs in and opens My Tickets": it meets the Dashboard, then opens My Tickets from the
    navigation. All 10 journeys pass.
  - Lab 3 browser suite: the four Requester accounts' `landing` is "Dashboard", and a new
    `openMyTickets()` helper opens My Tickets in the four journeys that work from it (a search
    in the staff flow, and the loading, failure and empty-state captures, which now open My
    Tickets from the navigation where they used to reload it). Before the change 19 of 27
    journeys failed on the landing alone; after it all 27 pass, capturing the same screens.
- **Lab 3 DB-03 now applies every later migration before comparing** (issue #81).
  `server/tests/lab-03/migration.test.ts` "leaves a schema that matches schema.prisma" built
  the Lab 2 and Lab 3 migrations and compared the result with `schema.prisma`. Once Lab 4
  extended the models, that comparison could only fail. It now also applies
  `MIGRATIONS_AFTER_LAB3` (currently the Lab 4 migration alone), so it still proves what it
  was written for: the hand-edited Lab 3 SQL lines up with the models, or the chain could not
  match. Nothing is weakened. The Lab 3 assertions are untouched, and the list is where each
  future migration must be added.
- **The Lab 3 scratch-schema guard admits `lab4_*` too** (issue #81).
  `server/tests/lab-03/support.ts` refused any schema not named `lab3_*`. The Lab 4 migration
  and seed tests reuse those helpers with `lab4_migration_test`,
  `lab4_migration_lab3_reference` and `lab4_seed_test`, so the guard now accepts `lab3_*` or
  `lab4_*`. It still refuses `public` and every other name.
- **Two Lab 3 routes now lock the user they assign** (issue #82, from Earth2509's review of
  PR #94). Ticket Owner assignment (Lab 3 BR-21) and claim (Lab 3 BR-22) checked the person's
  eligibility with a plain read. A concurrent deactivation that had updated the user and cleared
  their open work, but not yet committed, was invisible to that read, so the Ticket was written
  to someone who could no longer sign in. The same shape existed in the new Action assignment.
  All three now decide under a share lock on the user's row (`src/operator-lock.ts`). A claim by
  a caller deactivated mid-request now answers `401 UNAUTHENTICATED`. No Lab 3 test changed:
  the four forced-interleaving tests that reproduce the races are new, in
  `server/tests/lab-04/actions-taken.api.test.ts`, and each failed before the fix.
- **The performance smoke test is not a benchmark.** It runs on the development machine
  against the seed, and it catches an accidental N+1 query or a missing index. It makes no
  claim about production load. The shared test schema holds no Tickets, so PERF-01 builds a
  schema of its own (`lab4_perf_test`), migrated and loaded with the demo seed, and points the
  application at it (issue #84). It fails if that seed did not load, rather than timing an
  empty database, which its first draft did.
- **The one console error left is the browser's 401 before sign-in** (issue #89). A probe
  signed in as each role, opened every screen and followed every in-app link and anchor: 54
  page loads, including both Ticket Detail screens on a Ticket with a status history, a
  completed Action and an open one. It recorded every console error and warning, page error,
  failed request, unexpected HTTP status and redirected link. Only two kinds of message
  appeared. React Router logged two v7 future-flag warnings on every page load; the client now
  opts in to both flags, and they are gone. Chromium also logs "Failed to load resource: 401"
  when the Login screen asks `GET /api/auth/me` and nobody is signed in. That 401 is the Lab 3
  contract's answer (Lab 3 api-spec §2), the browser logs it rather than the application, and
  it occurs before sign-in, on no Lab 4 screen, so AC-28 holds. Removing it would mean changing
  a Lab 3 contract for a log line. The probe was a one-off and is not committed; the Lab 4
  browser suite (issue #90) makes the console check permanent.
- **The Lab 4 browser suite runs on the demo seed, and fails on any console error** (issue
  #90). `npm run e2e:lab4` uses its own schema, `lab4_e2e`, reset on every run like Lab 3's.
  Unlike Labs 2 and 3 it also loads the demo Tickets, Actions and status history
  (`E2E_SEED=demo`, read only by `prepare-e2e.ts` and only into the guarded schema), because
  the dashboards need something to count. Every test runs under a guard in
  `e2e/lab-04/support.ts`. It fails the test on an application console error or warning, a page
  error, or an HTTP status of 400 or more that the test did not declare before provoking it: a
  forged request, a forced `500` or `503`, a real `409`. Chromium logs every such response as
  "Failed to load resource", so the guard checks the response rather than the log line. Two
  responses are declared for every test, both from signing in: the pre-sign-in
  `GET /api/auth/me` `401` (above), and the `POST /api/auth/login` `401` the shared Lab 3
  sign-in helper meets when it tries the development password on an account this run has
  already rotated. Lab 2 and Lab 3 suites are unchanged and run without the guard.
- **RESP-01 found three layout defects, all fixed, and each is now asserted** (issue #90):
  1. The Requester Dashboard's panels sat 13 px past the edge at 390 px. #104 gave
     `.zen-dashboard__lists` the grid area `lists` for the Staff Dashboard. The Requester
     Dashboard puts that element straight into `.zen-dashboard`, which names no areas, so the
     browser invented a column. The area rules now apply only inside `.zen-dashboard__panels`.
     RESP-01 asserts the Requester panels sit below the cards, as wide as they are, at every
     width.
  2. In the Actions table a Completed badge broke into "Com / plete / d". It inherited the
     cell's `overflow-wrap: anywhere`, which long descriptions need. The badge is now
     `nowrap`, and every capture fails on a badge taller than one line.
  3. Checkboxes and radios inside a `.zen-field` were styled as text boxes: full width, with a
     border. The Follow-up checkbox floated mid-row away from its label. They are now sized as
     controls, with a 44 px label. Every capture fails on one wider than 32 px.
  A fourth was found the same way. On mobile, each table cell becomes a label-and-value row,
  so the Actions Description cell's two children, the text and its Result, became two columns,
  leaving the Result a one-word strip. Each cell now holds one wrapper. Every mobile capture
  fails on a split cell, and Lab 4 STYLE-01 pins all four. The first was a regression from our
  own #104; the others date from #85.
- **Every Lab 4 browser test is break-proved, with a no-op control per spec file** (issue #90).
  The four controls pass. Seventeen breaks each turn their test red at the assertion that guards
  them:
  - E2E-01: inactive staff offered as assignees; the Requester given write controls; a My open
    actions row linking nowhere.
  - E2E-05: Save not busy while saving; a failed save offering no Retry.
  - E2E-02: Resolved offered while the gate is closed; cancelling a Ticket leaving its Action
    open.
  - E2E-03: the queue ignoring a link's owner; User Management ignoring a link's role; IT Staff
    shown User accounts.
  - RESP-01: the grid areas unscoped; the badge rule removed; checkboxes stretched; the Actions
    cells unwrapped; the metric focus ring switched off; the pre-#104 Tab order; and one
    application `console.error`.

  One first attempt stayed green, and it was a weak break, not a weak test. Setting the badge
  rule's `white-space` back to `normal` left its `overflow-wrap: normal`, which alone keeps
  "Completed" whole. Removing the whole rule, the true regression, turns RESP-01 red. Lab 4
  STYLE-01 has its own six breaks, all red with a green control. E2E-04 is the Lab 2 and Lab 3
  suites, break-proved in their own labs and green here.
