# Lab 2 Peer Review Record

**Author:** Sittijed Jantarataeme — Student ID 67070501046 — GitHub [@Nuggetkub](https://github.com/Nuggetkub)
**Peer reviewer:** Pattharapon Kijjanukij — Student ID 67070501069 — GitHub [@Earth2509](https://github.com/Earth2509)

Both students review each other's work. This record is written from actual GitHub activity
only — every row below corresponds to a real review, comment, or merge that can be opened
at the linked URL. No approval is recorded before it happens.

## Review Workflow

Each Lab 2 issue is implemented on its own feature branch and enters `lab2-staging` through
a peer-reviewed Pull Request. The release Pull Request from `lab2-staging` to `main`
requires review and approval as well. Both branches are protected: one approving review is
required, stale approvals are dismissed on a new push, and the rule is enforced for the
repository owner too, so an unreviewed merge is not possible.

---

## Reviews Received on My Pull Requests

| Issue / Pull Request | Scope | Reviewer feedback | Author response | Outcome |
|---|---|---|---|---|
| [#17](https://github.com/Nuggetkub/toktickit/issues/17) / [PR #29](https://github.com/Nuggetkub/toktickit/pull/29) | Lab 2 engineering contract and test plan | @Earth2509 reviewed on 2026-08-27 and found the specification, API, test, UI and AI-use documents thorough and internally consistent, but **withheld approval because `docs/lab-02/reviewer.md` was missing.** The labsheet §12 lists it as one of the six required documents in the Lab 2 repository increment; the pull request shipped only five. | The finding is correct. `reviewer.md` had been scheduled against the release issue [#28](https://github.com/Nuggetkub/toktickit/issues/28) rather than the contract issue, which misread §12. This file was added in `86b796c` and re-review requested. | **Approved and merged 2026-08-28.** |
| [#18](https://github.com/Nuggetkub/toktickit/issues/18) / [PR #30](https://github.com/Nuggetkub/toktickit/pull/30) | Zen Green UI foundation and application shell | @Earth2509 reviewed on 2026-08-28. He found the component boundaries clear and confirmed the widened test glob and `noEmit`, but withheld approval on two items: (1) `Field` wires an error with `aria-describedby` only, so **a validation message appearing after submit is never announced** — he asked for `role="alert"` or `aria-live` plus a focused test; (2) this file had no row for PR #30. | Both correct. `aria-describedby` is read only when the control takes focus, so an error revealed by submitting is silent for anyone positioned elsewhere on the form. The message now carries `role="alert"`, a test asserts the valid-to-invalid transition announces it, and `ui-spec.md` §3 records the decision together with the condition under which it should be revisited — several assertive announcements at once is its own problem, and the answer then is a polite region plus an error summary. This row is the second item. | **Pending re-review.** |

---

## Reviews I Gave on My Peer's Pull Requests

| Pull Request | Feedback given | Peer response | Outcome |
|---|---|---|---|
| [Earth2509/toktickit PR #12](https://github.com/Earth2509/toktickit/pull/12) — Lab 2 engineering contract and test plan | Reviewed as a **Comment** on 2026-08-26, not an approval. Eight findings: Ticket Date was absent from the Create Ticket layout although labsheet §4.4 requires it on that screen; `reviewer.md` recorded only reviews received, with no section for reviews given and no PR links, which Part 1 asks for; `sortBy=requestedPriority` had no defined ordering, so a string column would have sorted `HIGH, LOW, MEDIUM, URGENT` alphabetically; the Current Status filter could never change a result set, since every Lab 2 ticket is `NEW`; the planned Playwright suite had no owning issue and the repository had no Playwright config, dependency or `e2e/` directory; no GitHub Project board could be found, which Part 1 grades; `ai-use.md` listed prompt *purposes* rather than the prompts themselves; and validation returned `422` on create but `400` on the list query, with `idempotencyKey` neither marked required nor defining what made a key "conflicting". | Replied on 2026-08-27 and pushed commit `2b50480` addressing all eight. Verified against the commit diff rather than the summary: the priority enum was declared in severity order with ascending and descending documented, idempotency conflict was defined as a differing normalized payload, the `400`/`422` split was explained, Ticket Date was added with reserved pre-submission positions, `reviewer.md` was split into reviews received and reviews given with working links, prompts were replaced with quoted text, and the E2E infrastructure dependency was documented. | **Approved 2026-08-27**, with two non-blocking notes: one sentence in his `reviewer.md` had already fallen out of date, and the Project board still did not exist. Merged by the author on 2026-08-27. |
| [Earth2509/toktickit PR #21](https://github.com/Earth2509/toktickit/pull/21) — Development Requester foundation | Reviewed as a **Comment** on 2026-08-28. The branch was checked out and run rather than read: his test and build claims were accurate. Findings: the committed migration had **never been executed** — he had synced with `prisma db push`, so `migration_lock.toml` was absent and nothing proved the migration applied to an empty database; Bootstrap was still imported although no Bootstrap class remained, giving a 233 kB CSS bundle against his own 3.1 kB sheet; the blanket `fetch` mock from his Lab 1 PR #8 had returned; `client/package-lock.json` was missing while the server one was committed; and Change Requester did not refresh the requester list. | He fixed all of it: committed `migration_lock.toml`, verified `prisma migrate reset` against an isolated schema, ran the seed twice, removed Bootstrap, added the client lockfile, routed the fetch mocks by URL and refreshed on change. | **Merged 2026-08-28 without an approval on record** — only the Comment review existed. Raised with him on PR #22; he corrected his own review record to say so, and was asked to enable branch protection. |
| [Earth2509/toktickit PR #22](https://github.com/Earth2509/toktickit/pull/22) — Ticket creation API | Reviewed as a **Comment** on 2026-08-28. Verified by checking out the branch, running the suite and the build, then writing throwaway probe suites for the two paths his tests did not cover. His `P2002` idempotency-race recovery proved genuinely correct under probe. One **demonstrable defect**: his error middleware handled `SyntaxError` then called `next(error)` with no handler after it, so a JSON body over the 100 kB `express.json` default returned `413 text/html` carrying a `PayloadTooLargeError` stack trace and absolute filesystem paths — contrary to his own `api-spec.md`. Also: the race path had no test, everything unexpected returned `503` where his spec splits `500`/`503`, and nothing asserted the `PENDING-` placeholder never reached the client. | Fixed in `d80eb07`: a final four-argument error handler, `P2002` tests for both branches, the `500`/`503` split, and an assertion that the public number matches `TT-YYYY-NNNNNN` with no `PENDING-`. Test count went from 15 to 20. | **Approved 2026-08-28** after re-running the same probe: the oversized body now returns `413 application/json` with no stack trace. |

---

## Notes

- Two review directions are recorded deliberately. Part 1 asks for "comments given and
  received", and a record that shows only one direction is incomplete regardless of how
  much detail it carries.
- Reviews are recorded when they happen rather than reconstructed at release. A row written
  three weeks later tends to describe what was intended rather than what occurred — a
  failure this project has already seen once, in the Lab 1 review record, where a row still
  read "review in progress" after the pull request had merged.
