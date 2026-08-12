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

@Earth2509 rebuilt his repository at
[github.com/Earth2509/toktickit](https://github.com/Earth2509/toktickit) on
2026-08-11, so the review below is on the current repository.

| PR | Branch | Target | My verdict |
|----|--------|--------|------------|
| [Earth2509/toktickit#1](https://github.com/Earth2509/toktickit/pull/1) | feature/1-project-foundation | lab1-staging | commented 2026-08-11, approved 2026-08-12 after revision |

### My comment

Posted as a Comment rather than an approval, because the branch did not build what
its description claimed
([review](https://github.com/Earth2509/toktickit/pull/1#pullrequestreview-4908971476)):

> **`Closes #1` points at this pull request, not an issue.** Issues and PRs share one
> number space on GitHub, and this PR took #1 (...) There are actually no issues in
> the repo at all.
>
> **There is no `server/prisma/schema.prisma`.** (...) `server/package.json` points at
> that directory twice (...) so on a fresh clone `npm run prisma:migrate` fails with
> no schema and `npm run prisma:seed` fails with no such file.
>
> **Neither test suite has any tests to run.** (...) `vitest run` exits non-zero with
> "No test files found", so `npm test` is a failing command on this branch.
>
> **`docs/lab-01/` still has the template content, and it does not match the repo.**
> (...) `tests.md` lists 14 tests marked PASSED, including `GET/POST/PATCH
> /api/tickets`, which is not Lab 1 scope and does not exist in the code.

### Partner's response

He pushed seven commits the next morning and replied:

> "@Nuggetkub I addressed the Issue 1 feedback: added the base Prisma configuration,
> corrected README and Lab 1 evidence to reflect the actual repository, and made the
> foundation test commands usable before feature tests are introduced. The four
> GitHub Issues are now present. Please re-review PR #1 when convenient."

I verified each claim against the branch — `server/prisma/schema.prisma` present with
the `postgresql` provider, issues #2–#5 created, `npm test` green on both sides via
`--passWithNoTests`, and the three `docs/lab-01/` files rewritten to describe only
work that exists — then
[approved](https://github.com/Earth2509/toktickit/pull/1#pullrequestreview-4915251139)
with four non-blocking follow-ups, the main one being that `Closes #1` now needs to be
`Closes #2` or issue #2 will stay open after the merge.
