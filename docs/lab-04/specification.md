# Lab 4 Sprint Engineering Specification

**Status:** Draft for peer review
**Issue:** [#80 Sprint 4 engineering contract and test plan](https://github.com/Nuggetkub/toktickit/issues/80)
**Branch:** `feature/80-engineering-contract`
**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub
**Peer reviewer:** Pattharapon Kijjanukij — 67070501069 — @Earth2509
**Extends:** [`docs/lab-03/specification.md`](../lab-03/specification.md), released on `main` at `86c30ca`

This document is the engineering contract for Sprint 4, the final sprint. It is written
before implementation and updated through the sprint. The coding agent may report a feature
"done" only when this contract and the Product Definition of Done in §10 are satisfied.
Earlier rules are cited as **Lab 2 BR-nn** and **Lab 3 BR-nn**; rules in this document are
cited as **BR-nn**.

---

## 1. Sprint Goal

Complete the service-desk workflow and finish the product. IT Staff record the actual work
on a Ticket as Actions Taken, a Ticket can be formally resolved only once that work says it
is finished, and every status change is kept in an append-only history. Requesters and IT
Staff each get a concise dashboard that leads into the detailed screens rather than
replacing them. Everything built in Labs 1 to 3 keeps working, and the whole application is
hardened and polished as one Zen Green product ready for the final demonstration.

## 2. Stakeholder Request Interpretation

Six things in the request carry weight and are treated as requirements:

1. **Actions Taken are the work log, and the Ticket Owner is the coordinator.** Many
   Actions sit under one Ticket, and each may be done by a different IT Staff member. The
   owner stays responsible for the Ticket as a whole (BR-02).
2. **Work can be planned as well as recorded.** An Action can be open (planned or under
   way) or completed, and resolution is blocked while work is unfinished. The Lab 3 sheet
   already said so: it deferred "the rule that blocks resolution while Actions Taken remain
   incomplete" to this lab. The Lab 4 grading adds assign, complete and cancel (Part 6).
3. **Completed work is not rewritten.** An open Action is editable. A completed or cancelled
   one is frozen, and a correction is a new Action. This reconciles "create and update" in
   the request with the "append-only behaviour" that Part 7 grades (D-02).
4. **Requesters signal; IT Staff decide.** Lab 3 BR-05 carries over unchanged: the
   Requester's "Problem Appears Resolved" is advisory, and only IT Staff or an Administrator
   resolve a Ticket, through the server-enforced gate in BR-19.
5. **Dashboards summarise; they do not replace.** Each count is calculated by the server
   from authoritative data, has a defined empty value, and links to the list or Ticket it
   summarises. A dashboard never returns whole Ticket collections.
6. **Nothing earlier may regress.** Authentication, authorization, ownership, comments,
   notes, attachments and user management keep their Lab 2 and Lab 3 contracts, proven by
   those labs' suites running unchanged in behaviour alongside Lab 4's.

The request does not settle the Action lifecycle, the resolution gate, what a Requester
sees of an Action, or the dashboard calculations. This document settles them, and §11
records each decision.

## 3. Scope

### Included

- Actions Taken: list, create, edit while open, complete, cancel, with an assignee and an
  automatic Performed by.
- The resolution gate, the final status transition matrix, and an append-only Ticket status
  history.
- Requester, IT Staff and Administrator dashboards, with calculations and drill-down.
- A multi-value `currentStatus` filter on My Tickets and the Ticket Queue, which the
  dashboard drill-downs need. The My Tickets half is issue #78, which Lab 3 left open.
- One additive migration with a tested rollback, and an extended idempotent seed.
- Final hardening across every screen from Labs 2 to 4: consistent feedback, protection
  against duplicate submission, preserved form data, removal of leftovers, and a current
  README.
- Automated unit, API, authorization, workflow, migration/regression, UI component, UI
  style, responsive, performance-smoke and end-to-end tests.

### Excluded

Labsheet §4.2, restated so that none of it creeps in:

- Automatic SLA clocks, escalation engines, on-call scheduling, breach notifications.
- Email, SMS, LINE, push or any other external notification.
- Inventory, spare parts, purchasing, and cost accounting for services.
- Time-sheet billing, payroll, and labour-cost calculation. An Action records *when*, not
  *how long*.
- Multi-level approval workflows and electronic signatures.
- Business-intelligence tools, custom report builders, exports, charts beyond simple counts,
  and period-over-period comparisons such as "+3 from yesterday" (D-09).
- Multi-tenant organisations and production-scale cloud operations.
- File upload on an Action. Attachment Notes is text that points at a file; files are still
  uploaded through the Lab 2 attachment feature (D-05).
- Any feature not approved in this contract.

### Where the labsheet contradicts itself

| Labsheet says | Also says | Resolution |
|---|---|---|
| An Action has seven fields (§3, §4.1, §8.3), none of them an assignee or a status | Part 6 grades "assign, … complete, cancel, … inactive-assignee rejection"; AC-01 names an "approved assignee"; the Lab 3 sheet blocks resolution "while Actions Taken remain incomplete" | The seven fields are kept exactly, and an **Assignee** and an **Action Status** are added. Every graded behaviour is then real. D-01 |
| "Create and update Actions Taken" (§1) | Part 7 grades "append-only behaviour" | An open Action is editable. Completed and cancelled Actions and the status history are append-only. D-02 |
| "Action Date/Time" (§3) | "Action create date/time" (§8.3) | Two fields: **Action Date/Time**, supplied by the user for when the work happened or is planned, and **Recorded At**, set by the server. D-03 |
| "View … where approved by the specification" (§4.3) | "Requesters will see all Actions Taken items" (§8.3) | The owning Requester sees every Action and every field, and the form says so beside the fields. D-04 |
| The resolution rule must be enforced (§4.5) | It is never defined | BR-19 defines it. |
| The mockups show period deltas, Quick Actions and a "TikTockIT" name | The text asks for concise, defined metrics | The text wins. Deviations are listed in [`ui-spec.md`](./ui-spec.md). D-09 |

## 4. Functional Requirements

### Actions Taken

- **FR-01** IT Staff and Administrators shall create an Action Taken on a Ticket, either
  already completed or open for later completion.
- **FR-02** IT Staff and Administrators shall edit an open Action, complete it, or cancel it
  with a reason.
- **FR-03** An Action shall be assigned to an active IT Staff or Administrator user, who may
  differ from the Ticket Owner.
- **FR-04** Every role that can read a Ticket shall see its Actions Taken, in a stable order.

### Ticket workflow

- **FR-05** The server shall allow only the transitions in the final matrix (BR-18), and
  shall refuse `RESOLVED` while the resolution gate is closed (BR-19).
- **FR-06** Every status change shall be recorded in an append-only history, readable by
  every role that can read the Ticket.
- **FR-07** The status control shall offer only permitted transitions, explain why Resolved
  is unavailable before it is attempted, and refresh the Ticket after a change.

### Dashboards

- **FR-08** A Requester shall see a dashboard of their own Tickets only.
- **FR-09** IT Staff shall see an operational dashboard that includes the Actions assigned to
  them.
- **FR-10** An Administrator shall see the IT Staff dashboard plus concise user-account
  counts.
- **FR-11** Every dashboard count shall link to the filtered list it counts, and every
  listed Ticket to its Ticket Detail.
- **FR-12** My Tickets and the Ticket Queue shall filter by one or more statuses at once.

### Hardening and regression

- **FR-13** Every Lab 2 and Lab 3 function shall keep working for its permitted roles.
- **FR-14** A repeated click or network retry shall not create a second record or apply a
  change twice.
- **FR-15** An important form shall keep what the user entered after a recoverable failure.
- **FR-16** Every screen shall show consistent loading, validation, success, empty,
  no-results, forbidden, conflict, not-found and safe-failure feedback at desktop, tablet
  and mobile widths.
- **FR-17** No console error, broken link, placeholder text, unfinished control, or
  temporary or duplicate element shall remain in the application.
- **FR-18** The README shall describe setup, migration, seed, testing and the demonstration
  accurately for a fresh clone.

## 5. Business Rules

### Actions Taken: structure

- **BR-01** An Action Taken belongs to exactly one Ticket. The Ticket is fixed when the
  Action is created and can never change.
- **BR-02** The Ticket Owner coordinates the Ticket, but an Action Taken may be assigned to,
  and performed by, a different IT Staff member or Administrator. Creating, assigning or
  completing an Action never changes the Ticket Owner.
- **BR-03** An Action has these fields:

| Field | Source | Rule |
|---|---|---|
| Action Date/Time | User | Required. When the work happened, or when it is planned. See BR-07. |
| Action Description | User | Required. 5 to 2000 characters after trimming. |
| Result | User | Required to complete (5 to 2000 after trimming); optional while open (at most 2000). |
| Performed by | **Server** | Set to the user who completes the Action. Empty while it is open. |
| Follow-Up Required? | User | Required, `true` or `false`. |
| Follow-up Note | User | Required when follow-up is required: 5 to 1000 characters after trimming. See BR-09. |
| Attachment Notes | User | Optional. At most 500 characters. See BR-10. |
| Assignee | User | Required. See BR-06. |
| Action Status | Server | `OPEN`, `COMPLETED` or `CANCELLED`. See BR-04. |
| Cancellation Reason | User | Required to cancel: 5 to 500 characters after trimming. |
| Recorded by, Recorded At, Last Updated | **Server** | The creating user and the creation and last-change times. |

  Free text is rendered as plain text with line breaks kept, never as HTML (as Lab 3 BR-36).
  An author, performer, status or time sent in a request is ignored.

### Actions Taken: lifecycle

- **BR-04** An Action is created as `OPEN` or directly as `COMPLETED`. Only `OPEN →
  COMPLETED` and `OPEN → CANCELLED` are permitted. `COMPLETED` and `CANCELLED` are final.
- **BR-05** Performed by is set by the server in the same write that makes the Action
  `COMPLETED`: the creating user when it is created completed, otherwise the user who
  completes it. A cancelled Action has no performer. Its canceller and time are recorded
  instead.
- **BR-06** The assignee must be an active `IT_STAFF` or `ADMINISTRATOR` user at the moment
  of assignment. Anyone else — an inactive user, a Requester or an unknown id — answers
  `400 VALIDATION_FAILED` with a field error on `assigneeId`. This is the same rule as the
  Ticket Owner (Lab 3 BR-21, BR-22). The interface pre-selects the current user.
- **BR-07** Action Date/Time is an ISO 8601 instant with an offset. It must not be before the
  Ticket was created. A `COMPLETED` Action's time must not be more than 5 minutes after the
  server's clock (a small allowance for clock skew). An `OPEN` Action may be up to 365 days
  in the future, because planned work is part of the log.
- **BR-08** Only an `OPEN` Action can be edited, and only its user fields and assignee.
  Editing, completing or cancelling a final Action answers `409 ACTION_FINAL`. A mistake in
  completed work is corrected by recording a new Action.
- **BR-09** When Follow-Up Required is `true`, the Follow-up Note is required. When it is
  `false`, a non-empty note is refused with a field error, never silently discarded. Clearing
  the flag on an open Action requires clearing the note as well.
- **BR-10** Attachment Notes is a free-text pointer, such as "screenshot `error-0512.png` in
  the ticket's attachments". It is not an upload, and the server does not check it against
  the Ticket's attachments.
- **BR-11** Actions are listed by Action Date/Time, newest first, with the Action id as the
  tie-breaker, so the order is stable even when two Actions share a time. This matches the
  newest-first order of comments and notes (Lab 3 D-17).

### Actions Taken: when, who and concurrency

- **BR-12** Actions can be created, edited, completed or cancelled only while the Ticket is
  `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER` or `REOPENED`. On a `RESOLVED`
  Ticket the answer is `409 ACTION_NOT_ALLOWED`: reopen the Ticket to record more work. On a
  terminal Ticket it is `409 TICKET_TERMINAL` (Lab 3 BR-27).
- **BR-13** Editing, completing and cancelling carry the Action `version` the client last
  read. A mismatch answers `409 ACTION_VERSION_CONFLICT` with the current Action and changes
  nothing, and success increments `version`. Action writes update the Ticket's Last Updated
  but not the Ticket `version`, so recording work never invalidates someone's pending
  status change (as comments do, Lab 3 BR-24).
- **BR-14** Every Action write, and every status change, locks the Ticket row
  (`SELECT … FOR UPDATE`) and decides under that lock. Completing an Action and resolving the
  Ticket therefore cannot interleave, and the gate in BR-19 always sees committed Actions.
- **BR-15** Creating an Action requires an `Idempotency-Key` header holding a
  client-generated UUID. A replay with the same key and an identical payload returns the
  original Action with `200`. The same key with a different payload answers
  `409 IDEMPOTENCY_KEY_CONFLICT`. This is the Lab 2 ticket-creation rule applied to Actions.
- **BR-16** The owning Requester, IT Staff and Administrators can read a Ticket's Actions.
  The Requester sees every Action and every field. A Requester asking for another
  Requester's Ticket gets `404`, identical to a missing Ticket (Lab 3 BR-19). Only IT Staff
  and Administrators write Actions, and anyone else gets `403 FORBIDDEN` before any lookup
  (Lab 3 BR-18). Private information belongs in an Internal Note, and the Action form says
  so.
- **BR-17** Deactivating a user, or changing their role to `REQUESTER`, clears the assignee
  on every `OPEN` Action assigned to them, in the same transaction that already unassigns
  their Tickets (Lab 3 BR-25). Recorded by and Performed by are history and never change.
  The response adds the number of Actions unassigned. An unassigned open Action shows as
  Unassigned, and it must be given an eligible assignee when it is next edited. It may be
  completed or cancelled as it is.

### Ticket status and resolution

- **BR-18** The eight statuses, their meanings and the transition matrix are Lab 3 BR-26 and
  BR-29, unchanged:

| From | Allowed next statuses | Who |
|---|---|---|
| `NEW` | `OPEN`, `IN_PROGRESS`, `CANCELLED` | IT Staff, Administrator |
| `OPEN` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` | IT Staff, Administrator |
| `IN_PROGRESS` | `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` | IT Staff, Administrator |
| `WAITING_FOR_REQUESTER` | `IN_PROGRESS`, `RESOLVED`, `CANCELLED` | IT Staff, Administrator |
| `RESOLVED` | `CLOSED`, `REOPENED` | IT Staff, Administrator |
| `REOPENED` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` | IT Staff, Administrator |
| `CLOSED` | none | — |
| `CANCELLED` | none | — |

  A Requester changes no status. Owner-required statuses (Lab 3 BR-28), the required summary
  or reason (Lab 3 BR-30) and version checking (Lab 3 BR-24) all still apply.
- **BR-19 — the resolution gate.** Entering `RESOLVED` additionally requires, evaluated
  under the Ticket row lock:
  1. no `OPEN` Action on the Ticket;
  2. at least one `COMPLETED` Action; and
  3. the latest `COMPLETED` Action (by Action Date/Time, then id) does not require
     follow-up.

  If any condition fails, the answer is `409 RESOLUTION_BLOCKED`, listing every failed
  condition. Nothing changes. Cancelled Actions count toward none of the three.
- **BR-20** The gate applies only on entering `RESOLVED`. `RESOLVED → CLOSED` has no gate,
  so a Ticket resolved before this migration can still be closed. Cancelling a Ticket
  cancels each of its `OPEN` Actions in the same transaction, with the Ticket's cancellation
  reason and the acting user, so no open work is left on a frozen Ticket.
- **BR-21** The Requester's "Problem Appears Resolved" indication (Lab 3 BR-32, BR-33) is
  unchanged. It does not satisfy the gate, and it does not change the status.

### Status history

- **BR-22** Creating a Ticket and every status change append one Status Event (from status,
  to status, acting user, time) in the same transaction as the change. Creation is recorded
  as from none to `NEW`, with the Requester as the actor. No endpoint edits or deletes a
  Status Event.
- **BR-23** The history is returned oldest first, with the id as the tie-breaker, because it
  reads as a timeline from creation. It is readable by every role that can read the Ticket,
  and it contains no Internal Note content.
- **BR-24** Tickets that existed before the migration have no recorded history before it.
  The migration invents none (D-07). Their history begins with the first change after the
  migration. When a Ticket's first event is not its creation, the interface says "Earlier
  changes were made before history was recorded", rather than implying there were none.
  The test is structural: an event with no `fromStatus` exists only for Tickets created
  after the migration.

### Dashboards

- **BR-25** Common rules:
  - Every value is calculated by the server. Each response reads one consistent snapshot
    (a single read-only `REPEATABLE READ` transaction), so a card and its breakdown always
    agree.
  - Every metric is present in every response. A metric with nothing to count is `0`, and a
    list with nothing in it is `[]`. Neither is omitted.
  - Lists are capped at the stated length and never paginated. Each list comes with the
    total it was cut from.
  - **Active** means `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER` or `REOPENED`.
    `RESOLVED` is not active: the work is finished and awaits closure.
  - Time windows are rolling, measured back from the server's current instant — "the last
    7 days" means the last 168 hours. No calendar-day boundary, and therefore no time zone,
    enters any calculation. Times are returned as UTC ISO 8601 and shown in the viewer's
    local time (D-08).
  - No response contains Internal Note content, a password hash, a session token or a
    storage key.
- **BR-26** The Requester dashboard counts only Tickets whose Requester is the signed-in
  user:

| Id | Metric | Calculation | Drill-down |
|---|---|---|---|
| R-1 | My active Tickets | status is active | My Tickets, `currentStatus` = the five active statuses |
| R-2 | Waiting for me | status `WAITING_FOR_REQUESTER` | My Tickets, `currentStatus=WAITING_FOR_REQUESTER` |
| R-3 | Resolved, awaiting closure | status `RESOLVED` | My Tickets, `currentStatus=RESOLVED` |
| R-4 | Resolved in the last 7 days | distinct Tickets with a Status Event into `RESOLVED` in the last 168 hours | the "Recently resolved" list on the dashboard |

  | List | Content | Order | Cap |
  |---|---|---|---|
  | Needs your attention | Tickets `WAITING_FOR_REQUESTER`, then `RESOLVED` | that status order, then Last Updated newest first, then id | 5 |
  | Recently updated | all own Tickets | Last Updated newest first, then id | 5 |
  | Recently resolved | own Tickets whose latest Status Event into `RESOLVED` is in the last 168 hours | that event, newest first, then Ticket id | 5 |

- **BR-27** The IT Staff dashboard counts across all Tickets, except where it names the
  signed-in user:

| Id | Metric | Calculation | Drill-down |
|---|---|---|---|
| S-1 | Unassigned active | no owner, status active | Queue, `owner=unassigned` + active statuses |
| S-2 | My active Tickets | owner is me, status active | Queue, `owner=me` + active statuses |
| S-3 | My open Actions | Actions `OPEN` and assigned to me | the "My open Actions" list; each row opens its Ticket |
| S-4 | Requester says resolved | indication set, status active | Queue, `requesterIndicated=true` + active statuses |
| S-5 | Tickets by status | one count for each of the eight statuses, zeros included | Queue, `currentStatus=<that status>` |
| S-6 | Active Tickets by IT Priority | one count for each of the four priorities, among active Tickets | Queue, `itPriority=<that priority>` + active statuses |

  | List | Content | Order | Cap |
  |---|---|---|---|
  | My open Actions | S-3's Actions, with Ticket Number and Summary | Action Date/Time oldest first — the most overdue first — then id | 10 |
  | Urgent active Tickets | active Tickets with IT Priority `URGENT` | Last Updated oldest first — longest waiting first — then id | 5 |
  | Recently updated | all Tickets | Last Updated newest first, then id | 10 |

  By BR-12 and BR-20, an open Action exists only on an active Ticket, so S-3 needs no status
  condition. The API test asserts this invariant rather than assuming it.
- **BR-28** The Administrator receives the IT Staff dashboard with S-2 and S-3 for
  themselves, plus a user-account block: active and inactive counts for each of the three
  roles, each drilling to User Management filtered by that role.
- **BR-29** The Requester dashboard endpoint admits only `REQUESTER`, and the staff endpoint
  only `IT_STAFF` and `ADMINISTRATOR`. Anyone else gets `403 FORBIDDEN` before any query
  runs. The user-account block appears only in an Administrator's response.
- **BR-30** `currentStatus` on My Tickets and on the Ticket Queue accepts one status or a
  comma-separated list of distinct statuses. Any unknown or repeated member answers
  `400 VALIDATION_FAILED`, and the filter is never silently dropped (Lab 2 BR-27). Every
  drill-down is a real query against the list endpoint. The test sends each drill-down's
  parameters and asserts that the list's `totalItems` equals the card.

### Hardening

- **BR-31** Duplicate submission:
  - Ticket and Action creation are idempotent on the server (Lab 2 BR-19 for Tickets, BR-15 for Actions).
  - Status, owner, IT Priority and Action changes are guarded by version, so a retried
    change cannot apply twice. The retry answers `409` with the current record, and the
    interface shows that record rather than an error when it already matches what the user
    asked for.
  - Comments, notes, the indication and uploads disable their submit control while a request
    is pending.
- **BR-32** After a validation error, a conflict, a network failure or a `5xx`, a form keeps
  everything the user entered. Only a success or an explicit Cancel clears it.
- **BR-33** Lab 2 BR-01 to Lab 2 BR-45 and Lab 3 BR-01 to Lab 3 BR-47 remain in force, with these
  changes:
  - Lab 3 BR-25 is extended by BR-17.
  - Lab 3 BR-29 is kept, and BR-19 is added to it.
  - Lab 3 BR-30 is kept. A Ticket cancellation also cancels its open Actions (BR-20).
  - Lab 3's single-status filter (FR-08, and `currentStatus` on the queue) is widened by
    BR-30.

### Migration and seed

- **BR-34** The migration only adds: one enum, two tables, their indexes and foreign keys.
  No existing column, value or id changes. Every Ticket that exists at migration time has
  zero Actions and no Status Events.
- **BR-35** The seed stays idempotent (Lab 3 BR-44). Actions and Status Events are created
  only for seeded Tickets that have none, keyed so that a second run creates nothing and a
  record edited between runs is not reverted. The seed provides:
  - Tickets with zero, one and several Actions;
  - Actions in every Action status, including one open Action whose assignee was cleared by a
    deactivation;
  - Status Events consistent with each seeded Ticket's status, some inside the 7-day window;
  - a Requester (Ananya Wong) and an IT Staff member (Daniel Reyes) for whom every personal
    metric is zero.

## 6. UI Specification Summary

The full contract is [`ui-spec.md`](./ui-spec.md). Lab 4 reuses every Lab 2 and Lab 3 token,
badge, button variant, table-to-card pattern, breakpoint, announcement rule and
accessibility rule unchanged. It adds:

- **Navigation.** Dashboard becomes the first navigation item and the landing page for
  Requesters and IT Staff, with the active page marked by more than colour. The
  Administrator lands on User Management as before, and has Dashboard in their navigation.
- **Metric cards.** Each card is a single link: a label, a value, and an accessible name
  that includes both ("Waiting for me: 2 Tickets"). Cards wrap from one row on desktop to
  two columns on tablet and one on mobile. The dashboards show loading, empty, forbidden and
  safe-failure states.
- **Actions Taken on Ticket Detail.** A section below the Ticket facts: a table on desktop
  and cards below 768 px. Staff get Add Action, and an Edit, Complete or Cancel panel per
  Action. The Follow-up Note field appears only when follow-up is required. A note beside
  the fields says "Visible to the Requester". A final Action shows read-only with its
  Action Status badge. The Requester sees the same list read-only, with no controls.
- **Workflow.** The status control lists only BR-18's next statuses. When the gate is
  closed, Resolved is shown disabled with the unmet conditions written beneath it, before
  it is attempted, and the server's `RESOLUTION_BLOCKED` is still shown if the client was
  stale. A History section lists Status Events as a timeline.

## 7. Data Changes

### Models

| Model | Change | Fields |
|---|---|---|
| `ActionTaken` | New | `id`, `ticketId`, `actionAt`, `description`, `result` (nullable), `followUpRequired`, `followUpNote` (nullable), `attachmentNotes` (nullable), `status`, `assigneeId` (nullable FK `User`), `performedById` (nullable FK `User`), `createdById` (FK `User`), `cancelledById` (nullable FK `User`), `cancellationReason` (nullable), `completedAt` (nullable), `cancelledAt` (nullable), `version` (default 1), `idempotencyKey` (unique), `createdAt`, `updatedAt` |
| `TicketStatusEvent` | New | `id`, `ticketId`, `fromStatus` (nullable), `toStatus`, `actorId` (FK `User`), `createdAt` |
| `Ticket`, `User` and every other model | Unchanged | Only the reverse relations are added |

`assigneeId` is nullable only because of BR-17. The API never accepts a null assignee.

### Enum

```prisma
enum ActionStatus { OPEN COMPLETED CANCELLED }   // declared in lifecycle order
```

### Relationships

- `Ticket` 1—∞ `ActionTaken` (BR-01) and 1—∞ `TicketStatusEvent`
- `User` 1—∞ `ActionTaken` as assignee, performer, creator and canceller, as four named
  relations
- `User` 1—∞ `TicketStatusEvent` as actor

### Constraints and indexes

| Decision | Reason |
|---|---|
| Index `ActionTaken(ticketId, actionAt DESC, id DESC)` | Every Ticket Detail read is one Ticket's Actions in BR-11's order. The same index serves the gate's "latest completed" lookup. |
| Index `ActionTaken(assigneeId, status)` | S-3 and the "My open Actions" list, and BR-17's unassignment. |
| Unique `ActionTaken.idempotencyKey` | BR-15 replay detection, as on `Ticket` since Lab 2. |
| Index `TicketStatusEvent(ticketId, createdAt, id)` | The history read, oldest first. |
| Index `TicketStatusEvent(toStatus, createdAt)` | R-4 and "Recently resolved": the events into `RESOLVED` within a window. |
| Index `Ticket(requesterId, currentStatus)` | Every Requester dashboard count filters on exactly this pair. |
| `CHECK` constraints on `ActionTaken` | `COMPLETED` implies `performedById`, `completedAt` and `result` are set. `CANCELLED` implies `cancelledById`, `cancelledAt` and `cancellationReason` are set. `followUpRequired = false` implies `followUpNote IS NULL`. The database refuses a state the rules forbid, even from a code path that forgets one. |
| `ON DELETE RESTRICT` on every new foreign key | Nothing deletes Tickets or Users (Lab 3 §7). |

**Justified design decision 1 — a status history table rather than the comment thread.**
Lab 3 D-10 made status-change comments double as history, but only `RESOLVED`, `CANCELLED`
and `REOPENED` post a comment, so `NEW → OPEN` or `OPEN → IN_PROGRESS` left no trace. The
dashboards also need the time a Ticket entered `RESOLVED`, which a comment's text cannot
give reliably. A narrow, append-only `TicketStatusEvent` table records every transition with
a typed from and to, is indexable by target status and time, and is what Part 7's
append-only and stable-ordering behaviour is tested against. Status-change comments stay as
they are: they are the Requester's explanation, not the audit record.

**Justified design decision 2 — an explicit Action lifecycle with frozen final states,
rather than freely editable rows.** An editable completed Action could be rewritten after the
Ticket was resolved on the strength of it, and nothing would show that the record changed.
Freezing `COMPLETED` and `CANCELLED` makes the log trustworthy without the full revision
history that labsheet §4.2's exclusions point away from. Keeping `OPEN` editable still lets
staff plan and refine work before it is done.

**Justified design decision 3 — separate Recorded by, Assignee and Performed by.** They
answer three different questions: who wrote the entry, who is responsible for doing the
work, and who actually did it. BR-02 exists because these differ in practice, and folding
any two into one column loses exactly the distinction the stakeholder asked for.

### Migration and backfill

One migration, `lab4_actions_and_history`, additive only (BR-34):

1. Create the `ActionStatus` enum.
2. Create `ActionTaken` and `TicketStatusEvent` with their foreign keys, indexes and `CHECK`
   constraints.
3. Create the index `Ticket(requesterId, currentStatus)`.

**Backfill: none, by decision (D-07).** Existing Tickets start with no Actions and no
history. What that means for behaviour:

- A legacy `RESOLVED` Ticket can still be closed (BR-20).
- A legacy Ticket that is later reopened, or is still active, must pass the gate like any
  other.
- R-4 and "Recently resolved" count only resolutions recorded after the migration.

**Rollback.** The migration adds but never alters, so a reverse script is safe. It drops the
two tables, the enum and the new index, and nothing that existed in Lab 3 is lost. It lives at
`server/prisma/rollback/20260925_lab4_actions_and_history.down.sql`. The migration test
applies the migration to a populated Lab 3 database, runs the rollback, and asserts that the
schema matches Lab 3's `schema.prisma` exactly and every Lab 3 row is intact. A rollback does
lose all Actions and history recorded since, so a backup is taken first, as in Lab 3.

## 8. API Contract

The full contract is [`api-spec.md`](./api-spec.md). The Lab 3 conventions carry over
unchanged: the Origin check, the check order (Lab 3 api-spec §1, steps 1–7), the error
envelope, `400` with `fieldErrors`, and `404` for an ownership refusal. Lab 4 adds:

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/tickets/:ticketId/actions` | owning Requester, IT Staff, Administrator | List Actions (BR-11, BR-16) |
| `POST /api/tickets/:ticketId/actions` | IT Staff, Administrator | Create, open or completed; needs `Idempotency-Key` |
| `PATCH /api/tickets/:ticketId/actions/:actionId` | IT Staff, Administrator | Edit an open Action; needs `version` |
| `POST /api/tickets/:ticketId/actions/:actionId/complete` | IT Staff, Administrator | Complete; needs `version` and `result` |
| `POST /api/tickets/:ticketId/actions/:actionId/cancel` | IT Staff, Administrator | Cancel; needs `version` and `reason` |
| `GET /api/tickets/:ticketId/history` | owning Requester, IT Staff, Administrator | Status Events, oldest first |
| `GET /api/dashboard/requester` | Requester | BR-26 |
| `GET /api/dashboard/staff` | IT Staff, Administrator | BR-27, and BR-28 for an Administrator |

It also alters:

- `GET /api/tickets/:ticketId` for IT Staff and Administrators gains
  `resolutionGate: { open, completed, latestFollowUpRequired, ready }`, so the interface can
  explain the gate before it is attempted. The server still decides under the lock.
- `POST /api/tickets/:ticketId/status` may answer `409 RESOLUTION_BLOCKED` with
  `details.unmet`: any of `OPEN_ACTIONS` (with a count), `NO_COMPLETED_ACTION` and
  `FOLLOW_UP_REQUIRED` (with the Action id).
- `currentStatus` accepts a list (BR-30).
- `PATCH /api/admin/users/:userId` reports `unassignedActionCount` beside the existing
  `unassignedTicketCount` (BR-17).

New error codes:

| Status | Code |
|---|---|
| `404` | `ACTION_NOT_FOUND` — also for an Action that exists on a different Ticket |
| `409` | `ACTION_VERSION_CONFLICT`, `ACTION_FINAL`, `ACTION_NOT_ALLOWED`, `RESOLUTION_BLOCKED` |

## 9. Acceptance Criteria

### Actions Taken

- **AC-01** Given a permitted IT Staff user and valid data, when an Action Taken is created,
  then it is saved under the correct Ticket with the authenticated user as Recorded by and
  the approved assignee, and, if it was created completed, with that user as Performed by.
- **AC-02** Given an authenticated Requester, when dashboard data is retrieved, then only
  metrics and recent Tickets owned by that Requester are returned.
- **AC-03** Given an IT Staff user, when an Action is created with a missing or out-of-range
  field, a follow-up without a note, a note without a follow-up, a time before the Ticket
  existed, or a completed Action dated in the future, then it is refused with a field error
  for each failing field and nothing is saved.
- **AC-04** Given an Action, when it is assigned to an inactive user, a Requester or an
  unknown id, then it is refused on `assigneeId`. When it is assigned to an active IT Staff
  member who is not the Ticket Owner, then it succeeds and the Ticket Owner is unchanged.
- **AC-05** Given an open Action, when it is edited, completed with a result, or cancelled
  with a reason, then the change is saved, Performed by is set only on completion, and a
  completed or cancelled Action then refuses every further change with `ACTION_FINAL`.
- **AC-06** Given two users editing one open Action, when both submit from the same version,
  then exactly one succeeds and the other receives `ACTION_VERSION_CONFLICT` with the
  current Action.
- **AC-07** Given an Action create request, when it is sent twice with the same
  `Idempotency-Key`, then one Action exists and both responses describe it. When the second
  request's payload differs, then it is refused.
- **AC-08** Given a `RESOLVED` Ticket or a terminal Ticket, when any Action write is
  attempted, then it is refused with `ACTION_NOT_ALLOWED` or `TICKET_TERMINAL` and nothing
  changes.
- **AC-09** Given a Ticket with several Actions, when its owning Requester, IT Staff or an
  Administrator lists them, then all are returned in BR-11's order, including when two share
  a time. Another Requester receives `404`, and a Requester attempting any Action write
  receives `403` before any lookup.
- **AC-10** Given an IT Staff member with open Actions, when an Administrator deactivates
  them, then those Actions become unassigned in the same transaction, their completed
  Actions keep their performer, and the response reports both counts.

### Ticket workflow

- **AC-11** Given a Ticket with an open Action, with no completed Action, or whose latest
  completed Action requires follow-up, when IT Staff resolve it — through the interface or
  directly through the API — then it is refused with `RESOLUTION_BLOCKED`, naming each unmet
  condition, and the status is unchanged.
- **AC-12** Given a Ticket whose gate is open, when IT Staff resolve it with a valid summary,
  then it becomes `RESOLVED`.
- **AC-13** Given a Ticket, when completing its last open Action and resolving it happen at
  the same moment, then the outcome is one of the serial orders, never a resolved Ticket that
  still has an open Action.
- **AC-14** Given a Ticket in each of the eight statuses, when each of the 64 status pairs is
  attempted, then exactly BR-18's transitions succeed and every other pair is refused.
- **AC-15** Given a Ticket with open Actions, when it is cancelled, then those Actions become
  `CANCELLED` with the Ticket's reason in the same transaction.
- **AC-16** Given a sequence of status changes, when the history is read, then there is one
  event per change plus creation, in a stable oldest-first order, with actor and time from
  the server, and no endpoint can edit or delete one.
- **AC-17** Given a Requester's "Problem Appears Resolved" indication, when it is recorded,
  then the status is unchanged and the gate is not satisfied by it.

### Dashboards

- **AC-18** Given seeded data, when the IT Staff dashboard is retrieved, then every metric
  from S-1 to S-6 equals an independent database count, and the lists follow BR-27's content,
  order and caps.
- **AC-19** Given a Requester or IT Staff user with nothing to count, when their dashboard is
  retrieved, then every metric is `0` and every list is empty, and the screen shows its empty
  state rather than an error.
- **AC-20** Given any dashboard card, when its drill-down is followed, then the list shows
  exactly the Tickets that were counted.
- **AC-21** Given an Administrator, when the staff dashboard is retrieved, then it includes
  the user-account counts. Given IT Staff, then it does not. Given a Requester, then the
  staff endpoint is refused and the Requester endpoint returns only their own data.
- **AC-22** Given a `currentStatus` list with an unknown or repeated member, when My Tickets
  or the Queue is requested, then it is refused. Given a valid list, then only Tickets in
  those statuses are returned.

### Migration, seed and regression

- **AC-23** Given a populated Lab 3 database, when the Lab 4 migration runs and is then
  rolled back, then every earlier row is unchanged after each step, the migrated schema
  matches `schema.prisma` without drift, and the rolled-back schema matches Lab 3's.
- **AC-24** Given an empty database, when the seed runs twice, then BR-35's data exists once,
  and an Action edited between the runs is not reverted.
- **AC-25** Given the Lab 2 and Lab 3 test suites, when they run against the Lab 4 codebase,
  then they pass. Any test changed because a Lab 4 rule intentionally widened behaviour is
  listed in `tests.md` with its reason.

### Hardening and presentation

- **AC-26** Given any create or change form, when it is submitted twice quickly or retried
  after a network failure, then at most one record is created and no change applies twice.
- **AC-27** Given a form with entered data, when saving fails with a validation error, a
  conflict, a network failure or a server error, then everything entered is still there.
- **AC-28** Given every major Lab 4 screen at desktop, tablet and mobile widths, when each
  renders, then badges, editable and read-only fields, validation placement and focus follow
  `ui-spec.md`. Nothing is clipped, overlapping, or scrolls the page sideways, and no console
  error is logged.
- **AC-29** Given the seeded database, when each dashboard endpoint is requested, then it
  answers within 500 ms at the 95th percentile over 50 requests on the development machine.
  This is a performance smoke test, not a benchmark.

## 10. Definition of Done

### Part 1 — Product completion

The coding agent may report Lab 4 complete only when **all** of the following hold:

1. Every FR, BR and AC in this document is implemented, and any deviation was agreed and
   recorded here first.
2. Every acceptance criterion is linked in [`tests.md`](./tests.md) to at least one automated
   test, and every such test passes on `main`.
3. No test is skipped, disabled, weakened, or asserts something that cannot fail. Every new
   authorization, workflow, gate and concurrency test has been seen to fail against a
   deliberately broken implementation, with a no-op control run beside it.
4. The Lab 2 and Lab 3 suites pass unchanged in behaviour.
5. Every `tests.md` row's named test file exists, checked mechanically rather than trusted
   from a green total.
6. The migration and its rollback have been proven against a populated Lab 3 database with
   no schema drift.
7. Every new endpoint has been exercised directly as each role and as nobody, and answers as
   §8 and [`api-spec.md`](./api-spec.md) say, including every status and error code.
8. Every dashboard metric has been compared with an independent database count, both zero
   and non-zero.
9. No response to a Requester contains Internal Note content, a password hash, a session
   token or a storage key, and this is asserted rather than assumed.
10. Every screen matches [`ui-spec.md`](./ui-spec.md) at three viewports, and the visual and
    accessibility checklist is completed against the running application.
11. No console error, broken link, placeholder text or unfinished control remains.
12. The README's setup, migration, seed, sign-in, test and demonstration steps work on a
    fresh clone, and every command block runs from the directory it names.

### Part 2 — Course delivery

Checked separately from product completion:

1. Each issue #80–#91, and #78, was implemented on its own feature branch and reached
   `lab4-staging` through a Pull Request approved by the peer reviewer, recorded in
   [`reviewer.md`](./reviewer.md) as each review happens.
2. This contract merged before any implementation Pull Request did.
3. `lab4-staging` was released to `main` through a reviewed Pull Request, and the final
   results in `tests.md` were captured on `main` after that merge.
4. [`ai-use.md`](./ai-use.md) names the LLM and records 6–10 real prompts and a reflection.
5. The GitHub Project shows every Lab 4 issue in Done.
6. One PDF, headed Answer Part 1 to Answer Part 9, carries readable evidence and working
   links.

## 11. Assumptions and Decisions

| # | Decision | Reasoning |
|---|---|---|
| D-01 | An Action has an **Assignee** and an **Action Status** beyond the seven listed fields. | Part 6 grades assign, complete, cancel and inactive-assignee rejection. AC-01 names an approved assignee, and the Lab 3 sheet blocks resolution while Actions are "incomplete". None of those can exist on the seven fields alone. Adding both keeps every listed field exactly and makes every graded behaviour real, not simulated. |
| D-02 | Open Actions are editable; completed and cancelled ones are frozen. | This reconciles "create and update" (§1) with "append-only behaviour" (Part 7). See justified decision 2 in §7. |
| D-03 | Action Date/Time is entered by the user; Recorded At is set by the server. | §3 and §8.3 name the field differently, and both meanings matter: work is often logged after it happens, and the log must still show when it was written. |
| D-04 | The owning Requester sees every Action field. | §8.3 says Requesters "will see all Actions Taken items", and §4.3 defers to the specification, which chooses to follow §8.3. Hiding individual fields would create a second private channel beside Internal Notes, which is the leak Lab 3 D-11 was built to prevent. The form states the visibility instead. |
| D-05 | Attachment Notes is text, not an upload. | §3 describes it as "what file to look for", and the Lab 2 attachment rules (five-file limit, types, sizes) already govern files on a Ticket. A second upload path would duplicate those rules. |
| D-06 | The gate requires no open Action, at least one completed Action, and a latest completed Action without follow-up. | "Incomplete" work (Lab 3 sheet) is open Actions. Resolving with no recorded work would let the gate pass on an empty log. An outstanding follow-up means the latest work says more is needed. A duplicate or withdrawn request is cancelled, not resolved, so it never meets the gate. |
| D-07 | The migration creates no synthetic history or Actions for existing Tickets. | Invented events would put fabricated times and actors into an audit record. An honest empty history, and a stated start date for recording, are better evidence. |
| D-08 | Dashboard windows are rolling (the last 168 hours), not calendar days. | "Today" and "this week" need a time zone and a day boundary, and a server-side boundary would disagree with the viewer's clock near midnight. A rolling window is the same instant for every viewer. |
| D-09 | No period-over-period deltas ("+3 from yesterday"), Quick Actions grid or "TikTockIT" name from the mockups. | A delta needs a daily snapshot table and a day boundary, and it is neither required nor in scope (§4.2 excludes BI analytics). Quick Actions duplicate the navigation. The product name is TokTickIT. Each deviation is listed in `ui-spec.md`. |
| D-10 | A Ticket cancellation cascades to its open Actions. | Otherwise a frozen Ticket could hold open work that no one can complete (BR-12), and S-3 would count it for ever. |
| D-11 | Recording an Action does not bump the Ticket `version`. | This is the same reasoning as comments in Lab 3 D-12: two people on one Ticket is normal, and logging work must not invalidate a colleague's pending status change. The gate is still safe, because it is evaluated under the row lock (BR-14), not from the client's version. |
| D-12 | `currentStatus` accepts a list rather than a new `statusGroup` parameter. | Every drill-down, including "active", is then expressible with the existing parameter, and a list names the statuses it means. A group name would hide a definition that could drift from BR-25. |
| D-13 | Issue #78 is part of Lab 4. | The Requester dashboard's drill-down needs the My Tickets status filter that Lab 3 promised and did not deliver. Folding it in closes that debt and gives the drill-down something to land on. |
| D-14 | This contract was drafted before reviewing the peer's Lab 4 contract (`Earth2509/toktickit` PR #61). | It is written independently from the labsheet and this repository's Lab 3 contract. Any point adopted from that review will be recorded here, as Lab 3 D-18 did. |
