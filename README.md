# TokTickIT

An IT service desk ticketing system.

**Lab 3 delivers the whole service desk.** People sign in with an email address and a
password, and what they may see and do follows from one of three roles.

A **Requester** raises a support ticket and receives an official server-generated Ticket
Number, attaches evidence to it, finds their own tickets again through search, filters,
sorting and paging, reads a Ticket Detail screen, exchanges Public Comments with IT, and can
tell IT when the problem appears resolved. **IT Staff** work a shared Ticket Queue: claim a
ticket, set its IT Priority independently of the priority the Requester asked for, move it
through the status lifecycle with the evidence each transition requires, and keep Internal
Notes the Requester never sees. An **Administrator** additionally manages the accounts —
creating them, changing roles, deactivating them, and issuing initial passwords. Every screen
is built from one reusable Zen Green component set.

Authentication is real, and authorization is enforced on the server. Every request is decided
from the session rather than from anything the browser claims; a role refusal is answered
before the resource is looked up; and a Ticket belonging to someone else is refused in exactly
the same words as one that never existed.

**Lab 2's Development Requester selector is gone.** It was a forgeable testing mechanism
standing in for login, and Lab 3 replaced it outright: the `Requester` table became `User` in
place, so every existing ticket and attachment kept the same owner and the same ids.

Lab 1's vertical slice — a React client asking the API whether the system is online and which
categories exist — is still present and still tested, now behind a session at
`/system-check`.

## Stack

| Layer | Technology |
|---|---|
| Client | React 18, React Router 6, Vite 6, TypeScript 5.7 |
| Server | Node, Express 4.21, Multer 2.3, TypeScript 5.7 |
| Database | PostgreSQL 17 |
| ORM | Prisma 5.22 |
| Styling | One hand-written stylesheet, `client/src/styles/zen-green.css`, no CSS framework |
| Tests | Vitest 2.1 (both sides), Supertest 7 (API), Testing Library (UI), Playwright 1.55 (E2E and responsive) |

## Prerequisites

- Node.js 20 or newer
- Docker (for PostgreSQL)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Nuggetkub/toktickit.git
cd toktickit
npm install --prefix server
npm install --prefix client
```

### 2. Start PostgreSQL

```bash
docker run -d --name toktickit-db \
  -e POSTGRES_USER=toktickit \
  -e POSTGRES_PASSWORD=toktickit \
  -e POSTGRES_DB=toktickit \
  -p 5433:5432 postgres:17

docker exec toktickit-db pg_isready -U toktickit   # expect "accepting connections"
```

The container publishes **5433** on the host, not the default 5432, so it will not
collide with a PostgreSQL you may already be running. If the container already
exists, start it with `docker start toktickit-db` instead of `docker run`.

### 3. Create the environment files

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

The defaults match the container above, so no editing is needed for local
development. Real `.env` files are git-ignored and must never be committed.

| Variable | File | Default |
|---|---|---|
| `DATABASE_URL` | `server/.env` | `postgresql://toktickit:toktickit@localhost:5433/toktickit?schema=public` |
| `PORT` | `server/.env` | `3000` |
| `VITE_API_URL` | `client/.env` | `http://localhost:3000` |

### 4. Migrate and seed the database

```bash
cd server
npx prisma migrate deploy   # use `npx prisma migrate dev` when changing the schema
npm run prisma:seed
```

The seed is idempotent — it matches on unique natural keys, so running it
repeatedly creates no duplicates. It inserts the four categories (Account and
Access, Hardware, Software, Network), seven related systems, the eleven
development accounts below, and around thirty demo tickets spread across every
status and priority so the IT Staff queue has realistic volume.

Re-seeding restores a seeded account's name, role and activation state, but
**never resets a password that has been changed** — it fills one in only where
the account has none, which is the state the Lab 3 migration leaves a Lab 2
Requester in.

#### Development accounts

Every seeded account uses the same password:

```text
TokTickIT-dev-2026
```

**This is a local fixture, not a secret.** The accounts use the reserved
`toktickit.local` domain and exist so that a reviewer can sign in as each role on
a fresh clone. Override it with `SEED_PASSWORD` before seeding if you prefer.

**Every one of these accounts must choose a new password at its first sign-in.**
The value above is an *initial* password, and issuing one always leaves the
account in mandatory-change mode, so no seeded account can reach the application
without setting its own password first.

| Account | Role | State |
|---|---|---|
| `nadia.rahman@toktickit.local` | Requester | active |
| `somchai.pattana@toktickit.local` | Requester | active |
| `marisa.chen@toktickit.local` | Requester | active |
| `tobias.lindqvist@toktickit.local` | Requester | active |
| `ananya.wong@toktickit.local` | Requester | active |
| `priya.anand@toktickit.local` | Requester | inactive |
| `arthit.chaiyaporn@toktickit.local` | IT Staff | active |
| `grace.okafor@toktickit.local` | IT Staff | active |
| `daniel.reyes@toktickit.local` | IT Staff | active |
| `wichai.boonmee@toktickit.local` | IT Staff | inactive |
| `pim.srisawat@toktickit.local` | Administrator | active |

