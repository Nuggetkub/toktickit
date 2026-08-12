# Lab 1 — Peer Review Record

**Author:** Sittijed Jantarataeme — 67070501046 — GitHub: @Nuggetkub
**Peer reviewer:** Pattharapon Kijjanukij — 67070501069 — GitHub: @Earth2509

## Pull Requests I authored (reviewed by my partner)

| PR | Branch | Target | Reviewer verdict |
|----|--------|--------|------------------|
| [#5](https://github.com/Nuggetkub/toktickit/pull/5) | feature/1-project-foundation | lab1-staging | approved by @Earth2509, merged 2026-08-08 |
| [#6](https://github.com/Nuggetkub/toktickit/pull/6) | feature/2-health-check | lab1-staging | approved by @Earth2509, merged 2026-08-08 |
| [#7](https://github.com/Nuggetkub/toktickit/pull/7) | feature/3-category-seed | lab1-staging | approved by @Earth2509, merged 2026-08-09 |
| [#8](https://github.com/Nuggetkub/toktickit/pull/8) | feature/4-category-list | lab1-staging | approved by @Earth2509, merged 2026-08-09 |
| [#9](https://github.com/Nuggetkub/toktickit/pull/9) | lab1-staging (release) | main | approved by @Earth2509, merged 2026-08-09 |
| [#10](https://github.com/Nuggetkub/toktickit/pull/10) | fix/env-port-and-reviewer-log | lab1-staging | approved by @Earth2509, merged 2026-08-09 |
| [#13](https://github.com/Nuggetkub/toktickit/pull/13) | feat/review-followups | lab1-staging | approved by @Earth2509, merged 2026-08-10 |
| [#12](https://github.com/Nuggetkub/toktickit/pull/12) | docs/readme-and-report-schemas | lab1-staging | approved by @Earth2509, merged 2026-08-10 |
| [#11](https://github.com/Nuggetkub/toktickit/pull/11) | lab1-staging (release) | main | approved by @Earth2509, merged 2026-08-10 |
| [#14](https://github.com/Nuggetkub/toktickit/pull/14) | docs/author-details | lab1-staging | approved by @Earth2509, merged 2026-08-12 |
| [#15](https://github.com/Nuggetkub/toktickit/pull/15) | lab1-staging (release) | main | in review |

Listed in merge order, which is not PR-number order: #13 and #12 were opened before
#11 but merged after it.

### Reviewer comment I received

@Earth2509 reviewed as numbered answers on each PR rather than one verdict. Four of
them asked for a change:

> **#6, point 1** — "Pin it via configuration (`process.env.CLIENT_ORIGIN ||
> "http://localhost:5173"`) because wildcard (\*) allows any origin to access the
> API, which is unsafe for production. Restricting origin to
> `http://localhost:5173` or an env variable follows the principle of least
> privilege while preserving local development flexibility."
>
> **#6, point 2** — "Yes, translate raw errors in `api.ts`. because raw browser
> errors like `TypeError: Failed to fetch` leak technical details and degrade UX.
> Translating them to "Cannot reach TokTickIT API server" directly fulfills the lab
> acceptance criterion: "A useful error message appears when the backend is
> unavailable"."
>
> **#6, point 4** — "Read from `package.json` or a central config file because
> importing the `name` field from `package.json` adheres to the DRY (Don't Repeat
> Yourself) principle. It ensures a single source of truth, preventing metadata
> drift if the service is renamed."
>
> **#8, point 3** — "Mocking at the fetch level is better because mocking
> `checkSystem` skips `api.ts` completely, leaving network error translation
> untested. Mocking `global.fetch` or using MSW tests both `api.ts` and the UI
> component together, providing higher test coverage and confidence."

He also confirmed three decisions I had questioned rather than asking for changes:
`update: {}` in the seed upsert is correct for static reference data (#7), sequential
seeding is right because it fixes the autoincrement ids the tests depend on (#7), and
`/api/health` should stay shallow for Lab 1 rather than pinging the database (#8).

### How I responded

I implemented all four suggestions in [#13](https://github.com/Nuggetkub/toktickit/pull/13),
and recorded where I deviated and why:

- **CORS** is now pinned to `CLIENT_ORIGIN`, defaulting to `http://localhost:5173`,
  verified with `curl -i` returning `Access-Control-Allow-Origin: http://localhost:5173`.
- **Network errors** are translated in `api.ts`, but to "Unable to connect to
  TokTickIT API" rather than his suggested "Cannot reach TokTickIT API server" —
  the demo specification asks for that exact string. Same intent, and it also closed
  a wording gap against the acceptance criteria. HTTP status failures still report
  their status, so a 500 stays distinguishable from an unreachable server.
- **Service name** moved into `package.json`, but as a new `displayName` field read
  through `src/config.ts`. Reading `name` directly was not viable: the package is
  `toktickit-server` while the API must identify itself as `TokTickIT API`, so
  reusing `name` would have broken the response contract that API-01 asserts.
- **Client tests** now stub `fetch` instead of `checkSystem`, so the real `api.ts`
  runs and its error translation is actually covered. Each endpoint is routed
  separately so an ordering bug cannot hide.

One point of his I checked rather than accepted. On #5 he argued the `!.env.example`
negation in `.gitignore` was "strictly required" because `*.env` matches
`.env.example`. The conclusion is right — the line should stay — but the reasoning is
not: `*.env` does not match `.env.example`, it is the bare `.env` pattern that does.
I confirmed this by testing the pattern in a scratch repository before responding.

## Pull Requests I reviewed for my partner

One pull request per issue on
[github.com/Earth2509/toktickit](https://github.com/Earth2509/toktickit), all four
reviewed and all four merged on 2026-08-12.

| PR | Issue | Branch | My verdict |
|----|-------|--------|------------|
| [#1](https://github.com/Earth2509/toktickit/pull/1) | Issue 1 — project foundation | feature/1-project-foundation | commented, approved after revision |
| [#6](https://github.com/Earth2509/toktickit/pull/6) | Issue 2 — API health check | feature/2-health-check | approved with notes |
| [#7](https://github.com/Earth2509/toktickit/pull/7) | Issue 3 — category seed | feature/3-category-seed | approved with notes |
| [#8](https://github.com/Earth2509/toktickit/pull/8) | Issue 4 — category list | feature/4-category-list | changes requested, approved after two revisions |

On #1 I commented rather than approving, because the branch did not build what its
description claimed — the PR body listed Prisma configuration and working test
commands that were not in the tree. He pushed seven commits and replied; I checked
each claim against the branch before approving.

On #7 I raised something affecting the whole repository rather than that PR: his
`Closes #N` references were correct but were never firing, because GitHub only
auto-closes an issue when the closing PR merges into the **default** branch. His
feature PRs merge into `lab1-staging`, so four issues stayed open next to four merged
PRs. I checked the same thing on my own repository afterwards.

### My comment

The fullest exchange was #8, so it is the one recorded here. I requested changes
([review](https://github.com/Earth2509/toktickit/pull/8#pullrequestreview-4918403822))
after cloning the branch and running both suites, rather than reading the diff alone:

> ```text
> client   Tests  2 failed | 1 passed (3)
> TypeError: categories.map is not a function
>  ❯ App src/App.tsx:3:951
> ```
>
> `check()` now calls `fetchHealth()` and then `fetchCategories()`, but
> `App.test.tsx` still stubs a single blanket mock, so both calls receive the same
> health payload — `fetchCategories()` resolves to an object instead of an array.

The stack position `App.tsx:3:951` was the second finding: the component had been
collapsed onto one 1000-character line, which also dropped `role="status"` from the
Online state.

He fixed both, but the fix replaced a hard-coded message with `caughtError.message`
while `api.ts` still had no `try`/`catch` around `fetch` — so a rejected fetch
rendered the browser's raw error. I probed his component and reported what a user
would actually see:

> ```text
> RENDERED ALERT TEXT >>> "System Status: OfflineFailed to fetch"
> ```
>
> That is your own words on my #6: "raw browser errors like `TypeError: Failed to
> fetch` leak technical details and degrade UX." Your error test cannot catch it,
> because it stubs the rejection with the friendly message — the assertion passes on
> a string the test itself supplied.

I had called that same change a clean fix in my previous review, so I said so rather
than presenting the correction as something he should have caught alone.

### Partner's response

> "@Nuggetkub Fixed the network-error regression in `api.ts` and added a regression
> test using `TypeError("Failed to fetch")`. The alert now shows the friendly
> connection message and explicitly does not expose the raw browser error. Please
> re-review when ready."

I re-ran both suites and probed both failure modes before
[approving](https://github.com/Earth2509/toktickit/pull/8):

```text
client   Tests  3 passed (3)
server   Tests  2 passed (2)

NETWORK-DOWN >>> "System Status: OfflineUnable to connect to TokTickIT API"
DB-DOWN      >>> "System Status: OfflineUnable to load request categories"
```

An unreachable API and a reachable API with a failing database now report different
things, which neither of our repositories did at the start of the lab.
