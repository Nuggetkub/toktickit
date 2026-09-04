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
| API-01 | API | AC-01 | Categories, related systems and requesters return active rows only, ordered by name and exposing only the contracted fields; a deactivated category disappears; the inactive requester never appears. | `server/tests/lab-02/reference.api.test.ts` | Planned |
| API-15 | API | AC-01 | With the database unreachable, all three reference endpoints return `503 DEPENDENCY_UNAVAILABLE` in the documented envelope and leak no cause, SQL or stack trace. | `server/tests/lab-02/reference-failure.api.test.ts` | Planned |
| UNIT-07 | Unit | AC-01 | The seed is idempotent: a second run creates no duplicates, restores a requester deactivated by hand, and seeds no tickets. | `server/tests/lab-02/seed.test.ts` | Planned |
| API-02 | API | AC-04 | A valid create returns `201` with a `TKT-` number, `NEW`, a server `ticketDate`, and the `requesterId` taken from `X-Dev-Requester-Id` rather than the body. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-03 | API | AC-05 | Each broken field rule returns `400 VALIDATION_FAILED` with that field named in `fieldErrors`, and no ticket is persisted. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-04 | API | AC-06 | Replaying an `Idempotency-Key` with an identical payload returns `200` and the original ticket with no duplicate row; replaying it with a changed payload returns `409 IDEMPOTENCY_KEY_CONFLICT` and creates nothing. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-05 | API | AC-12 | A missing, malformed, or inactive `X-Dev-Requester-Id` returns `401 REQUESTER_CONTEXT_REQUIRED`, and the three causes are indistinguishable to the caller. | `server/tests/lab-02/requester-context.api.test.ts` | Planned |
| API-16 | API | AC-06 | Two simultaneous creates sharing one `Idempotency-Key` produce exactly one Ticket: one `201`, one `200`, and the same id from both. | `server/tests/lab-02/create-ticket.api.test.ts` | Planned |
| API-06 | API | AC-08 | The list is scoped to the header's requester: A's tickets are returned for A and are absent for B, with no query parameter involved. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-07 | API | AC-09 | Search, each filter, sorting and paging return the correct subset with correct `page`, `pageSize`, `totalItems` and `totalPages`; a page past the end returns an empty array with `200`. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-08 | API | AC-10 | Sorting by `requestedPriority` ascending returns `LOW`, `MEDIUM`, `HIGH`, `URGENT` in severity order, not alphabetical order. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-09 | API | AC-09 | An unknown `sortBy`, an unknown `sortOrder`, a `pageSize` outside {10, 25, 50}, a `page` below 1, and an unrecognised priority each return `400` rather than being ignored. | `server/tests/lab-02/my-tickets.api.test.ts` | Planned |
| API-10 | API | AC-12 | An owned ticket returns `200`; a ticket owned by another requester returns `404 TICKET_NOT_FOUND`, identical to the response for a nonexistent id. | `server/tests/lab-02/ticket-detail.api.test.ts` | Planned |
| API-17 | API | AC-12, AC-15 | Ticket Detail returns full attachment metadata with removed entries present and marked, never the storage key; a non-owner is answered `404` and no filename is disclosed. | `server/tests/lab-02/ticket-detail.api.test.ts` | Planned |
| API-11 | API | AC-13 | A permitted file under the ceiling returns `201` with active metadata and a stored key that is not derived from the original filename. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-12 | API | AC-14 | Unsupported type returns `415`; oversize returns `413`; a sixth active file returns `409 ATTACHMENT_LIMIT_REACHED`; upload to another requester's ticket returns `404`. No metadata row is written in any case. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-13 | API | AC-15 | Soft removal returns `200` with reason, timestamp and remover; metadata still lists the attachment; a later download returns `404`; a second removal returns `409 ATTACHMENT_ALREADY_REMOVED` without overwriting the first reason. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| API-14 | API | AC-13 | Downloading an active attachment returns `200`, the recorded MIME type, and a `Content-Disposition` filename that is sanitised. | `server/tests/lab-02/attachments.api.test.ts` | Planned |
| UI-01 | UI | AC-01 | The selector lists active requesters only, states that it is a testing mechanism and not a login, and renders loading, empty and failure states. | `client/tests/lab-02/RequesterSelector.test.tsx` | Planned |
| UI-02 | UI | AC-02 | Opening a requester-scoped route with nothing selected renders the selector, no ticket data is shown, the navigation is hidden, a stored requester who is no longer active is dropped, and a returning requester is not bounced while the stored id resolves. | `client/tests/lab-02/RequesterRouteGuard.test.tsx` | Planned |
| UI-03 | UI | AC-03 | Create Ticket loads categories and related systems from the API and shows the selected requester as a read-only field. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-04 | UI | AC-05 | Invalid input renders a message beneath each offending field, the submit stays disabled while busy, and entered values survive the failed attempt. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-05 | UI | AC-04 | A successful create renders the returned Ticket Number and Ticket Date, and offers the next action. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-06 | UI | AC-07 | An API failure renders a safe message with no raw network text, and every field value is preserved for retry. | `client/tests/lab-02/CreateTicket.test.tsx` | Planned |
| UI-07 | UI | AC-08 | Changing requester clears filters and paging and reloads the list for the new context. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-08 | UI | AC-09 | Search, filters, sort and pagination controls drive the request and render the returned metadata, including page and total counts. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-09 | UI | AC-11 | Owning no tickets and matching no tickets render different messages and different recovery actions. | `client/tests/lab-02/MyTickets.test.tsx` | Planned |
| UI-10 | UI | AC-15 | Detail renders every field read-only, shows a removed attachment as retained metadata with a Removed badge, and offers no working download for it. Removal needs a confirmation and a typed reason before anything is sent. | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Planned |
| UI-11 | UI | AC-14 | A rejected file is named in the error together with its reason, and other selected files are unaffected. A server rejection is reported beside the attachment section, naming the file. | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Planned |
| UI-12 | UI | AC-07 | The API client converts a thrown `TypeError: Failed to fetch` into a human message before it reaches a component. | `client/tests/lab-02/apiClient.test.ts` | Planned |
| STYLE-01 | UI style | AC-16 | Zen Green tokens are applied; required fields carry an asterisk; validation messages render beneath their field; read-only and editable fields are visually distinct; button variants and busy/disabled states are correct; `role="status"` and `role="alert"` are used as specified. | `client/tests/lab-02/ZenGreen.styles.test.tsx` | Planned |
| RESP-01 | Responsive | AC-16 | Create Ticket, My Tickets and Ticket Detail at 1440×900, 834×1112 and 390×844: no page-level horizontal scroll, no clipped label, no control outside the viewport, no attachment name cut off, and a 44 px minimum control height on mobile. Screenshots are written to `artifacts/lab-02/screenshots/` and committed. | `e2e/lab-02/responsive.spec.ts` | Planned |
| E2E-01 | E2E | AC-04, AC-08 | Select a requester, create a ticket, see its official number, then find that number in My Tickets. | `e2e/lab-02/create-and-find.spec.ts` | Planned |
| E2E-02 | E2E | AC-02, AC-08, AC-12 | Switch requester and confirm the first requester's tickets disappear from a search; open the first requester's ticket URL directly and confirm it is refused in the same words as a ticket that never existed; open a requester-scoped URL with no requester selected and get the selector. | `e2e/lab-02/ownership.spec.ts` | Planned |
| E2E-03 | E2E | AC-13, AC-15 | Upload a permitted attachment, download it, soft-remove it with a reason, and confirm the download is then blocked while the metadata remains. | `e2e/lab-02/attachments.spec.ts` | Planned |

