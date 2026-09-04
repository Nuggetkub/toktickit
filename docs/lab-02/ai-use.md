# Lab 2 AI Use and Reflection

**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub

| | |
|---|---|
| **Primary LLM** | Claude Opus 5 (`claude-opus-5`) |
| **Platform** | Claude Code CLI, run locally against this repository |
| **Secondary tool** | Google NotebookLM, via the `notebooklm` CLI, used to query the Lab 2 labsheet PDF |
| **Responsibility** | Every specification, decision, business rule, test, command and submitted artefact is reviewed and approved by me. The agent drafts and investigates; I decide and remain accountable. |

This record is written as the sprint proceeds rather than reconstructed at the end. Rows 1
to 6 were written during the engineering-contract stage (issue #17); rows 7 to 10 were added
as the implementation issues were delivered, and the reflection was finished at release
(issue #28).

---

## Selected Key Prompts

Prompts are quoted as they were actually sent.

| # | Prompt | How the result was reviewed and used |
|---|---|---|
| 1 | "Let's understand Lab_02_labsheet.pdf with notebooklm and check Earth2509 pull request" | The labsheet was added as a NotebookLM source and queried for objectives, deliverables, the grading table and the submission format. **I did not take the answer on trust** — the extracted PDF text was read directly and every graded claim was checked against it. NotebookLM was accurate here, including the 60-point split; it also correctly reported that the labsheet states no deadline and no filename convention, which the PDF confirmed. |
| 2 | "write up the review for me to check before posting", then "post it" | Produced a draft peer review of the partner's Lab 2 contract PR. I required it to be drafted for checking rather than posted directly. The draft's claims were verified against his repository before I approved sending — one claim about a missing Project board was deliberately hedged because a private board would not be visible to me. It went out as a **Comment rather than an Approval**, because the findings were completeness gaps against graded criteria. |
| 3 | "draft the issue decomposition" | Produced the twelve-issue breakdown for this sprint with dependencies and branch names. I reviewed the ordering and kept the layering — contract, then theme and data, then each API before the screen that consumes it — because it makes each issue independently reviewable. |
| 4 | "create the issues and the lab2-staging branch" | Issues #17–#28 and the `lab2-staging` branch were created. The issues were created sequentially on purpose so their numbers matched the cross-references already written into their bodies. |
| 5 | "check Earth2509 pull request again", then "post the approval" | Checked whether the partner had responded. He had, with a fix commit. **The commit diff was read rather than his summary of it** — the same habit that caught two stale evidence rows in his Lab 1 pull request. This time everything he claimed was genuinely there, so I approved it, with two non-blocking notes: one sentence in his `reviewer.md` had already fallen out of date, and his Project board still did not exist. |
| 6 | "start on #17" | Produced the first draft of `specification.md`, `api-spec.md`, `tests.md`, `ui-spec.md` and this file. I directed the design decisions recorded in `specification.md` §11 and reviewed every business rule and acceptance criterion before committing. |
| 7 | "continue the issue" | The instruction I used most. It carries no detail on purpose: the agent has to read the open issues, the board and the branch state to work out what is next, and I check that reading before any code is written. It produced issue #26 — the Ticket Detail screen and attachment UI — and on the way found that `GET /api/tickets/:id` returned a hard-coded empty attachments array although `api-spec.md` §3 promised the metadata, with the existing test asserting that empty array on a ticket that had none. **A test that agreed with the bug.** I had it add API-17 and prove the new test by reverting the fix. |
| 8 | "check Earth2509's pull request and review" | Sent for his PR #33. I require his branch to be *run*, not read. It found that his `main` was failing without that pull request — client 19 of 20 and the E2E suite red — which made five `Passed` rows in his `tests.md` untrue while it sat open. The agent's first draft accused him of reporting a failing run as a pass; I made it check, and the style test turned out not to be in his branch's tree, so his number was accurate and the break was a semantic merge conflict. **The correction went into the review**, and into my own release plan: re-run the suites on the merge result, not only on the branch. |
| 9 | "comment his new pull request" | The agent asked which review type I wanted rather than assuming, because its draft recommended Approve and I had typed "comment" — the two are recorded differently in `reviewer.md` and an approval is awkward to undo. I chose Approve. Worth recording as the one time the tool stopped and asked instead of guessing at something outward-facing. |
| 10 | "check comment in pull request" | His review of my `reviewer.md` (PR #40) raised two items. The agent verified both instead of complying: the link he called wrong was correct — my repository has no pull request #21, only an issue #21 — and the inconsistency he saw was between *his* repository's history and *my* repository's branch protection, which it confirmed through the API before replying. It fixed the real problem underneath, that our two repositories number things independently and the document never said so. **Being asked to add a false sentence to an evidence document is exactly where an agent should push back, and it did.** |

### Deliberate constraints I placed on the agent

- **Draft, then let me check, then post.** Nothing was published to my partner's repository
  or to GitHub until I had read it. Prompt 2 exists precisely to create that gap.
- **Verify against the source, not the summary.** Applied to the labsheet (prompt 1) and to
  my partner's fix commit (prompt 5). Both times the instruction changed what was checked.
- **Write this contract independently.** The agent had read my partner's Lab 2 contract in
  detail while reviewing it. I required the design decisions here to be reasoned from the
  labsheet rather than adapted from his, and the differences are recorded in
  `specification.md` §11 D-12.
- **Prove a regression test by breaking the code.** Applied to every test I was told was
  important, and it caught real weakness five times: removing the `active` guard, removing
  `FOR UPDATE`, changing a palette token, reverting the empty attachments array, and
  constraining a label until it clipped. A test that has never failed is a claim, not
  evidence.
- **Run the partner's branch; do not review the diff.** Every substantive finding I sent
  him came from executing his code — six concurrent uploads defeating a five-attachment
  limit, an executable accepted as a PNG, six requests for one search term, a `413`
  answered with a stack trace. None of them is visible by reading.
- **Check every path in an evidence document against the filesystem.** Mechanically, with a
  loop, not by eye. This is how I found a `Passed` row in his `tests.md` citing a test file
  that existed only in *my* repository — and it is why I ran the same check over my own
  file before submitting it.

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

The habit I wanted to carry into the implementation issues was the one in prompt 2: asking
for a draft to check rather than an action to take. It costs one extra exchange and it is
the only reason I caught a claim I could not actually stand behind before it went out under
my name.

## What the implementation phase changed

Eleven issues later, the split I described above held, but the useful line turned out not to
be *querying versus generating*. It is **whether the claim was executed or merely written.**

The agent is at its most convincing exactly where it is least checkable. Three times this
sprint it produced work that was green, plausible and wrong until something ran:

- A test asserting `attachments` was an empty array — on a ticket that had no attachments.
  True, worth nothing, and it agreed with a bug that would have shown "no files attached" on
  every ticket in the system.
- A suite proving that choosing a Category put `categoryId=3` in the query string, and never
  that the rows on screen changed. My partner found that one, not me.
- A screenshot of My Tickets with a ticket number typed into the search box and every ticket
  still listed underneath, because the assertion was satisfied by the unfiltered list while
  the debounce was still pending. **The picture was going into my report as evidence of a
  search that had not happened.** I only caught it by looking at the image.

What answered all three was the same instruction: break the code and watch the test fail.
That is cheap, it takes a minute, and it is the only way I know to tell a real assertion from
a decorative one. It is now the first thing I ask for whenever the agent tells me something
is covered.

The second change is about disagreement. Late in the sprint my partner asked me to add a
sentence to `reviewer.md` saying branch protection had been introduced part-way through, to
resolve a contradiction he had spotted. The agent checked before complying, found the
contradiction was between his repository's history and mine, and told him so instead — while
fixing the real problem, that the document never said our two repositories number things
independently. A tool that had simply done as it was told would have put a false event into
the one document whose entire value is that it contains only real ones. I would rather be
argued with than agreed with there, and I have started asking for the check explicitly.

The third is smaller and more practical. Short instructions worked better than detailed ones,
because the repository, the issue tracker and the board already hold the state. "Continue the
issue" makes the agent reconstruct where the sprint is and show me that reconstruction, which
is a cheap way to catch a wrong assumption before it becomes a commit. Where I did give a
long instruction, it was almost always to constrain rather than to specify — draft it, run it,
prove it, do not post it.
