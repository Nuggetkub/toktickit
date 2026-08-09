# Lab 1 — AI Use and Reflection

**LLM/agent used:** Claude Code (Anthropic Claude Opus 4.8), with the NotebookLM
skill for reading the lab sources.

## Selected key prompts (6–10)
| # | Prompt (summarised) | What I did with the result |
|---|---------------------|----------------------------|
| 1 | "Discuss Lab 1 with NotebookLM" — summarise the labsheet, glossary and Git cheat-sheet | Got an overview of the vertical-slice goal, the 4 mandatory issues, and the Git Flow / Kanban / PR-review rules. Used it to plan the whole sprint. |
| 2 | "The TA gave me a `Lab1_Starter_Scaffold` folder — is this the main project, and do I create the repository first?" | Confirmed the `toktickit/` scaffold is the project skeleton (with `TODO(Issue N)` markers) and that the repo must be created first. Noted the labsheet expects building the foundation myself, so I flagged it to confirm with the TA. |
| 3 | "Write the exact git commands to set up the repo — TA said make it public" | Got the `git init` -> commit -> `gh repo create toktickit --public` -> `lab1-staging` command sequence and ran it. |
| 4 | "Check `.gitignore` before I commit" | Verified via a dry-run that no `.env`, `node_modules/`, or `*.db` files would be committed (only `.env.example` templates) before the first commit. |
| 5 | "Help me set up GitHub (issues, branch protection, board, reviewer)" | Created the 4 issues, applied branch protection (1 approval, no direct push) to `main` and `lab1-staging`, invited the peer reviewer, and built the "TokTickIT Individual Sprints" board with the 6 required columns. |
| 6 | "Walk me through Issue 1" | Installed client/server deps, created `.env` files, ran `prisma generate`, ran the test suites, and set up a Postgres 17 Docker container on port 5433. |

## Reflection
My prompts got better when I gave the agent concrete constraints (e.g. "public
repo", "check .gitignore first") instead of vague requests — that produced exact,
runnable commands rather than generic advice. The main thing I had to correct was
the assumption about starter code: the agent initially treated the scaffold as
Issue 1, but the labsheet says the foundation should be built from scratch, so I
noted this to verify with my TA before submitting. I also learned to expect the
health-check test to stay red until Issue 2 (test-driven), rather than treating it
as a broken setup.
