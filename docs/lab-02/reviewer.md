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
| [#17](https://github.com/Nuggetkub/toktickit/issues/17) / [PR #29](https://github.com/Nuggetkub/toktickit/pull/29) | Lab 2 engineering contract and test plan | @Earth2509 reviewed on 2026-08-27 and found the specification, API, test, UI and AI-use documents thorough and internally consistent, but **withheld approval because `docs/lab-02/reviewer.md` was missing.** The labsheet §12 lists it as one of the six required documents in the Lab 2 repository increment; the pull request shipped only five. | The finding is correct. `reviewer.md` had been scheduled against the release issue [#28](https://github.com/Nuggetkub/toktickit/issues/28) rather than the contract issue, which misread §12. This file was added to the same branch and re-review requested. | **Pending re-review.** |

---

## Reviews I Gave on My Peer's Pull Requests

| Pull Request | Feedback given | Peer response | Outcome |
|---|---|---|---|
| [Earth2509/toktickit PR #12](https://github.com/Earth2509/toktickit/pull/12) — Lab 2 engineering contract and test plan | Reviewed as a **Comment** on 2026-08-26, not an approval. Eight findings: Ticket Date was absent from the Create Ticket layout although labsheet §4.4 requires it on that screen; `reviewer.md` recorded only reviews received, with no section for reviews given and no PR links, which Part 1 asks for; `sortBy=requestedPriority` had no defined ordering, so a string column would have sorted `HIGH, LOW, MEDIUM, URGENT` alphabetically; the Current Status filter could never change a result set, since every Lab 2 ticket is `NEW`; the planned Playwright suite had no owning issue and the repository had no Playwright config, dependency or `e2e/` directory; no GitHub Project board could be found, which Part 1 grades; `ai-use.md` listed prompt *purposes* rather than the prompts themselves; and validation returned `422` on create but `400` on the list query, with `idempotencyKey` neither marked required nor defining what made a key "conflicting". | Replied on 2026-08-27 and pushed commit `2b50480` addressing all eight. Verified against the commit diff rather than the summary: the priority enum was declared in severity order with ascending and descending documented, idempotency conflict was defined as a differing normalized payload, the `400`/`422` split was explained, Ticket Date was added with reserved pre-submission positions, `reviewer.md` was split into reviews received and reviews given with working links, prompts were replaced with quoted text, and the E2E infrastructure dependency was documented. | **Approved 2026-08-27**, with two non-blocking notes: one sentence in his `reviewer.md` had already fallen out of date, and the Project board still did not exist. Merged by the author on 2026-08-27. |

---

## Notes

- Two review directions are recorded deliberately. Part 1 asks for "comments given and
  received", and a record that shows only one direction is incomplete regardless of how
  much detail it carries.
- Reviews are recorded when they happen rather than reconstructed at release. A row written
  three weeks later tends to describe what was intended rather than what occurred — a
  failure this project has already seen once, in the Lab 1 review record, where a row still
  read "review in progress" after the pull request had merged.