---

## 3. Acceptance-Criterion Traceability

Every acceptance criterion in `specification.md` §9 maps to at least one planned test.

| AC | Planned tests |
|---|---|
| AC-01 Selector lists active requesters only | UNIT-07, API-01, API-15, UI-01 |
| AC-02 Unselected visitor sees the selector | UI-02 |
| AC-03 Create Ticket loads reference data | UI-03 |
| AC-04 Valid create saves one ticket with an official number | UNIT-01, API-02, UI-05, E2E-01 |
| AC-05 Invalid create shows field errors and saves nothing | UNIT-02, API-03, UI-04 |
| AC-06 Idempotent retry creates no duplicate | API-04, API-16 |
| AC-07 Backend failure is safe and preserves input | UI-06, UI-12 |
| AC-08 Tickets are scoped to the selected requester | API-06, UI-07, E2E-01, E2E-02 |
| AC-09 Search, filter, sort, page and metadata are correct | UNIT-06, API-07, API-09, UI-08 |
| AC-10 Priority sorts by severity | API-08 |
| AC-11 Empty and no-results are distinct | UI-09 |
| AC-12 Cross-requester access is refused as not found | API-05, API-10, API-17, E2E-02 |
| AC-13 Permitted upload and download work | API-11, API-14, E2E-03 |
| AC-14 Invalid, oversize and excess uploads are refused | UNIT-03, UNIT-04, API-12, UI-11 |
| AC-15 Soft removal retains metadata and blocks download | UNIT-05, API-13, API-17, UI-10, E2E-03 |
| AC-16 Three viewports render without clipping or overflow | STYLE-01, RESP-01 |