The Lab 3 migration renames Lab 2's `Requester` table to `User` in place, so every
existing ticket and attachment keeps the same owner and the same ids. A migrated
account has no password until the seed or an Administrator sets one, and an
account with no password can never sign in.

### 5. Run the app

Two terminals:

```bash
cd server && npm run dev    # http://localhost:3000
```

```bash
cd client && npm run dev    # http://localhost:5173
```

Open http://localhost:5173. The application opens on **Login** — there is no anonymous
screen. Sign in with any account from the table above and the development password; the first
sign-in always lands on **Choose a new password**, because an issued password is an *initial*
one. After that, each role lands on its own start screen: a Requester on My Tickets, IT Staff
on the Ticket Queue, an Administrator on User Management.

Lab 1's system check still exists at `/system-check` for a signed-in user: it reports whether
the API is online and lists the four categories, or shows the offline status if the API
cannot be reached.

## Tests

```bash
cd server && npm test    # Vitest + Supertest — unit and API
cd client && npm test    # Vitest + Testing Library — UI component and UI style
npm run e2e              # Playwright — the Lab 2 journeys, from the root
npm run e2e:lab3         # Playwright — the Lab 3 journeys and the §13 evidence
```

Both browser suites start the API and the client themselves; nothing needs to be running
first. They need `server/.env` (or an `E2E_DATABASE_URL`), and `npm run e2e:install` once to
fetch the browser. They are separate configurations sharing one webServer definition —
`playwright.config.ts` exports a factory and `playwright.lab3.config.ts` calls it — and they
use **different schemas**, `lab2_e2e` and `lab3_e2e`, so neither can see the other's Tickets
and neither touches development data. Each writes its evidence under its own `artifacts/`
root. `npm run e2e:report` and `npm run e2e:report:lab3` open the HTML report of either run.

**`npm run e2e` rewrites the committed Lab 2 screenshots**, so restore them if you are
changing something else.

See [`docs/lab-03/tests.md`](docs/lab-03/tests.md) for the Lab 3 test plan and evidence,
[`docs/lab-02/tests.md`](docs/lab-02/tests.md) for Lab 2, and
[`docs/lab-01/tests.md`](docs/lab-01/tests.md) for Lab 1.

## API

Twenty-nine endpoints: the Lab 1 health check, the Lab 2 ticket and attachment capabilities
now behind a session, and everything Lab 3 adds — authentication, the IT Staff queue and
workflow, discussions, and Administrator user management. The full contract — request and
response shapes, every error code, and the rules behind them — is
[`docs/lab-03/api-spec.md`](docs/lab-03/api-spec.md); Lab 2's remains at
[`docs/lab-02/api-spec.md`](docs/lab-02/api-spec.md).

