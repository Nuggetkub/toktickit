# Lab 1 — AI Use and Reflection

## AI coding agent used

**Claude Code** (Anthropic), driven from the terminal, together with **NotebookLM**
for reading the lab sources (labsheet, glossary, Git cheat-sheet).

> `[VERIFY BEFORE SUBMITTING: confirm the exact model name. An earlier draft of this`
> `file recorded "Claude Opus 4.8".]`

## Selected key prompts

> `[EDIT BEFORE SUBMITTING: the reflection column is drawn from the real session`
> `history — rewrite it in your own voice.]`

| Prompt Name | Actual Prompt Text | My Reflection |
|---|---|---|
| Plan Lab 1 implementation | "Discuss Lab 1 with NotebookLM — summarise the labsheet, glossary and Git cheat-sheet." | Gave me the vertical-slice goal, the four mandatory issues and the Git Flow / Kanban / PR-review rules before writing any code, so I could plan the whole sprint instead of discovering requirements halfway through. |
| Clarify the starter scaffold | "The TA gave me a `Lab1_Starter_Scaffold` folder — is this the main project, and do I create the repository first?" | Confirmed the scaffold is the skeleton with `TODO(Issue N)` markers and that the repo comes first. It also surfaced a conflict with the labsheet, which says to build the foundation yourself. I raised it with my reviewer rather than deciding alone. |
| Set up the repository | "Write the exact git commands to set up the repo — TA said make it public." | Naming the constraint ("public") produced an exact, runnable command sequence instead of generic advice. This was the clearest lesson of the lab: concrete constraints beat descriptions. |
| Guard the secrets | "Check `.gitignore` before I commit." | A dry run confirmed no `.env`, `node_modules/` or `*.db` would be committed, only the `.env.example` templates. Cheap to ask and expensive to get wrong, so I asked before the first commit rather than after. |
| Set up the GitHub process | "Help me set up GitHub — issues, branch protection, board, reviewer." | Created the four issues, applied branch protection to `main` and `lab1-staging`, invited the peer reviewer and built the board with the six required columns in one pass. |
| Implement each issue | "Start Issue N." | Worked well precisely because each issue had explicit acceptance criteria. The agent kept scope to that issue and left `TODO(Issue N)` markers for the rest instead of running ahead. |
| Verify the failure path | (agent's own choice) stop the database container instead of mocking the error | I would have mocked it. Stopping the real container proved the 500 response was safe and revealed something I had not considered: `/api/health` still returns 200 with the database down, because the lazy Prisma client never opens a connection. |
| Draft the report | "Draft one PDF file with NotebookLM." | NotebookLM produced the correct rubric structure but replaced every piece of terminal evidence with placeholders and invented an AI-agent identity. See the reflection below — this was the most useful failure of the lab. |

## Reflection

My prompts improved when I supplied concrete constraints rather than descriptions.
"Make the repo public", "check `.gitignore` first", "start Issue 3" produced exact
commands and correctly scoped changes, whereas open-ended requests produced generic
advice I then had to narrow anyway.

Three things had to be corrected, and they were the most instructive part of the lab.

First, the agent initially treated the TA's pre-wired scaffold as satisfying Issue 1,
while the labsheet says to build the foundation yourself. I flagged the conflict
instead of accepting the convenient reading, and raised it in peer review.

Second, I had to learn to read a failing test correctly. The health-check test stays
red until Issue 2 by design — that is test-driven development working as intended,
not a broken environment. Treating red as "something is wrong" would have sent me
debugging a correct setup.

Third, and most importantly, when I asked NotebookLM to generate this report it
**fabricated the AI-use section**, stating the work had been done with "Antigravity
powered by Gemini 3.5 Flash" with invented prompts and reflections. That text came
from an example in the labsheet, not from my project. It also replaced every code
block of real evidence with `[DATA MISSING IN SOURCE]` markers even though the data
was present in the source document I had supplied, and returned the whole report in
Thai after being asked for English. Submitting that output unread would have meant
submitting false statements about my own work.

The lesson I take from the lab is that generated output has to be checked against the
artefacts it claims to describe, and that confident formatting is not evidence of
accuracy. The same scepticism applies to peer review: my reviewer's advice on the
`.gitignore` negation rule reached the right conclusion through incorrect reasoning,
which I only found by actually testing the pattern in a scratch repository rather
than accepting it.
