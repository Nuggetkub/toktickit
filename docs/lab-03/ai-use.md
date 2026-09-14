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
| 4 | "now let's start our work" | Produced issues #44–#57, the protected `lab3-staging` branch, and the first draft of this sprint's contract. **The draft was built to avoid the defects I had just reported in my partner's contract** — the role filter, an undefined "terminal", the indication invisible to IT Staff, timing-based account enumeration. I read the full specification, including every design decision in `specification.md` §11, before this pull request was opened, and approved it without changes. |

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