`GET /api/requesters` **no longer exists.** Lab 3 removed it with the selector it served, and
it is deliberately not registered rather than answered with a `403`, so it returns `404`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/health` | anyone | Liveness; touches no database. **Lab 1** |
| POST | `/api/auth/login` | anyone | Sign in; sets the session cookie |
| GET | `/api/auth/me` | signed in | The current identity and role |
| POST | `/api/auth/change-password` | signed in | Change it; every other session is revoked |
| POST | `/api/auth/logout` | any caller | Ends the session server-side |
| GET | `/api/categories` | signed in | Active Categories |
| GET | `/api/related-systems` | signed in | Active Related Systems |
| POST | `/api/tickets` | Requester | Create a Ticket; the server assigns the Ticket Number |
| GET | `/api/tickets` | Requester | Their own Tickets, with search, filters, sort and paging |
| GET | `/api/tickets/:id` | signed in | One Ticket; a Requester sees only their own |
| POST | `/api/tickets/:id/attachments` | Requester | Upload one attachment |
| GET | `/api/tickets/:id/attachments` | signed in | Attachment metadata, removed entries included |
| GET | `/api/tickets/:id/attachments/:id/download` | signed in | Download an **active** attachment |
| PATCH | `/api/tickets/:id/attachments/:id` | Requester | Soft-remove an attachment, with a reason |
| GET | `/api/staff/tickets` | IT Staff, Admin | The shared queue: search, filters, sort, paging |
| GET | `/api/staff/assignees` | IT Staff, Admin | Who a Ticket may be assigned to |
| POST | `/api/tickets/:id/claim` | IT Staff, Admin | Take an unassigned Ticket |
| PATCH | `/api/tickets/:id/owner` | IT Staff, Admin | Assign or unassign |
| PATCH | `/api/tickets/:id/it-priority` | IT Staff, Admin | IT's own priority scale |
| POST | `/api/tickets/:id/status` | IT Staff, Admin | A transition, with the evidence it requires |
| GET | `/api/tickets/:id/comments` | signed in | The Public Comment thread |
| POST | `/api/tickets/:id/comments` | signed in | Post a Public Comment |
| GET | `/api/tickets/:id/internal-notes` | IT Staff, Admin | Notes the Requester never sees |
| POST | `/api/tickets/:id/internal-notes` | IT Staff, Admin | Add one |
| POST | `/api/tickets/:id/resolution-indication` | Requester | "The problem appears resolved" |
| GET | `/api/admin/users` | Administrator | The user list, with search and role filter |
| POST | `/api/admin/users` | Administrator | Create an account with an initial password |
| PATCH | `/api/admin/users/:id` | Administrator | Name, email, role, activation |
| POST | `/api/admin/users/:id/initial-password` | Administrator | Reissue one; live sessions end |

**Only two of these sit under `/api/staff`, and that is deliberate.**
`GET /api/staff/tickets` and `GET /api/staff/assignees` are *queries across every Ticket*, so
they are staff resources in their own right. Every staff *mutation* — claim, owner, IT
Priority, status — acts on **one** Ticket, so it hangs off `/api/tickets/:id` and is guarded by
role rather than by prefix. The authorization is identical either way; only the shape of the
URL differs. Worth stating because the split is easy to read the other way round.

Five conventions run through all of them:

- **Identity travels in an HttpOnly session cookie**, never in a header, query string or body,
  and the server decides every request from it rather than from anything the browser claims.
- **A role refusal is decided before the resource is looked up**, so it cannot disclose
  whether the resource exists.
- **A Ticket or attachment belonging to someone else is answered `404`, not `403`** — a
  "forbidden" would confirm the record exists. It is byte-identical to the answer for an id
  that never existed.
- **Every state-changing request is checked against an `Origin` allowlist**, which is what
  stands in place of a CSRF token.
- **Failures are safe.** `/api/health` answers even when PostgreSQL is down; every other
  failure logs its cause server-side and returns a generic message with no stack trace, SQL
  or filesystem path.

## Repository layout

```text
client/
  src/            App.tsx, api.ts, ticket-rules.ts, SystemCheck.tsx
    auth/         Login, Change Password, Forbidden, RequireAuth, AuthContext
    tickets/      Create Ticket, My Tickets, Requester Ticket Detail
    staff/        Ticket Queue, IT Staff Ticket Detail
    admin/        User Management
    components/   the shared Zen Green set (Field, Button, Card, badges, dialogs…)
    styles/       zen-green.css — one hand-written stylesheet
  tests/lab-01/   UI tests
  tests/lab-02/   UI component and UI style tests
  tests/lab-03/   authentication, queue, staff detail and user management tests
server/
  src/            Express app (app.ts, index.ts, prisma.ts, routes and rules)
  prisma/         schema, migrations, seed
  scripts/        prepare-e2e.ts — resets an E2E schema
  tests/lab-01/   API tests
  tests/lab-02/   unit and API tests
  tests/lab-03/   authorization, workflow, discussions, user administration, migration
  tests/support/  shared session helper for the API suites
e2e/lab-02/       Playwright journeys for the Lab 2 Requester flows
e2e/lab-03/       Playwright journeys for Lab 3, plus the responsive and state evidence
artifacts/lab-02/screenshots/   committed responsive evidence
artifacts/lab-03/screenshots/   committed Lab 3 evidence (ui-spec.md §13)
docs/lab-01/      tests.md, reviewer.md, ai_use.md
docs/lab-02/      specification.md, api-spec.md, ui-spec.md, tests.md, reviewer.md, ai-use.md
docs/lab-03/      specification.md, api-spec.md, ui-spec.md, tests.md, reviewer.md, ai-use.md
playwright.config.ts        the Lab 2 configuration, and the shared factory
playwright.lab3.config.ts   the Lab 3 configuration, three lines calling it
```

## Branching model

`feature/*` → `lab3-staging` → `main`, one branch per issue. Lab 1 and Lab 2 used the same
shape through `lab1-staging` and `lab2-staging`.

The staging branch and `main` are both protected: one approving review is required, stale
approvals are dismissed when a branch is pushed to, and the rule is enforced for the
repository owner as well — so no change reaches either branch without a reviewed pull
request. Every pull request is reviewed by the peer named in
[`docs/lab-03/reviewer.md`](docs/lab-03/reviewer.md), which records each review as it happens
with a link to the review itself.

The release is deliberately **two** pull requests: `lab3-staging` → `main`, then a second,
evidence-only pull request branched from that merge commit, because
[`docs/lab-03/tests.md`](docs/lab-03/tests.md) §6 records a test as `Passed` only once it has
run on `main`, and the workflow forbids committing there directly. Note that a closing keyword
does **not** fire for a pull request targeting a staging branch, so each issue is closed by
hand when its work merges.

## Troubleshooting

**`P1000: Authentication failed`** — usually the wrong port rather than bad
credentials. If another PostgreSQL is listening on 5432, a `DATABASE_URL` pointing
there will reach the wrong server and fail authentication. Confirm the URL uses
**5433**.

**The API dies with no error in the log** — an orphaned `tsx watch` process may be
competing for port 3000. Check with `netstat -ano | findstr :3000` and stop strays.
