# Lab 1 — AI Use and Reflection

## AI coding agent used

**Claude Code** (Anthropic), model **Claude Opus 5**, driven from the terminal,
together with **NotebookLM** for reading the lab sources (labsheet, glossary, Git
cheat-sheet).

## Selected key prompts

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

Through this lab, I learned that giving the AI strict constraints works much better
than open-ended prompts. I had to resolve a conflict between the starter scaffold and
the actual lab requirements, which showed me the importance of reading and
understanding the generated code. One interesting technical finding was that the
default `/api/health` endpoint didn't actually verify the database connection, so it
returned "Online" even when Postgres was down. Also, when I tried using NotebookLM to
help summarize the report, it completely hallucinated the AI-use section and made up
fake prompts. That was a solid lesson in why we always need to verify AI outputs
against our actual work before submitting.
