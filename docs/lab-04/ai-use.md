# Lab 4 AI Use and Reflection

**Author:** Sittijed Jantarataeme — 67070501046 — @Nuggetkub

| | |
|---|---|
| **Primary LLM** | Claude Opus 5.5 (`claude-opus-5-5`) |
| **Platform** | Claude Code CLI, run locally against this repository |
| **Responsibility** | Every specification, decision, business rule, test, command and submitted artefact is reviewed and approved by me. The agent drafts and investigates; I decide and remain accountable. |

This record is written as the sprint proceeds, not reconstructed at the end. Rows 1 to 4 were
written during the engineering-contract stage (issue #80). Later rows are added as the
implementation issues are delivered, and the reflection is written at the release (issue #91).

---

## Selected Key Prompts

Prompts are quoted as they were actually sent.

| # | Prompt | How the result was reviewed and used |
|---|---|---|
| 1 | "understand Lab_4_sheet.pdf" | The agent read all 11 pages, including the two dashboard mockups. Beyond summarising, it found that the handout contradicts itself. Part 6 grades assign, complete, cancel and inactive-assignee rejection, but the Action field list has no assignee and no status. Part 7 grades append-only behaviour, while §1 says Actions are updated. "Action Date/Time" and "Action create date/time" name different things. The resolution rule is required but never defined. It recommended settling these in the contract before anything else, which became `specification.md` §3's contradiction table. |
| 2 | "start with our issues and the specification draft than review #61" | I set the order: our own contract first, so it would be written independently, then his review. The agent filed issues #80–#91 by script, added #78 to the board, and cut `lab4-staging` from `main` with the Lab 3 protection copied. Before drafting, it read the Lab 3 sheet again and found that it had deferred "the rule that blocks resolution while Actions Taken remain incomplete" to Lab 4. That is independent evidence that Actions need a completion state, so D-01 rests on two handouts rather than on a guess. |
| 3 | (continuation of prompt 2) — the review of Earth2509 PR #61 | His contract is documents only, so the agent checked every candidate finding against his own Lab 3 contract and code before writing it. Two findings died that way: his transition matrix differs from ours but matches his own code, and the status route he names does exist. Five blocking findings survived, each with a file and line in his repository. The strongest came from his own Lab 3 text: a dashboard card that cannot see the Tickets his BR-20 leaves unassigned. **The agent posted the review directly under this instruction, without first showing me the draft.** In Lab 3, I read every review before it was posted. That lapse is recorded here rather than implied away, and the draft-first rule below applies again from here on. |
| 4 | "start the first issue" | This prompt produced the rest of the contract: `api-spec.md`, `ui-spec.md`, `tests.md`, this file and `reviewer.md`. Writing the API against the real code found three things. Lab 3 returns one Ticket detail shape to every role, so `resolutionGate` goes to everyone. The status route guards only with a version check, which cannot see an Action created concurrently, so BR-14's row lock on it is load-bearing. And no list screen reads its filters from the URL, so drill-down is new client work, now written into `ui-spec.md` §2. `tests.md`'s traceability table is generated from its rows by a checker script, not typed. |

### Deliberate constraints I placed on the agent

- **Draft, then let me check, then post.** Nothing is published to my partner's repository
  until I have read it. This was broken once, for the first Earth2509 PR #61 review (prompt
  3), and is restored for every later review.
- **Verify against the source, not the summary.** The labsheet PDF, my partner's code, this
  repository's code, and GitHub's own record of what was posted — never a description of
  them.
- **Evidence is generated, never typed.** Test results enter `tests.md` only by copying the
  output of a real run on `main`. The traceability matrix is generated from the rows it
  summarises.

---

## My Reflection

To be written at the release (issue #91), once the implementation has tested this contract.
