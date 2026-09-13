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
| Issue [#44](https://github.com/Nuggetkub/toktickit/issues/44) / [PR #58](https://github.com/Nuggetkub/toktickit/pull/58) | The Sprint 3 engineering contract: `specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`, `reviewer.md`, `ai-use.md` | **Changes requested**, 2026-09-13, on commit `8cc8431`. Four consistency and coverage gaps: the Change Password checklist in `ui-spec.md` showed only three of the five rules BR-11 states, so a whitespace-only password or one equal to the account email could look valid and still be refused by the API; no planned test proved how a migrated Lab 2 Requester receives an initial password and is forced to change it, which labsheet §5.2 requires to be documented *and* tested; RESP-01 and the screenshot paths omitted My Tickets and Requester Ticket Detail although both change in Lab 3; and §8 said `403` was "for role refusals only" while `api-spec.md` also defines `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_INACTIVE` and `ORIGIN_REJECTED`. | All four accepted — none needed argument. The checklist now lists all five rules and UI-02 asserts the two that were missing; **DB-05** covers the migrated Requester's initial-password journey and is traced to AC-02 and AC-11; RESP-01 and the screenshot paths now include both Requester screens; §8 and decision D-07 now name all four `403` codes and say why none of them discloses a resource. Traceability re-checked by script. | Awaiting re-review |

## Reviews I Gave on My Peer's Pull Requests — `Earth2509/toktickit`

| His issue / His pull request | Scope | My feedback | His response | Outcome |
|---|---|---|---|---|
| Earth2509 issue [#34](https://github.com/Earth2509/toktickit/issues/34) / [Earth2509 PR #35](https://github.com/Earth2509/toktickit/pull/35) | His Lab 3 engineering contract: `specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`, `reviewer.md`, `ai-use.md`, `backlog.md` | [**Changes requested**, 2026-09-11](https://github.com/Earth2509/toktickit/pull/35#pullrequestreview-5181355623), on commit `6392536`. I cloned his branch and checked the contract against his code: the baseline commit, the model and route names the migration relies on, and the AC-to-test matrix, which I checked by script. Three blocking items: the Administrator role filter was dropped although labsheet §8.5 and Part 8 require it; "terminal" and "active-work" were used as rules but never defined, and the uses disagreed; the Requester's resolution indication was never shown to IT Staff, which Part 7 grades. Four non-blocking items — a timing-based account-enumeration gap at sign-in, the proxy-versus-CORS transport being undecided, a `401` for a wrong current password, and seeded credentials kept outside Git — plus four nits. | He fixed all seven in `cf87b96`: an authoritative eight-row status policy table, the role filter, the indication shown to IT Staff, dummy-hash verification for unknown and null-hash accounts, the same-origin proxy chosen explicitly, `422` on the current-password field, and documented `example.test` seed credentials. | [**Approved**, 2026-09-12](https://github.com/Earth2509/toktickit/pull/35#pullrequestreview-5181355623) after re-checking each item against his files and re-running his traceability by script; merged into his `lab3-staging` as `d819957` |
| Earth2509 issue [#36](https://github.com/Earth2509/toktickit/issues/36) / [Earth2509 PR #37](https://github.com/Earth2509/toktickit/pull/37) | His authentication foundation: the `Requester`→`User` migration, scrypt hashing, sessions, CSRF, the same-origin proxy, fixture seed, and the Lab 3 test files — 31 files | **Changes requested**, 2026-09-13, on commit `f99687e`. Found by *running* the branch, not reading it: `GET /api/requesters` was still live — his own `api-spec.md` says it returns `404` — and after the table rename it queried `user.findMany` with no role filter, so an unauthenticated `curl` returned IT Staff and Administrator accounts including `admin@example.test`. With his own five-failure throttle that also allows an anonymous caller to lock out the only Administrator. His existing test mocked `findMany` wholesale and so could never catch it. Three non-blocking notes: the migration suite self-skips without its environment variable; the `tests.md` Final column held prose about a feature-branch run; four nits. | He fixed it in `b564a06`: the route now filters `role: "REQUESTER"`, with a real-Prisma regression assertion, startup configuration validation, `INTERNAL_ERROR` on 500 bodies, and `tests.md` restored to `Planned`/`Passed`. | [**Approved**, 2026-09-13](https://github.com/Earth2509/toktickit/pull/37) and merged as `aeb38a9`. I re-probed the running API — only the four Requester fixtures are returned — and then **removed his role filter to prove his new test fails**: it did, at `migration.test.ts:87`, exit code 1, and passed again once restored |

---

## Notes

- Rows are added as reviews happen, with the link to the review itself, not reconstructed at
  the end of the sprint.
- A review given as "Changes requested" is recorded as that, followed by the response and the
  eventual approval as separate facts. It is never rewritten as an approval.
