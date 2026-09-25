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
| UNIT-02 | Unit | AC-11, AC-12 | The gate function returns exactly the unmet conditions in BR-19, in order, for: no Actions; only cancelled; one open; completed with follow-up as the latest; completed with follow-up superseded by a later completed one; two completed sharing an `actionAt` (the id decides); and all satisfied. | `server/tests/lab-04/resolution-gate.test.ts` | Planned |
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
| WF-01 | Workflow | AC-11, AC-12 | Resolving through the API directly, with no client involved, is refused with `409 RESOLUTION_BLOCKED` and the exact `unmet` list for: an open Action; no completed Action; and a latest completed Action with follow-up. The status is unchanged and no Status Event is written. Once the gate is open, the same request succeeds. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-02 | Workflow | AC-13 | Two forced interleavings. First, completing the last open Action while another request resolves: the outcome is always a serial order. Second, creating a new open Action while another request resolves: a Ticket never ends `RESOLVED` with an open Action. Break-proved by removing the row lock from the status route. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-03 | Workflow | AC-14 | All 64 status pairs from real Tickets: exactly the BR-18 transitions succeed, with a completed Action present where `RESOLVED` is the target. Every Lab 3 refusal code is returned exactly as before for the same input. The expected matrix is transcribed by hand in the test. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-04 | Workflow | AC-15 | Cancelling a Ticket with two open Actions and one completed Action cancels the two with the Ticket's reason and actor, in the same transaction, and leaves the completed one untouched. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-05 | Workflow | AC-16 | Create, then four transitions, produce five Status Events: from none to `NEW`, then each change, with actor and time from the server. Events forced to share a `createdAt` come back in `id` order. `POST`, `PATCH`, `PUT` and `DELETE` on the history path return `404`. A pre-migration Ticket reports `recordedFromCreation: false`. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-06 | Workflow | AC-17 | A Requester's indication on a Ticket with no completed Action leaves the status unchanged, and `resolutionGate.ready` stays false. Resolving is still refused. | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| API-10 | API | AC-02, AC-19 | For two Requesters with different Tickets, each R-card equals an independent count over that Requester's rows only. Each list contains only their Tickets, in BR-26's order and cap, and a canary Ticket of the other Requester appears nowhere in the response. The seeded Requester with no Tickets gets every value `0` and every list `[]`. | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-11 | API | AC-18, AC-19 | Every S-card and every breakdown row equals an independent count. `byStatus` sums to the Ticket total. Lists follow BR-27's content, order and caps, and S-3 includes no Action on a non-active Ticket. A Status Event just inside and just outside the 168-hour window is counted and not counted respectively. A staff member with no work gets `0` on S-2 and S-3. | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-12 | API | AC-20 | For every card and breakdown row on both dashboards, the card's own `query` sent to `/api/tickets` or `/api/staff/tickets` as the same user returns `totalItems` equal to its `value`. | `server/tests/lab-04/requester-dashboard.api.test.ts`, `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-13 | API | AC-21 | An Administrator's staff dashboard includes `users`, whose counts match the User table. An IT Staff member's does not include the key at all. A Requester gets `403` from the staff endpoint, and staff get `403` from the Requester endpoint. Any query parameter returns `400`. | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-14 | API | AC-22 | My Tickets and the Queue each filter by a list of statuses and return only those. A single status behaves as in Lab 3. An unknown or repeated member returns `400` naming `currentStatus`. My Tickets no longer answers "arrives in Lab 3" (issue #78). | `server/tests/lab-04/status-filter.api.test.ts` | Planned |
| DB-01 | Migration | AC-23 | A schema built from the Lab 3 migrations is populated with users of each role, Tickets in every status, attachments (one removed), comments and notes. The Lab 4 migration is applied: every row and id is unchanged, and `prisma migrate diff` against `schema.prisma` is empty. The rollback script is run: the schema equals the Lab 3 schema, and every row is still unchanged. | `server/tests/lab-04/migration.test.ts` | Planned |
| DB-02 | Seed | AC-24 | After two seed runs: Tickets with zero, one and several Actions exist; every Action status and an unassigned open Action exist; Status Events exist inside the window; and Ananya Wong and Daniel Reyes have nothing to count. There are no duplicates. An Action edited between the runs is not reverted. | `server/tests/lab-04/seed.test.ts` | Planned |
| REG-01 | Regression | AC-25 | The Lab 1, Lab 2 and Lab 3 server suites pass against the Lab 4 codebase. Any test changed because of a Lab 4 rule is listed in §7 with its reason, and no assertion is weakened. | `server/tests/lab-01/`, `server/tests/lab-02/`, `server/tests/lab-03/` | Planned |
| PERF-01 | Performance smoke | AC-29 | Against the seeded database, 50 sequential requests to each dashboard endpoint and to the Action list: the 95th percentile is under 500 ms. The measured figures are printed, so a regression is visible rather than just a pass or fail. | `server/tests/lab-04/dashboard-performance.test.ts` | Planned |
| UI-01 | UI | AC-01, AC-03, AC-05, AC-09 | Actions section: the list renders every field, and final Actions offer no controls. Add action defaults to "Record completed work" with the current user as assignee. The Follow-up note appears and becomes required only when ticked. Validation sits beneath each field. The Complete and Cancel dialogs require their text. A Requester sees the list with no controls, and no write request is ever made. | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| UI-02 | UI | AC-06, AC-26, AC-27 | A `409 ACTION_VERSION_CONFLICT` shows Reload and keeps the input. A network failure keeps every entered field, and Retry re-sends the **same** `Idempotency-Key`. A double-click on Save sends one request. | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| UI-03 | UI | AC-11, AC-14, AC-15 | The status control lists exactly the BR-18 next statuses for each of the eight, transcribed by hand. Resolved is disabled with the right "Resolution needs" lines for each `resolutionGate` combination. A server `RESOLUTION_BLOCKED` is shown with its `unmet` list and the summary is kept. Success refreshes the badge, Actions and history without a reload. Cancelling with open Actions warns how many will be cancelled. | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-04 | UI | AC-16 | The History disclosure lists events oldest first, with both statuses in words, and shows the "Earlier changes…" line only when `recordedFromCreation` is false. | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-05 | UI | AC-18, AC-19, AC-20, AC-21 | Staff dashboard: four cards, all eight status rows and all four priority rows including zeros. Each link's href is built from its `query`. The My open actions rows open their Ticket, with an Overdue marker. The Administrator's User accounts panel is shown only to them. The loading, empty, forbidden and failure states are distinct, and no stale number stays beside a failure. | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-06 | UI | AC-02, AC-19, AC-20 | Requester dashboard: four cards and three panels, with links into My Tickets. A Requester with no Tickets sees the empty message and Create Ticket. No request is ever made to `/api/dashboard/staff` or any `/api/staff` path. | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| UI-07 | UI | AC-20, AC-22 | My Tickets, the Queue and User Management read `currentStatus`, `owner`, `itPriority`, `requesterIndicated` and `role` from the URL and request exactly those filters. The Active tickets option maps to the five statuses. A later filter change replaces the URL. An invalid URL filter shows the server's refusal with Clear filters. The Lab 3 "Back to queue" restore still wins over the URL. | `client/tests/lab-04/DrillDownFilters.test.tsx` | Planned |
| UI-08 | UI | AC-27 | Create Ticket, the comment and note composers, the Action form and the user panel each keep every entered value after a `500` and after a network failure, and clear only on success or an explicit Cancel. | `client/tests/lab-04/FormPreservation.test.tsx` | Planned |
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
| AC-20 Every drill-down lands on exactly what was counted | UNIT-04, API-12, UI-05, UI-06, UI-07, E2E-03 |
| AC-21 Dashboard roles and the Administrator's user counts | AUTH-01, API-13, UI-05, E2E-03 |
| AC-22 Multi-status list filters | UNIT-03, API-14, UI-07 |
| AC-23 Migration and rollback preserve Lab 3 data | DB-01 |
| AC-24 Idempotent Lab 4 seed | DB-02 |
| AC-25 Labs 1-3 regression | REG-01, E2E-04 |
| AC-26 No duplicate records from double-clicks or retries | API-06, UI-02, E2E-05 |
| AC-27 Forms keep input after recoverable failures | UI-02, UI-08, E2E-05 |
| AC-28 Zen Green, three viewports, no console errors | STYLE-01, RESP-01 |
| AC-29 Dashboard performance smoke | PERF-01 |

---

## 4. Coverage by Required Level

Labsheet §10 requires every level below. Each is met by a named row, not by an intention.

| Level | Rows |
|---|---|
| Unit | UNIT-01 to UNIT-04 |
| API / integration | API-01 to API-14 |
| UI component | UI-01 to UI-08 |
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
writes under `artifacts/lab-04/`. The migration test uses its own schema,
`lab4_migration_test`, and drops it when it finishes. None of these may be `public`.

---

## 6. Final Results

To be captured on `main` after the release (issue #91), from the run itself and never
transcribed.

---

## 7. Known Limitations and Changed Suites

- **Lab 3 tests that resolve a Ticket must now record a completed Action first** (BR-19).
  That is a deliberate change in the rule, not a weakening of the test. Each affected test
  gains the Action as setup, keeps every assertion, and is listed here by name in the pull
  request that makes the change (issue #83).
- **Lab 3's `currentStatus` refusal of a list** becomes acceptance (BR-30). No Lab 3 test sent
  a list, so none is expected to change. This is recorded in case one does.
- **The performance smoke test is not a benchmark.** It runs on the development machine
  against the seed, and it catches an accidental N+1 query or a missing index. It makes no
  claim about production load.
