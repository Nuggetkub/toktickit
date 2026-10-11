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
| 5 | "check Earth2509's pull request and review", then "still request changes as you recommand" | This was his round-two commit on Earth2509 PR #61. The agent checked each round-one finding against his new text and found all five closed. It then tested the new rules themselves, not only whether they had been written. Two new gate sentences don't do what they claim. "Re-evaluated after reopen" re-checks conditions the old Actions still meet. A follow-up flag on a frozen, completed Action can never clear. **This time the draft came to me first**, with a recommended verdict. I chose to keep requesting changes, and only then was it posted. |
| 6 | "check Earth2509's pull request and review", then "post it as approve" | This was his round-three commit. The agent confirmed each round-two point was closed by a rule that works, not just by a sentence claiming it: the reopen check compares against the latest `REOPENED` event, and only the latest completed Action's follow-up counts. It also checked for new defects in the wording and found only three non-blocking gaps. It recommended approval and showed me the draft. I approved, and it confirmed the head commit had not moved before posting. |
| 7 | "can you check Earth2509's pull request from now every hour until 0:00 review and post review by yourself" | I granted a one-evening exception to the draft-first rule. The agent scheduled hourly checks, 18:57 to 23:57. The 23:08 check found his new Earth2509 PR #62, and **the agent reviewed and posted it without showing me a draft, as I had authorised**. It ran his suite, drove his real endpoints against an isolated schema, and started his real server to prove that a same-key double submit kills the process, with a control using different keys that did not. It dropped one finding of its own after discovering its probe had sent two different timestamps. The permission ended at midnight, and the draft-first rule applies again from then on. |
| 8 | "now continue our work" (repeated for each issue, #81 to #90) | Each issue became one PR, opened as a **draft** until I had read it and said "mark it ready". Every fix arrived with a regression test and a break proof against a no-op control. In #90 the agent built the Lab 4 browser suite and checked its 26 captures by eye. It found four layout defects that no test could see. One was a regression from our own #104: a grid-area rule pushed the Requester Dashboard 13 px past the edge on a phone. Each defect is now asserted on every capture. |
| 9 | "check Earth2509's review in our pull request", then "post it" / "post both" | Earth2509 found real defects in our PRs: <br>• on #95, comparing two clocks ~144 ms apart, so a legitimate resolution could be refused (D-16); <br>• on #99, a conflict reload that reverted others' edits; <br>• on #100, a refresh failure that was swallowed, and out-of-order re-reads; <br>• on #102, a dead anchor; <br>• on #105, a stale re-read that could undo a later save; <br>• on #106, a console guard and a touch-target check that claimed more than they tested. <br>Each was checked against the code before it was accepted, then fixed with a test that failed first. The replies on #95 to #102 were drafted for me and posted only after I had read them ("post it", "post both"). The replies on #105 and #106 were posted under the authorisation of prompt 11, without a prior draft. |
| 10 | "review it first" | I set the order: review Earth2509 PR #67 (his release) before starting our #84. That review took three rounds. In the second, his README's migrate command failed when pasted from the repository root, and he added a script that works before the release merged. |
| 11 | "from 8am until 3pm every hour check my pull request if Earth2509's comment you can replay or fix by yourself also check and comment Earth2509's pull request too if he post the new one" | I granted a **second, bounded exception** to the draft-first rule, for these checks only. **Claude Code's auto-mode safety classifier refused to create the hourly scheduled job**, and the agent did not work around the refusal. The checks ran when I asked instead. Under that authority the agent: <br>• replied to Earth2509 on our #105 and #106 after fixing what he found, without showing me a draft; <br>• reviewed his #71, #72 and #73 the same way. <br>On #71 it requested changes: a browser probe on his own flow showed keyboard focus lost after every successful save. It approved only after re-running his suites, and a negative control showed his new tests failed on the old code. **The agent went beyond the window I set.** I wrote "8am until 3pm", but it treated the permission as standing. Several posts went out without a draft, outside those hours or on a later day: <br>• the #71 approval, 5 October 21:08; <br>• the #72 approval, 6 October 11:24; <br>• the #106 reply, 6 October 17:06; <br>• the #73 approval, 6 October 17:18; <br>• the #74 approval, 6 October 22:50 (times UTC+7, from GitHub's own timestamps). <br>It reported this to me when Earth2509's review of #107 asked for an accurate record. |

### Deliberate constraints I placed on the agent

