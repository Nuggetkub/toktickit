# Lab 4 Peer Review Record

**Author:** Sittijed Jantarataeme — Student ID 67070501046 — GitHub [@Nuggetkub](https://github.com/Nuggetkub)
**Peer reviewer:** Pattharapon Kijjanukij — Student ID 67070501069 — GitHub [@Earth2509](https://github.com/Earth2509)

Both students review each other's work. This record is written from actual GitHub activity
only. Every row corresponds to a real review, comment or merge that can be opened at the
linked URL, and no approval is recorded before it happens.

## Review Workflow

**This section describes `Nuggetkub/toktickit`, the repository this document lives in.**
Each Lab 4 issue, [#80](https://github.com/Nuggetkub/toktickit/issues/80) to
[#91](https://github.com/Nuggetkub/toktickit/issues/91) plus
[#78](https://github.com/Nuggetkub/toktickit/issues/78), is implemented on its own feature
branch and enters `lab4-staging` through a peer-reviewed Pull Request. The release Pull
Request from `lab4-staging` to `main` requires review and approval as well.

Both branches are protected:

- one approving review is required;
- stale approvals are dismissed on a new push;
- the rule is enforced for the repository owner too, so an unreviewed merge is not possible
  here.

**The two repositories number things independently, and the ranges overlap.** In this
repository the Lab 4 issues are #80–#91. In `Earth2509/toktickit`, his Lab 4 issues are
#55–#60 and his contract is PR #61. Every reference below is written as `Issue #n` or
`PR #n` for this repository, or `Earth2509 PR #n` for his, and every link resolves to the
thing its label names.

---

## Reviews Received on My Pull Requests — `Nuggetkub/toktickit`

| My issue / My pull request | Scope | Reviewer feedback | Author response | Outcome |
|---|---|---|---|---|
| — | — | No Lab 4 pull request has been reviewed yet. | — | — |

## Reviews I Gave on My Peer's Pull Requests — `Earth2509/toktickit`

| His issue / His pull request | Scope | My feedback | His response | Outcome |
|---|---|---|---|---|
| Earth2509 issue [#55](https://github.com/Earth2509/toktickit/issues/55) / [Earth2509 PR #61](https://github.com/Earth2509/toktickit/pull/61) | His Lab 4 engineering contract: `specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`, `reviewer.md`, `ai-use.md` | [**Changes requested**, 2026-09-25](https://github.com/Earth2509/toktickit/pull/61#pullrequestreview-5315340920), on commit `17a6b2c`. The PR is documents only, so each point was checked against the labsheet and against his own Lab 3 contract and code on his `main` (`a0ca6d9`). Five blocking items. (1) The Action model has no assignee and no status, so Part 6's assign, complete, cancel and inactive-assignee rejection have nothing to act on, and his gate ("at least one Action") stays satisfied after `RESOLVED → REOPENED`. (2) Four dashboard drill-downs span several statuses or priorities, while his list filters take a single value (`ticket-query.ts:35`, `staff-queue.ts:40-41`). (3) `unassignedTickets` omits the active-work Tickets his own Lab 3 BR-20 leaves unassigned after a deactivation. (4) `recentlyResolved` uses `updatedAt`, which moves on `RESOLVED → CLOSED`, and the DTO puts lists inside `metrics`. (5) Three labsheet musts are missing: a second justified database decision, a tested recovery, and unit and performance-smoke test rows. Six non-blocking items. Two candidate findings were dropped after checking: his transition matrix matches his own Lab 3 code, and the status route his spec names exists. **Round two:** [**changes requested**, 2026-09-25](https://github.com/Earth2509/toktickit/pull/61#pullrequestreview-5315995792), on `6573e94`. All five round-one findings are closed, and so are three non-blocking ones. Three blocking points remain, two of them in the new gate wording. (1) "Re-evaluated after reopen" re-checks the same conditions, which the pre-reopen Actions still satisfy, so a reopened Ticket can still be resolved with no new work. (2) "No completed Action whose follow-up remains required" can never become true once a completed Action, which is frozen, requires follow-up. (3) `ownedByMe` omits claimed `NEW` and owner-retaining `REOPENED` Tickets, both of which his Lab 3 contract (line 99) gives an owner. | [Commit `6573e94`](https://github.com/Earth2509/toktickit/commit/6573e94fc0da9660aab09b8c2843d852fcf56c89) addressed round one in full, [with a comment](https://github.com/Earth2509/toktickit/pull/61#issuecomment-5829519266) requesting re-review. [Commit `be3c5ab`](https://github.com/Earth2509/toktickit/commit/be3c5ab7c2bce0261384e4e9c1628c1e212201ae) answered round two: the gate now needs the latest completed Action to have been completed after the latest reopen, only the latest completed Action's follow-up counts, and "Owned by me" covers every non-terminal Ticket. **Round three:** [**approved**, 2026-09-25](https://github.com/Earth2509/toktickit/pull/61#pullrequestreview-5316779611), on `be3c5ab`, with three non-blocking notes: the idempotency-key retention period is referenced but never stated; whether completion accepts follow-up fields is unstated; and the two validation codes on `main` remain. | Approved |
| Earth2509 [PR #62](https://github.com/Earth2509/toktickit/pull/62) | His Actions Taken foundation: migration, `ActionTaken` and idempotency models, list/create/update API, seed, tests | [**Changes requested**, 2026-09-25](https://github.com/Earth2509/toktickit/pull/62#pullrequestreview-5319989756), on `343e00f`. His suite runs here (20 files, 99 passed / 4 skipped, `tsc` clean), and the real endpoints were driven against an isolated schema. Three blocking items. (1) Two simultaneous creates with the same `Idempotency-Key`, which is a double-click, **terminate the API process** (exit 1, health unreachable afterwards). An uncaught `P2002` rejects out of an Express 4 async handler on Node 24. Reproduced twice; a control with different keys leaves the server up. (2) Actions can be created on `CLOSED`, `CANCELLED` and `RESOLVED` Tickets, and completed on a `CLOSED` one, although his api-spec promises `409`. (3) Five rules removed one at a time (ownership, active assignee, PATCH version, freeze on finished Actions, who-may-edit) each leave his whole suite green at 99 passed, the control's count, while `tests.md` marks API-02 *Implemented*. Five non-blocking items. One candidate finding died on checking: a `409` on replay came from my probe sending different timestamps. **Round two:** [**changes requested**, 2026-09-26](https://github.com/Earth2509/toktickit/pull/62#pullrequestreview-5325576033), on `48a10a4`. All three findings are fixed in behaviour, re-measured rather than read. Four simultaneous same-key creates now give one row and the server stays up. Terminal Tickets refuse create and PATCH. A forced race proves the new row lock is load-bearing: with it the create gets `409`, without it `201` onto a cancelled Ticket. Seven of nine rule breaks now fail a named test. One blocking point remains: the test named for the inactive-assignee rule passes with that rule deleted, because its mock returns `null` for any query. | [Commit `48a10a4`](https://github.com/Earth2509/toktickit/commit/48a10a472d523aeaeffa4f1c697cc0ba91b72195) addressed round one, [with a comment](https://github.com/Earth2509/toktickit/pull/62#issuecomment-5844669600) requesting re-review. Round two is awaiting his response. | Open |

---

## Notes

- Rows are added as reviews happen, with the link to the review itself, never reconstructed
  at the end of the sprint. In Lab 3 this file silently fell eleven rows behind despite that
  rule, because nothing checked it. It is therefore re-read against GitHub before every
  release, and the check is part of issue #91.
- A review given as "Changes requested" is recorded as that, followed by the response and the
  eventual approval as separate facts. It is never rewritten as an approval.
