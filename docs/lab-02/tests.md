# Lab 2 Test Plan and Results

**Status:** Planned before implementation
**Companion document:** [`specification.md`](./specification.md)
**Status convention:** a row reads `Planned` until that test has actually run and passed
on `main`. Nothing is marked `Passed` from a feature branch.

---

## 1. Test Strategy

Tests are derived from the acceptance criteria in `specification.md` §9, written before or
alongside the code they cover, and organised by the level that can prove the behaviour most
cheaply.

- **Unit** — pure logic with no database or network: number formatting, validation bounds,
  query-parameter parsing, attachment rules. Fast, and the right place for boundary cases.
- **API** — Express routes exercised through Supertest against a test database, asserting
  status codes, the `error.code` values from `api-spec.md`, and persisted state. Ownership
  and idempotency live here because they are server responsibilities.
- **UI component** — React Testing Library against a mocked API boundary, asserting what a
  user sees: field errors, busy states, empty versus no-results, removed attachments.
- **UI style** — automated assertions that the Zen Green rules in `ui-spec.md` are actually
  applied: tokens, required markers, message placement, button hierarchy, ARIA roles.
- **Responsive** — Playwright at three viewports, asserting no horizontal page scroll and
  no clipped or overlapping content, and capturing the screenshots Part 9 requires.
- **End-to-end** — Playwright against the real stack, covering the journeys that only mean
  something when every layer participates.

Two rules apply throughout. Ownership is never asserted only in the UI, because the UI is
not what enforces it. And a mocked API boundary is mocked per endpoint, never as a blanket
`fetch` stub — a blanket mock was the defect found in the peer's Lab 1 PR #8 and it makes
a suite that cannot fail.