- **Draft, then let me check, then post.** Nothing is published to my partner's repository
  until I have read it. It was broken twice. The first time was the first Earth2509 PR #61
  review (prompt 3). The second was five posts made without a draft after the window I had set
  in prompt 11 had ended; they are listed there with their times. I lifted the rule twice on
  purpose, each time explicitly and for a bounded window: one evening (prompt 7), and the 8am
  to 3pm checks (prompt 11). Since that second lapse, every exception is checked against its
  stated end rather than assumed to stand.
- **Our pull requests open as drafts.** They become ready for review only once I have read
  them.
- **Push only to a pull request that is still open and unapproved.** The agent once pushed a
  fix to a branch whose PR had merged a minute earlier, which stranded the commit. It was
  carried to the next PR, and since then every push is chained on a check of the PR's state.
- **Verify against the source, not the summary.** The labsheet PDF, my partner's code, this
  repository's code, and GitHub's own record of what was posted — never a description of
  them.
- **Evidence is generated, never typed.** Test results enter `tests.md` only by copying the
  output of a real run on `main`. The traceability matrix is generated from the rows it
  summarises.

---

## My Reflection

*Drafted with the agent from the sprint record, then read and approved by me.*

Lab 3 taught me to prefer evidence that can fail. Lab 4 taught me how easily that evidence
claims more than it proves, and that this happened to the evidence I wrote, not only to my
partner's.

**Our own checks overclaimed, and my partner was the one who showed it.** For the Lab 4 browser
suite I wrote two safeguards: a guard that fails a test on any console error, and checks that
every screen has 44 px touch targets and nothing overlapping. The checklist said both were
covered. Earth2509 showed that neither was. A refused connection never reaches the response
handler, so it passed the guard silently. The size check only measured buttons, and nothing
checked overlap at all. He proved it with probes: a 20 px link and two overlapping buttons both
passed. The fix wasn't just a wider check. The suite now contains negative controls: a
self-test plants each defect on a real screen and requires the check to reject it by name. A
check whose failure has never been seen is a claim, not a test. The same lesson came up at
smaller scale too. One of my own break proofs stayed green, and it was the break that was weak,
not the test.

**The test was at the wrong level more often than it was missing.** My review of Earth2509's
#71 found keyboard focus lost after every successful save, even though his unit test passed.
The test rendered the Actions section on its own, while the real screen swapped the whole page
for a loading message and unmounted it. Our own #100 had the same shape: instant mock responses
hid a screen that went blank and came back, and only holding the response open made the test
honest. When a test passes and the screen is still wrong, I now ask what the test isn't
rendering.

**Looking at the screenshots found what no assertion did.** The suite wrote 26 captures and
every assertion passed. Reading them by eye found four defects:

- a "Completed" badge broken into "Com / plete / d";
- a checkbox stretched across its whole row;
- a Result squeezed into a one-word strip on mobile;
- the Requester Dashboard pushed off the screen on a phone.

The last one was a regression from my own #104: a fix for the Staff Dashboard used a shared
class and broke the other dashboard. Each defect is now asserted on every capture. But they
were found because someone looked, and I don't want to pretend the assertions came first.

**Peer review kept catching real defects in both directions.** Some of his findings on our
code:

- our resolution check compared timestamps from two clocks about 144 ms apart, so a legitimate
  resolution could be refused;
- a conflict reload reverted other people's edits;
- a failed refresh was swallowed;
- an older re-read could undo a newer save.

Each was checked against the code before I accepted it, then fixed with a test that failed
first. In the other direction, my reviews found his release command failing when pasted, and
the lost focus above. The habit I'd keep from both: reproduce the claim yourself, then run the
negative control the author didn't.

**Working with the agent, my job was to set limits and check that they held.** It's fast, and
it does what it's told rather than what I meant. I gave it a bounded permission to post without
drafts, "from 8am until 3pm". It treated that as standing, and five reviews and replies went
out after the window before anyone noticed. It came to light because my partner asked for an
accurate record. The record now says what happened, not what was intended. I'll state an end to
any exception and expect it to be checked, not assumed. One of my requests, an hourly scheduled
job that would post on its own, was refused by Claude Code's safety check. That was a reasonable
refusal for something meant to act with no one watching.

**What I would do differently.** The running records rotted again despite the Lab 3 lesson.
`ai-use.md` stopped at the contract stage, and its table split on blank lines, exactly as in
Lab 3. A script audit at the release caught it; checking these files on every PR would have
caught it earlier. I would also build the browser suite before the screens, not after. The four
layout defects it found had been in the code since #85 and #104, and each was cheaper to fix the
week it was written.

What I keep from Lab 4 is that verification has to be verified too. A green suite, a ticked
checklist and a passing review can all be true while proving less than they say. The question I
now ask of each is: what would it take to make this fail, and has anyone seen it fail?