---

## 4. Responsive and Visual Checklist

Checked at each viewport for Create Ticket, My Tickets and Ticket Detail:

| Viewport | Width used | Required behaviour |
|---|---|---|
| Desktop | 1440×900 | Multi-column layout, content centred with a sensible maximum width. |
| Tablet | 834×1112 | Two columns where practical; Summary and Description keep useful width. |
| Mobile | 390×844 | Fields stack; touch targets stay usable; the table becomes cards; no page-level horizontal scroll. |

Checked on 2026-09-02; the full record, marking which items a test asserts and which were
checked by eye, is `ui-spec.md` §11.

- [x] No clipped labels at any width — RESP-01 measures `scrollWidth` against `clientWidth`
- [x] No overlapping validation messages
- [x] No hidden or unreachable buttons — RESP-01 fails any enabled control whose box falls
      outside the viewport
- [x] Attachment filenames remain readable — the name wraps rather than truncating, so there
      is no hidden value to expose
- [x] Required markers and field errors stay beside their field
- [x] Read-only fields remain visually distinct from editable fields
- [x] Loading, empty, no-results, success, error, busy and removed-attachment states all visible
- [x] Zen Green tokens consistent across all three screens
- [x] Priority and status badges legible without relying on colour alone

Screenshots are stored under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/`.

---

## 5. Commands

```bash
# unit + API
cd server && npm test

# UI component + UI style
cd client && npm test

