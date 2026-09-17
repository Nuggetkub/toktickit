# Lab 3 AI Use and Reflection

**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub

| | |
|---|---|
| **Primary LLM** | Claude Opus 5 (`claude-opus-5`) |
| **Platform** | Claude Code CLI, run locally against this repository |
| **Responsibility** | Every specification, decision, business rule, test, command and submitted artefact is reviewed and approved by me. The agent drafts and investigates; I decide and remain accountable. |

This record is written as the sprint proceeds rather than reconstructed at the end. Rows 1
to 4 were written during the engineering-contract stage (issue #44). Later rows are added
as the implementation issues are delivered, and the reflection is written at release
(issue #57).

---

## Selected Key Prompts

Prompts are quoted as they were actually sent.

| # | Prompt | How the result was reviewed and used |
|---|---|---|
| 1 | "read Lab_3_sheet.pdf and understand the requirement" | The PDF renderer was missing on this machine, so the agent extracted the text and rendered every page to an image instead, including the four mockups. It found what a quick read misses: the mockups contradict the written scope in six places — a reset-email checkbox, a Forgot-password link, user-list pagination, a Service Actions tab, a Pending status, and a Deactivate button on a user that does not exist yet — and four sections only say "same as Lab 2". **I had it resolve those four against the Lab 2 labsheet** rather than assume, which is where the branch flow, the breakpoints and the two-part Definition of Done came from. The six deviations are now `ui-spec.md` §12. |
| 2 | "check Earth2509's pull request and review" | His Lab 3 contract, Earth2509 PR #35. As in Lab 2, the review had to rest on his repository, not his description: the agent cloned the branch, confirmed his baseline commit, checked that the model and route names his migration relies on really exist, and verified his traceability matrix by script. It found that his contract promised a Vite proxy in one file and a CORS allowlist in another, while his code had neither. The draft was shown to me before anything was posted. |
| 3 | "post it as request changes" | I chose the verdict. The agent recommended Request Changes; I agreed, because three of the findings were points the coding agent would otherwise have decided on his behalf. After posting, it confirmed the review's state and commit through the GitHub API rather than trusting the command's silence. |
| 4 | "ืnow let's start our work" | Produced issues #44–#57, the protected `lab3-staging` branch, and the first draft of this sprint's contract. **The draft was built to avoid the defects I had just reported in my partner's contract** — the role filter, an undefined "terminal", the indication invisible to IT Staff, timing-based account enumeration. I read the full specification, including every design decision in `specification.md` §11, before this pull request was opened, and approved it without changes. |

| 5 | "I read it not thing disagree" | My approval of the 18 design decisions in `specification.md` §11 — server-side sessions over JWTs, an `Origin` allowlist instead of a CSRF token, scrypt over bcrypt, length-only password rules against the labsheet mockup's composition rules. I read the section in full before saying this. The agent had written each decision with its reasoning next to it, which is what made the section reviewable at all; a list of choices without reasons could not have been approved or refused on any real grounds. |
| 6 | "check Earth2509's pull request and review" | His authentication foundation, PR #37 — the review I am most glad we ran. His table rename put IT Staff and Administrators into the table that `GET /api/requesters` returns, and that endpoint needed no authentication, so it handed every staff and administrator email address to an anonymous caller. The agent did not merely read this in the diff: it started his API and probed the live endpoint. **I then required the same check on our own code**, where the identical defect was waiting, and the role filter and its test went into our issue #45 before his fix had even landed. |
| 7 | "now let's continue our work" | The session authentication API (our issue #46). The instruction I gave once and now apply to every security control: prove the test fails when the guard is removed. It exposed two of our own guards as untested — deleting the dummy-hash line changed only *timing*, so every assertion still passed, and the password-change gate was protecting no route yet. Both now have tests that genuinely fail: the timing test reads a ratio of 0.019 when broken, about fifty times faster. My partner then found a real defect in the same PR that I had missed, and he was right. |
| 8 | "continue our work" | Issue #47 — retiring the `X-Dev-Requester-Id` header and putting every Lab 2 route behind the session and the role matrix. The rule I set came from his PR #39, where a `vitest.config.ts` exclusion had hidden 29 failing tests behind a passing summary: **the existing suites are to be authenticated, never excluded or weakened.** So all four Lab 2 API suites and a Lab 1 suite were converted to sign in and kept every assertion they had. The conversion immediately caught a route I had not thought about — the Lab 1 categories test — which is exactly what it was for. |
| 9 | "continue our work" | Issue #51 — the ticket workflow. Two things from it belong on the record. First, I had objected on his PR #47 that an 8×8 transition test took its expectations from the implementation's own table, so it would pass unchanged if a row were wrong. When that matrix became ours to write, **the same standard was applied to us**: BR-29 is transcribed by hand in `ticket-workflow.test.ts` and the implementation's table is asserted equal to the transcription. Second, the agent's first draft set a ticket's owner through a nested Prisma relation write and **cast it to satisfy the compiler**. Typecheck passed, all 79 unit tests passed, and the real database rejected it the moment the API suite ran it. The cast was the defect, because it told the compiler something untrue; the fix was the input type that actually carries the foreign key, not a different cast. It is this sprint's clearest argument for running that suite against real Postgres instead of a mock, which can only return what it was told. |

### Deliberate constraints I placed on the agent

- **Draft, then let me check, then post.** Nothing is published to my partner's repository
  until I have read it.
- **Verify against the source, not the summary.** The labsheet PDF, my partner's code, and
  GitHub's own record of what was posted — never a description of them.
- **Evidence is generated, never typed.** Test results enter `tests.md` only by copying the
  output of a real run on `main`.

---

## My Reflection

To be written at release (issue #57), once the implementation has tested this contract.
