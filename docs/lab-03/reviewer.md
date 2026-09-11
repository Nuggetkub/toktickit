# Lab 3 Peer Review Record

**Author:** Sittijed Jantarataeme — Student ID 67070501046 — GitHub [@Nuggetkub](https://github.com/Nuggetkub)
**Peer reviewer:** Pattharapon Kijjanukij — Student ID 67070501069 — GitHub [@Earth2509](https://github.com/Earth2509)

Both students review each other's work. This record is written from actual GitHub activity
only — every row corresponds to a real review, comment, or merge that can be opened at the
linked URL. No approval is recorded before it happens.

## Review Workflow

**This section describes `Nuggetkub/toktickit`, the repository this document lives in.**
Each Lab 3 issue, [#44](https://github.com/Nuggetkub/toktickit/issues/44) to
[#57](https://github.com/Nuggetkub/toktickit/issues/57), is implemented on its own feature
branch and enters `lab3-staging` through a peer-reviewed Pull Request. The release Pull
Request from `lab3-staging` to `main` requires review and approval as well. Both branches
are protected: one approving review is required, stale approvals are dismissed on a new
push, and the rule is enforced for the repository owner too, so an unreviewed merge is not
possible here.

**The two repositories number things independently, and the ranges overlap.** In this
repository the Lab 3 issues are #44–#57 and its Lab 3 pull requests begin at #58; in
`Earth2509/toktickit` the Lab 3 contract is issue #34 and pull request #35. Every reference
below is written as either `Issue #n`, `PR #n` for this repository, or `Earth2509 PR #n`,
and every link resolves to the thing its label names.

---

## Reviews Received on My Pull Requests — `Nuggetkub/toktickit`

| My issue / My pull request | Scope | Reviewer feedback | Author response | Outcome |
|---|---|---|---|---|
| — | — | No Lab 3 pull request has been reviewed yet. | — | — |

## Reviews I Gave on My Peer's Pull Requests — `Earth2509/toktickit`

| His issue / His pull request | Scope | My feedback | His response | Outcome |
|---|---|---|---|---|
| Earth2509 issue [#34](https://github.com/Earth2509/toktickit/issues/34) / [Earth2509 PR #35](https://github.com/Earth2509/toktickit/pull/35) | His Lab 3 engineering contract: `specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`, `reviewer.md`, `ai-use.md`, `backlog.md` | [**Changes requested**, 2026-09-11](https://github.com/Earth2509/toktickit/pull/35#pullrequestreview-5181355623), on commit `6392536`. I cloned his branch and checked the contract against his code: the baseline commit, the model and route names the migration relies on, and the AC-to-test matrix, which I checked by script. Three blocking items: the Administrator role filter was dropped although labsheet §8.5 and Part 8 require it; "terminal" and "active-work" were used as rules but never defined, and the uses disagreed; the Requester's resolution indication was never shown to IT Staff, which Part 7 grades. Four non-blocking items — a timing-based account-enumeration gap at sign-in, the proxy-versus-CORS transport being undecided, a `401` for a wrong current password, and seeded credentials kept outside Git — plus four nits. | Awaiting his response. | Open |

---

## Notes

- Rows are added as reviews happen, with the link to the review itself, not reconstructed at
  the end of the sprint.
- A review given as "Changes requested" is recorded as that, followed by the response and the
  eventual approval as separate facts. It is never rewritten as an approval.