**Infrastructure dependency.** The unit, API, UI and style suites run under the existing
Vitest configuration, whose `tests/**` globs already match the `tests/lab-02/` paths below,
so they need no configuration change. The Playwright rows do not yet have a runner: the
repository has no Playwright dependency, no configuration and no `e2e/` directory. Issue
[#27](https://github.com/Nuggetkub/toktickit/issues/27) adds them, and the responsive and
E2E rows below are not claimed runnable until it merges.

---

## 2. Planned Tests

| ID | Level | AC | Scenario and expected result | Test file | Status |
|---|---|---|---|---|---|
| UNIT-01 | Unit | AC-04 | Ticket Number formats as `TKT-<YYYY>-<NNNNN>` with zero padding, and the sequence restarts per year. | `server/tests/lab-02/ticket-number.test.ts` | Planned |
| UNIT-02 | Unit | AC-05 | Summary and Description are trimmed before validation; 5/120 and 20/4000 boundaries accept and reject correctly; whitespace alone fails. | `server/tests/lab-02/ticket-validation.test.ts` | Planned |
| UNIT-03 | Unit | AC-14 | Attachment type is decided from file content, not extension; a `.png` holding a script is rejected. Exactly 5 MB is accepted and one byte more is rejected. | `server/tests/lab-02/attachment-rules.test.ts` | Planned |
| UNIT-04 | Unit | AC-14 | The active-attachment count ignores rows with `removedAt` set, so removing one frees a slot. | `server/tests/lab-02/attachment-rules.test.ts` | Planned |
| UNIT-05 | Unit | AC-15 | Removal reason is trimmed and bounded to 5–250 characters. | `server/tests/lab-02/attachment-rules.test.ts` | Planned |
| UNIT-06 | Unit | AC-09 | Query parsing accepts only the whitelisted sort fields, sort orders and page sizes, requires `page` ≥ 1, and reports each rejection as a field error. | `server/tests/lab-02/ticket-query.test.ts` | Planned |
| API-01 | API | AC-01 | Categories, related systems and requesters return active rows only; the inactive requester never appears. | `server/tests/lab-02/reference.api.test.ts` | Planned |
| API-02 | API | AC-04 | A valid create returns `201` with a `TKT-` number, `NEW`, a server `ticketDate`, and the `requesterId` taken from `X-Dev-Requester-Id` rather than the body. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-03 | API | AC-05 | Each broken field rule returns `400 VALIDATION_FAILED` with that field named in `fieldErrors`, and no ticket is persisted. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-04 | API | AC-06 | Replaying an `Idempotency-Key` with an identical payload returns `200` and the original ticket with no duplicate row; replaying it with a changed payload returns `409 IDEMPOTENCY_KEY_CONFLICT` and creates nothing. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-05 | API | AC-12 | A missing, malformed, or inactive `X-Dev-Requester-Id` returns `401 REQUESTER_CONTEXT_REQUIRED` on every requester-scoped route. | `server/tests/lab-02/requester-context.api.test.ts` | Planned |
| API-06 | API | AC-08 | The list is scoped to the header's requester: A's tickets are returned for A and are absent for B, with no query parameter involved. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-07 | API | AC-09 | Search, each filter, sorting and paging return the correct subset with correct `page`, `pageSize`, `totalItems` and `totalPages`; a page past the end returns an empty array with `200`. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-08 | API | AC-10 | Sorting by `requestedPriority` ascending returns `LOW`, `MEDIUM`, `HIGH`, `URGENT` in severity order, not alphabetical order. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-09 | API | AC-09 | An unknown `sortBy`, an unknown `sortOrder`, a `pageSize` outside {10, 25, 50}, a `page` below 1, and an unrecognised priority each return `400` rather than being ignored. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-10 | API | AC-12 | An owned ticket returns `200`; a ticket owned by another requester returns `404 TICKET_NOT_FOUND`, identical to the response for a nonexistent id. | `server/tests/lab-02/ticket-detail.api.test.ts` | Planned |
| API-11 | API | AC-13 | A permitted file under the ceiling returns `201` with active metadata and a stored key that is not derived from the original filename. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-12 | API | AC-14 | Unsupported type returns `415`; oversize returns `413`; a sixth active file returns `409 ATTACHMENT_LIMIT_REACHED`; upload to another requester's ticket returns `404`. No metadata row is written in any case. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-13 | API | AC-15 | Soft removal returns `200` with reason, timestamp and remover; metadata still lists the attachment; a later download returns `404`; a second removal returns `409 ATTACHMENT_ALREADY_REMOVED` without overwriting the first reason. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-14 | API | AC-13 | Downloading an active attachment returns `200`, the recorded MIME type, and a `Content-Disposition` filename that is sanitised. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| UI-01 | UI | AC-01 | The selector lists active requesters only, states that it is a testing mechanism and not a login, and renders loading, empty and failure states. | `client/tests/lab-02/RequesterSelector.test.tsx` | Planned |
| UI-02 | UI | AC-02 | Opening a requester-scoped route with nothing selected renders the selector, and no ticket data is requested. | `client/tests/lab-02/RequesterRouteGuard.test.tsx` | Planned |
| UI-03 | UI | AC-03 | Create Ticket loads categories and related systems from the API and shows the selected requester as a read-only field. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-04 | UI | AC-05 | Invalid input renders a message beneath each offending field, the submit stays disabled while busy, and entered values survive the failed attempt. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-05 | UI | AC-04 | A successful create renders the returned Ticket Number and Ticket Date, and offers the next action. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-06 | UI | AC-07 | An API failure renders a safe message with no raw network text, and every field value is preserved for retry. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-07 | UI | AC-08 | Changing requester clears filters and paging and reloads the list for the new context. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-08 | UI | AC-09 | Search, filters, sort and pagination controls drive the request and render the returned metadata, including page and total counts. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-09 | UI | AC-11 | Owning no tickets and matching no tickets render different messages and different recovery actions. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-10 | UI | AC-15 | Detail renders every field read-only, shows a removed attachment as retained metadata with a Removed badge, and offers no working download for it. | `client/tests/lab-02/TicketDetail.test.tsx` | Planned |
| UI-11 | UI | AC-14 | A rejected file is named in the error together with its reason, and other selected files are unaffected. | `client/tests/lab-02/TicketDetail.test.tsx` | Planned |
| UI-12 | UI | AC-07 | The API client converts a thrown `TypeError: Failed to fetch` into a human message before it reaches a component. | `client/tests/lab-02/apiClient.test.ts` | Planned |
| STYLE-01 | UI style | AC-16 | Zen Green tokens are applied; required fields carry an asterisk; validation messages render beneath their field; read-only and editable fields are visually distinct; button variants and busy/disabled states are correct; `role="status"` and `role="alert"` are used as specified. | `client/tests/lab-02/ZenGreen.styles.test.tsx` | Planned |
| RESP-01 | Responsive | AC-16 | Create Ticket, My Tickets and Ticket Detail at 1440×900, 834×1112 and 390×844: no horizontal page scroll, no clipped labels, no overlapping messages. Screenshots are written to `artifacts/lab-02/screenshots/`. | `e2e/lab-02/responsive.spec.ts` | Planned |
| E2E-01 | E2E | AC-04, AC-08 | Select a requester, create a ticket, see its official number, then find that number in My Tickets. | `e2e/lab-02/create-and-find.spec.ts` | Planned |
| E2E-02 | E2E | AC-08, AC-12 | Switch requester and confirm the first requester's tickets disappear; then open the first requester's ticket URL directly and confirm it is refused. | `e2e/lab-02/ownership.spec.ts` | Planned |
| E2E-03 | E2E | AC-13, AC-15 | Upload a permitted attachment, download it, soft-remove it with a reason, and confirm the download is then blocked while the metadata remains. | `e2e/lab-02/attachments.spec.ts` | Planned |

---

## 3. Acceptance-Criterion Traceability

Every acceptance criterion in `specification.md` §9 maps to at least one planned test.

| AC | Planned tests |
|---|---|
| AC-01 Selector lists active requesters only | API-01, UI-01 |
| AC-02 Unselected visitor sees the selector | UI-02 |
| AC-03 Create Ticket loads reference data | UI-03 |
| AC-04 Valid create saves one ticket with an official number | UNIT-01, API-02, UI-05, E2E-01 |
| AC-05 Invalid create shows field errors and saves nothing | UNIT-02, API-03, UI-04 |
| AC-06 Idempotent retry creates no duplicate | API-04 |
| AC-07 Backend failure is safe and preserves input | UI-06, UI-12 |
| AC-08 Tickets are scoped to the selected requester | API-06, UI-07, E2E-01, E2E-02 |
| AC-09 Search, filter, sort, page and metadata are correct | UNIT-06, API-07, API-09, UI-08 |
| AC-10 Priority sorts by severity | API-08 |
| AC-11 Empty and no-results are distinct | UI-09 |
| AC-12 Cross-requester access is refused as not found | API-05, API-10, E2E-02 |
| AC-13 Permitted upload and download work | API-11, API-14, E2E-03 |
| AC-14 Invalid, oversize and excess uploads are refused | UNIT-03, UNIT-04, API-12, UI-11 |
| AC-15 Soft removal retains metadata and blocks download | UNIT-05, API-13, UI-10, E2E-03 |
| AC-16 Three viewports render without clipping or overflow | STYLE-01, RESP-01 |

---

## 4. Responsive and Visual Checklist

Checked at each viewport for Create Ticket, My Tickets and Ticket Detail:

| Viewport | Width used | Required behaviour |
|---|---|---|
| Desktop | 1440×900 | Multi-column layout, content centred with a sensible maximum width. |
| Tablet | 834×1112 | Two columns where practical; Summary and Description keep useful width. |
| Mobile | 390×844 | Fields stack; touch targets stay usable; the table becomes cards; no page-level horizontal scroll. |

- [ ] No clipped labels at any width
- [ ] No overlapping validation messages
- [ ] No hidden or unreachable buttons
- [ ] Attachment filenames remain readable, truncating with an accessible full value
- [ ] Required markers and field errors stay beside their field
- [ ] Read-only fields remain visually distinct from editable fields
- [ ] Loading, empty, no-results, success, error, busy and removed-attachment states all visible
- [ ] Zen Green tokens consistent across all three screens
- [ ] Priority and status badges legible without relying on colour alone

Screenshots are stored under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/`.

---

## 5. Commands

```bash
# unit + API
cd server && npm test

# UI component + UI style
cd client && npm test

# responsive + E2E (available after issue #27)
npx playwright test e2e/lab-02
```

---

## 6. Final Results

*Implementation has not started.* This section will carry the real terminal output for the
unit, API and UI suites captured from `main` after the release merge, together with the
Playwright run and the responsive screenshots. Test counts and file paths will be filled in
from that run, not from a feature branch and not from memory.

---

## 7. Known Limitations and Deferred Tests

- **Authentication is not tested, because it does not exist.** The `X-Dev-Requester-Id`
  header is forgeable by design. What *is* tested is that the server enforces ownership
  against whatever identity that header supplies (API-05, API-10), which is the part that
  survives into Lab 3 when the header is replaced by a real identity.
- **IT Staff workflow, comments, internal notes, actions taken and post-`NEW` status
  transitions have no tests**, because they are out of scope for this sprint.
- **Storage durability is not tested.** Attachment bytes are written to the server
  filesystem; tests assert metadata, ownership and the download guard rather than disk
  behaviour.
- **The responsive and E2E rows depend on issue #27** for their runner and are marked
  `Planned` until that infrastructure exists.
