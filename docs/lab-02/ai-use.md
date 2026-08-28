# Lab 2 AI Use and Reflection

**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub

| | |
|---|---|
| **Primary LLM** | Claude Opus 5 (`claude-opus-5`) |
| **Platform** | Claude Code CLI, run locally against this repository |
| **Secondary tool** | Google NotebookLM, via the `notebooklm` CLI, used to query the Lab 2 labsheet PDF |
| **Responsibility** | Every specification, decision, business rule, test, command and submitted artefact is reviewed and approved by me. The agent drafts and investigates; I decide and remain accountable. |

This record is written as the sprint proceeds rather than reconstructed at the end. It
currently covers the engineering-contract stage (issue #17) and is completed at release
(issue #28), when the implementation prompts are added.

---

## Selected Key Prompts

Prompts are quoted as they were actually sent.

| # | Prompt | How the result was reviewed and used |
|---|---|---|
| 1 | "Let's understand Lab_02_labsheet.pdf with notebooklm and check Earth2509 pull request" | The labsheet was added as a NotebookLM source and queried for objectives, deliverables, the grading table and the submission format. **I did not take the answer on trust** — the extracted PDF text was read directly and every graded claim was checked against it. NotebookLM was accurate here, including the 60-point split; it also correctly reported that the labsheet states no deadline and no filename convention, which the PDF confirmed. |
| 2 | "write up the review for me to check before posting" | Produced a draft peer review of the partner's Lab 2 contract PR. I required it to be drafted for checking rather than posted directly. The draft's claims were verified against the partner's repository before I approved sending — one claim about a missing Project board was deliberately hedged because a private board would not be visible to me. |
| 3 | "post it" | The review was posted as a Comment rather than an Approval, because the findings were completeness gaps against graded criteria. |
| 4 | "draft the issue decomposition" | Produced the twelve-issue breakdown for this sprint with dependencies and branch names. I reviewed the ordering and kept the layering — contract, then theme and data, then each API before the screen that consumes it — because it makes each issue independently reviewable. |
| 5 | "create the issues and the lab2-staging branch" | Issues #17–#28 and the `lab2-staging` branch were created. The issues were created sequentially on purpose so their numbers matched the cross-references already written into their bodies. |
| 6 | "check Earth2509 pull request again" | Checked whether the partner had responded. He had, with a fix commit. **The commit diff was read rather than his summary of it** — the same habit that caught two stale evidence rows in his Lab 1 pull request. This time everything he claimed was genuinely there. |
| 7 | "post the approval" | Approved his PR, with two non-blocking notes: one sentence in his `reviewer.md` had already fallen out of date, and his Project board still did not exist. |
| 8 | "start on #17" | Produced the first draft of `specification.md`, `api-spec.md`, `tests.md`, `ui-spec.md` and this file. I directed the design decisions recorded in `specification.md` §11 and reviewed every business rule and acceptance criterion before committing. |

### Deliberate constraints I placed on the agent

- **Draft, then let me check, then post.** Nothing was published to my partner's repository
  or to GitHub until I had read it. Prompt 2 exists precisely to create that gap.
- **Verify against the source, not the summary.** Applied to the labsheet (prompt 1) and to
  my partner's fix commit (prompt 6). Both times the instruction changed what was checked.
- **Write this contract independently.** The agent had read my partner's Lab 2 contract in
  detail while reviewing it. I required the design decisions here to be reasoned from the
  labsheet rather than adapted from his, and the differences are recorded in
  `specification.md` §11 D-12.

---

## My Reflection

The useful lesson from Lab 1 was that an AI agent is reliable when it is *querying* a
source and unreliable when it is *generating* claims about work it did not witness. Lab 2
so far has reinforced both halves. NotebookLM answered questions about the labsheet
accurately, including the grading breakdown — but I still read the PDF myself, and I would
have done so even if it had been right the previous three times, because the cost of
checking is minutes and the cost of not checking is submitting something false about my own
work.

The place the agent earned its keep was reviewing my partner's pull request. Reading the
diff would have found the missing Ticket Date field. It would not have found that no GitHub
Project board existed, or that his test plan named a Playwright command the repository had
no way to run — those came from checking the repository against the plan, which is the same
lesson as Lab 1, where the two real defects in his code only surfaced by cloning his branch
and running his tests. Reviewing what someone wrote about their work is not the same as
reviewing their work.

The habit I want to carry into the implementation issues is the one in prompt 2: asking for
a draft to check rather than an action to take. It costs one extra exchange and it is the
only reason I caught a claim I could not actually stand behind before it went out under my
name.