# responsive + E2E, from the repository root
npm install          # once — the root package holds only Playwright
npm run e2e:install  # once — downloads the Chromium build Playwright drives
npm run e2e
```

### What the E2E command needs, and what it touches

`npm run e2e` starts both services itself; nothing has to be running first. It needs
`server/.env` to exist with a working `DATABASE_URL` — the same file the application already
uses — or an `E2E_DATABASE_URL` in the environment.

It then keeps every piece of its state away from development state:

| | Development | E2E run |
|---|---|---|
| Database schema | `public` | `lab2_e2e`, dropped and recreated on every run |
| API port | 3000 | 3101 |
| Client port | 5173 | 4173 |
| Attachment bytes | `server/storage/` | `artifacts/lab-02/e2e-runtime/uploads/` |

The schema is prepared by `server/scripts/prepare-e2e.ts`, which refuses to run against
`public`. Screenshots are written to `artifacts/lab-02/screenshots/` and are committed; the
HTML report, traces and uploads are regenerated output and are ignored.

---

## 6. Final Results

*Implementation is in progress.* This section will carry the real terminal output for the
unit, API and UI suites captured from `main` after the release merge, together with the
Playwright run and the responsive screenshots. Test counts and file paths will be filled in
from that run, not from a feature branch and not from memory.

### Issue #27 feature-branch verification

Run on `feature/27-e2e-and-visual-evidence` on 2026-09-02, before peer review:

- `npm run e2e` (repository root) — **10 tests passed**, four spec files, nine screenshots
  written to `artifacts/lab-02/screenshots/`.
- `cd client && npm test` — 8 files, 97 passed. `cd server && npm test` — 14 files, 126
  passed. Both builds passed.

**The responsive tests assert; the screenshots are only evidence.** Nine images prove nothing
on their own and nobody compares them pixel by pixel, so every capture is paired with the
checks a person would otherwise make by eye: no page-level horizontal scroll, no label whose
`scrollWidth` exceeds its `clientWidth`, no enabled control whose box falls outside the
viewport, no attachment filename cut off, and a 44 px minimum control height on mobile.

**Both of those were verified by breaking the code**, since a responsive check that has never
failed proves nothing about responsiveness:

- `.zen-card { min-width: 900px }` failed the mobile run with `the page scrolls horizontally
  — Expected: <= 1, Received: 522`.
- Constraining `.zen-field__label` to 24 px with `overflow: hidden` failed the desktop run
  with eleven clipped labels listed by name.

Both were reverted and the suite returns to 10 passed.

**A screenshot that showed something untrue.** The first `my-tickets/mobile.png` had a Ticket
Number in the search box and all eight Tickets listed beneath it. The search is debounced by
300 ms and the assertion — that a row matching the number exists — was satisfied by the
*unfiltered* list, so the capture raced the refetch. The test now waits for
`Showing 1–1 of 1 Ticket` before capturing. The assertion was weak in exactly the way that
produces confident, wrong evidence, and only looking at the image caught it.

**The visual inspection found a real gap against our own specification.** `ui-spec.md` §9
requires a multi-column form at desktop; Create Ticket and Ticket Detail were rendering a
single tall column of full-width fields at 1440 px. A `zen-form-grid` now lays the short
fields out in two columns from 768 px up, with Ticket Summary, Description and Attachments
spanning both so they keep their width. Below 768 px the grid collapses and everything
stacks, as §9 also requires.

### Issue #26 feature-branch verification

Run on `feature/26-ticket-detail-and-attachments` on 2026-09-01, before peer review:

- `cd client && npm test` — 8 files, **97 tests passed** (up from 7 files / 84).
- `cd server && npm test` — 14 files, **126 tests passed** (up from 124).
- `cd client && npm run build` and `cd server && npm run build` — both passed.

**The detail endpoint was not keeping its own promise.** `api-spec.md` §3 says
`GET /api/tickets/:ticketId` returns full attachment metadata with removed entries present
and marked; the handler returned a hard-coded empty array, and the existing API-10 test
asserted exactly that empty array on a ticket that had no attachments — true, and worth
nothing. The screen would have shown "no files attached" for every Ticket. API-17 now uploads
two files, removes one, and asserts both come back with the removal reason on the second and
no `storageKey` on either. **Verified by breaking the code**: reverting the handler to the
empty array made API-17 fail with `expected [] to have a length of 2`.

**Three UI claims were proved the same way**, since a test that has never failed proves
nothing:

- Rendering the Download and Remove actions unconditionally instead of only for active
  attachments made UI-10 fail on both the removed-metadata case and the after-removal case.
- Removing the reason-length gate on the destructive confirm button made the removal test
  fail at `expect(confirm).toBeDisabled()`.
- The rejected-file test uses `fireEvent`, not `userEvent.upload`, for the same reason
  `CreateTicket.test.tsx` does: `userEvent` honours the `accept` attribute and would drop
  `payload.exe` before the component saw it, leaving the client-side type check untested. A
  browser treats `accept` as a hint, and drag-and-drop ignores it.

**Download goes through `fetch`, not an `<a href>`.** The endpoint is requester-scoped and
identity travels in `X-Dev-Requester-Id` (D-01); a browser navigation cannot carry a custom
header, so a plain link would arrive without context and be answered `401`. The bytes are
fetched with the header and saved through an object URL, which is revoked immediately — the
test asserts both the header on the request and the revoke.

### Issue #25 feature-branch verification

Run on `feature/25-attachment-api` on 2026-08-31, before peer review:

- `cd server && npm test` — 14 files, **124 tests passed** (up from 12 files / 89).
- `cd server && npm run build` — passed.

**Both defects found in the peer's attachment PR were designed out rather than repeated.**

- **The permitted type is decided by the file's leading bytes**, and the client's declared
  `Content-Type` is ignored entirely rather than merely cross-checked. An executable
  announced as `image/png` is refused with `415`, and a test asserts no row is written.
- **The five-active limit holds under concurrent uploads.** The count and the insert run in
  one transaction with `SELECT ... FOR UPDATE` on the Ticket row, so six simultaneous uploads
  produce five created and one `409`. A multi-file picker uploading in parallel is the
  ordinary case, not an exotic one.

**The concurrency test was verified by breaking the code**, on the principle that a
concurrency test which has never failed proves nothing about concurrency. Removing
`FOR UPDATE` made it fail with six attachments created — precisely the defect reported on the
peer's PR #26 — and restoring it made it pass. Slot reuse is covered too: removing one of
five frees a place, so a Ticket that has held five is not stranded (BR-33).

**A test bug worth recording.** The first version of the filename test wrote a Windows path
through a shell heredoc that collapsed the escapes, so the string literal contained no
separator at all and the path-stripping assertion tested nothing. The test now builds the
separator from a character code. A test for path stripping that contains no path separator
belongs to the same family as a mock that answers every URL: green, and empty.

### Issue #24 feature-branch verification

Run on `feature/24-my-tickets-screen` on 2026-08-30, before peer review:

- `cd client && npm test` — 7 files, **84 tests passed** (up from 6 files / 61).

**Eight of those came from review.** @Earth2509 pointed out that the suite asserted *query
construction* rather than what a user sees: it checked that selecting a Category put
`categoryId=3` in the URL, never that the rows on screen changed. Added: a deferred response
proving the loading state resolves to a list; per-control fixtures so Category, Related
System, Requested Priority and Sort each visibly replace the rows; real paging through Next
and Previous with the rendered page asserted; a completed requester change that reloads under
the new identity; and a regression test for the stale-response guard.

**A second review round found the requester-change test proving the wrong thing.** It
returned the same fixture for both requesters, so it showed that `X-Dev-Requester-Id`
changed and not the AC-08 behaviour that one requester's tickets disappear and the other's
appear. The fixture now varies by the header — which meant passing the headers into the mock,
since identity does not travel in the URL. A second test covers BR-11: a filter and a page
are applied *before* switching, and the new requester starts on page 1 with the filters
cleared, asserted both in the request and in the controls.

**The stale-response test was verified by breaking the code.** A regression test that has
never failed is unproven, so the `active` guard was removed temporarily: the test failed with
the stale answer on screen, and passed again once restored. That also exposed a flake of our
own — several tests selected a filter before the reference-data request had populated the
dropdowns, which passed in the full suite and failed when run alone. `renderList` now waits
for the filters before returning.
- `cd client && npm run build` — passed.

**Three findings from reviewing the peer's My Tickets screen were applied here before they
could be repeated.** Search is debounced to one request per completed term rather than one
per keystroke; the pagination line announces the result count, not only "Page 1 of 3"; and
Clear filters is enabled by a sort-only change, because it resets sort as well — a button
that refuses to do what it claims is worse than no button.

**A real defect, found by a test that was wrong first.** The pagination label computed the
last row as `page x pageSize`, which is correct for a full page and a lie for any page the
server trims. It now derives from the rows actually returned. The test that exposed it was
itself unrealistic — one row with a total of 24 — so the fix was to correct both.

**My own earlier suites used a blanket fetch mock, and it bit exactly as predicted.**
`RequesterSelector.test.tsx` and `RequesterRouteGuard.test.tsx` answered every URL with the
requester list. That was harmless while `/tickets` was a placeholder, and broke the moment
the screen really fetched — the ticket list received an array of requesters. Both are now
routed per endpoint. This is the third time this pattern has been raised in review on the
peer's code; it is worth recording that it was in ours too.

### Issue #23 feature-branch verification

Run on `feature/23-my-tickets-api` on 2026-08-30, before peer review:

- `cd server && npm test` — 12 files, **89 tests passed** (up from 9 files / 55).
- `cd server && npm run build` — passed.

**These run against the real database rather than a mocked Prisma.** Owner scoping is the
security-relevant claim in the sprint, and a mocked `findMany` returns what the mock was told
— so it can only prove the route builds a `where` clause, never that PostgreSQL honours it.
The same argument was put to the peer on his PR #24; it applies here.

**Three decisions the tests pin down:**

- **Invalid query parameters are rejected, not ignored** (BR-27). "No results" and "you asked
  the wrong question" are different answers and a caller cannot tell them apart from the
  outside, so a bad `sortBy` returns `400` with a field error rather than a plausible empty
  page. That includes a `currentStatus` filter, which Lab 2 does not have (BR-30) — silently
  ignoring it would hand unfiltered results to a client that believes they are filtered.
- **A repeated parameter is rejected.** Express turns `?page=1&page=99` into an array;
  quietly picking one would make the query mean something the caller did not write.
- **`totalPages` is never below 1**, so an empty result reads "page 1 of 1" rather than
  "page 1 of 0" — the same correction raised on the peer's PR #24.

The list response omits `description` deliberately: at 4000 characters a row, and never
rendered in the table, it would be up to 200 kB of unused text per page. A test asserts the
exact key set so it cannot drift back in.

### Issue #22 feature-branch verification

Run on `feature/22-create-ticket-screen` on 2026-08-30, before peer review:

- `cd client && npm test` — 6 files, **61 tests passed** (up from 5 files / 44).

**Six of those came from review.** @Earth2509 found two places where the screen did not meet
`ui-spec.md` §6: there was no Cancel action, and focus did not move to the first invalid
field after a failed submit. Both were requirements this repository had written down and then
not implemented — the spec was right and the code was behind it. Cancel now confirms before
discarding part-written input, focus moves to the first invalid control *in reading order*
(not whichever key an object enumerated first), and a server-side field error focuses the
field it names.
- `cd client && npm run build` — passed. It again caught a type error the test run did not:
  `typeof envelope` narrows to `null` after its initialiser, so the parsed error body was
  being cast to `never`. Three issues running, the build has found something `npm test`
  could not.
- Server suite re-run unchanged: 9 files, 55 tests passed.

**Attachment selection is validated but not uploaded.** BR-34 puts upload after the Ticket
exists, and the upload endpoint arrives in #25, so this screen checks the files and says
plainly on the success panel that they were *not* stored and will need choosing again. Part 6
still gets its evidence — one valid and one invalid file, with the valid one kept and each
rejection named — without the screen claiming to have done something it has not.

**Two test bugs of mine, both worth recording because they are easy to repeat:**

1. `aria-describedby` on a field with *both* a hint and an error lists two ids, so asserting
   equality against `"summary-error"` fails. The assertion now checks containment.
2. `userEvent.upload()` honours the input's `accept` attribute and silently drops a
   disallowed file, so the component never saw the invalid one and the rejection never fired.
   The test now uses `fireEvent.change`. This is the more interesting of the two: `accept` is
   a hint that drag-and-drop ignores, which is precisely why the validation cannot live in
   the attribute — and a test driven through `upload()` would have quietly asserted nothing.

### Issue #21 feature-branch verification

Run on `feature/21-create-ticket-api` on 2026-08-29, before peer review:

- `npx prisma migrate dev --name lab2_ticket_number_sequence` — generated and applied by
  Prisma against the real database.
- `cd server && npm test` — 9 files, **55 tests passed** (was 5 files / 17).
- `cd server && npm run build` — passed. It caught a type error the test run did not:
  Vitest does not type-check, so `npm test` alone is not evidence that the code compiles.
- Numbering verified in PostgreSQL rather than inferred: the suite produced
  `TKT-2026-00001` … `TKT-2026-00008` with `TicketNumberSequence` at `year=2026,
  lastValue=8`, and `public."Ticket"` remained empty throughout.

**A note on why the create tests use the real database.** Creation is the one place a mocked
Prisma proves least: the unique index on `idempotencyKey` and the per-year counter are
database behaviour, and a mock returns only what it was told. API-16 in particular — two
simultaneous requests sharing a key — cannot be written against a mock at all, because what
is under test is which of two transactions the index rejects.

**`seed.test.ts` was made order-independent.** It previously asserted an absolute zero
Tickets. Now that this issue creates real ones in the same schema, that assertion would have
depended on which file ran first. It now captures the count, re-seeds, and asserts the count
is unchanged — which is the claim actually being made: *seeding* creates no tickets.
### Issue #20 feature-branch verification

Run on `feature/20-requester-context` on 2026-08-29, before peer review:

- `cd client && npm test` — 5 files, **44 tests passed** (up from 2 files / 28).
- `cd client && npm run build` — passed.

**Routing arrived with this issue.** AC-02 is a claim about opening a URL directly, so it
needs real routes rather than a conditional render — `react-router-dom` is now a client
dependency, and `RequireRequester` guards `/create` and `/tickets`. The guard is a route
wrapper rather than a check inside each screen, so a screen added in #22 or #24 cannot
forget it. It is a usability guard, not a security one: the server enforces ownership on
every request regardless (BR-08).

**Two consequences worth recording, because both touched existing tests:**

1. `App.tsx` became the router, so the Lab 1 system-check screen moved to
   `src/SystemCheck.tsx` unchanged. `tests/lab-01/App.test.tsx` now renders that component
   inside `AppShell` — inside the shell because that is where the TokTickIT identity has
   lived since #18, and the test asserts on it. No assertion about the screen's behaviour
   changed.
2. The selected requester's name deliberately appears twice — in the shell banner and in
   the page body — so exact-text queries match both elements. The affected assertions use
   `getAllByText`. This surfaced as three failing tests on the first run rather than as a
   silent pass, which is the right way round.

**`apiClient.test.ts` is the first `.test.ts` in the client suite.** Until #18 widened the
Vitest glob from `*.test.tsx`, a file with that extension would never have run — so UI-12
would have been listed as covered while never executing.

### Issue #19 feature-branch verification

Run on `feature/19-data-and-reference-apis` on 2026-08-29, before peer review:

- `npx prisma migrate dev --name lab2_data_model` — the migration was **generated and
  applied by Prisma against the real database**, not hand-written. `migration_lock.toml`
  and `20260829081823_lab2_data_model/migration.sql` are both committed.
- `npm run prisma:seed`, run **twice** — 4 categories, 7 related systems, 5 requesters
  (4 active, 1 inactive), 0 tickets. Row counts read directly out of PostgreSQL after the
  second run were identical, and `tests/lab-02/seed.test.ts` now asserts this in CI rather
  than relying on someone remembering to run it twice.
- `cd server && npm test` — 5 files, **17 tests passed**.
- `cd server && npm run build` — passed.

**Test isolation, added in review.** @Earth2509 pointed out on PR #31 that two suites
deactivate a seeded row to prove active-only filtering, and that Vitest runs test files in
parallel by default — so `categories.test.ts`, which asserts four active categories, could
run while one of them was switched off, and a suite failing before its cleanup would leave
the shared development database wrong. Both are correct. Three changes:

1. `tests/global-setup.ts` creates, migrates (`prisma migrate deploy`) and seeds an
   isolated `lab2_test` PostgreSQL schema once per run; `tests/setup-env.ts` points each
   worker's client at it. **The suite no longer touches the development database at all.**
2. `fileParallelism: false` in `vitest.config.ts`. An isolated schema stops the tests
   corrupting development data; only serial execution stops them corrupting each other.
3. The restore in `finally` is kept as defence in depth.

Verified after the change: `lab2_test` holds 4 categories, 7 related systems and 5
requesters, while `public` still holds 4 active categories, 7 active related systems and
4 active requesters — untouched by the run.

**Reset, added in the second review round.** @Earth2509 then pointed out that
`migrate deploy` applies pending migrations but never clears data, so `lab2_test` carried
rows from one run to the next — and `seed.test.ts`'s "no tickets" assertion would start
depending on the previous run as soon as a suite began creating them. `global-setup.ts` now
drops and recreates the schema before migrating, with a guard that refuses to run if the
target schema is ever `public`. Verified by planting a stray ticket in `lab2_test` by hand
and confirming the next run cleared it.

He also reported that `npm run build` fails on a clean install until `prisma generate` is
run. **That did not reproduce here** — a fresh clone plus `npm ci` produced a client
containing all four new models, because `@prisma/client` runs `prisma generate` from its own
postinstall hook. An explicit `"postinstall": "prisma generate"` was added to
`server/package.json` regardless: depending on a transitive dependency's lifecycle hook is
fragile, and `npm ci --ignore-scripts` or a stale `node_modules` would break it.

**Honest note on the race.** It is real by construction, but it was *not* reproduced:
six runs with parallelism forced back on all passed. The mutate-assert-restore window is
only a few milliseconds wide. The fix stands regardless — a suite that fails one run in a
hundred is worse than one that fails every time, because the first gets re-run until it
passes and the second gets fixed.

**One contract change to note.** `GET /api/categories` previously returned rows in id
order, which was the Lab 1 contract. `api-spec.md` §2 — written and merged in Issue #17,
before this implementation — specifies that all three reference endpoints order by name so
the dropdowns read alphabetically. The endpoint follows the newer contract, and
`tests/lab-01/categories.test.ts` was updated to match, with the reason recorded in the
file itself. Only the ordering assertions changed; the `{ id, name }` shape did not.

### Issue #18 feature-branch verification

Run on `feature/18-zen-green-foundation` on 2026-08-28, before peer review:

- `cd client && npm test` — 2 files, **28 tests passed**: the four existing Lab 1 tests plus
  24 new in `client/tests/lab-02/ZenGreen.styles.test.tsx` (STYLE-01). The 24th was added
  in review: a field error revealed after submission must be announced, not merely
  described (see `reviewer.md`, PR #30).
- `cd client && npm run build` — passed. The CSS bundle is **6.19 kB**, down from 233 kB,
  because Bootstrap was removed once no Bootstrap class remained.

This is feature-branch evidence only. STYLE-01 stays `Planned` in the table above until it
runs on `main` after the release merge.

**Two configuration defects were found and fixed while writing STYLE-01**, both of which
would have silently weakened this plan:

- `client/vite.config.ts` included only `tests/**/*.test.tsx`, so the planned
  `client/tests/lab-02/apiClient.test.ts` (UI-12) would never have run. The glob is now
  `tests/**/*.test.{ts,tsx}`.
- The first draft of STYLE-01 read the stylesheet through Vite's `?raw` import. Vitest
  disables CSS processing, so that import resolves to an **empty string** and all seven
  token assertions passed vacuously. The suite now reads the file from disk, which is why
  `@types/node` and `noEmit` appear in this issue's diff.

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
