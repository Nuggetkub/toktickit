# TokTickIT

An IT service desk ticketing system. This repository contains the Lab 1 vertical
slice: a React client that asks a Node/Express API whether the system is online and
which request categories are available, with the categories served from PostgreSQL
through Prisma.

## Stack

| Layer | Technology |
|---|---|
| Client | React 18, Vite 6, TypeScript 5.7, Bootstrap 5.3 |
| Server | Node, Express 4.21, TypeScript 5.7 |
| Database | PostgreSQL 17 |
| ORM | Prisma 5.22 |
| Tests | Vitest 2.1 (both sides), Supertest 7 (API) |

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

The seed is idempotent — it upserts on the unique category name, so running it
repeatedly will not create duplicates. It inserts four categories: Account and
Access, Hardware, Software, Network.

### 5. Run the app

Two terminals:

```bash
cd server && npm run dev    # http://localhost:3000
```

```bash
cd client && npm run dev    # http://localhost:5173
```

Open http://localhost:5173 and click **[Check System]**. On success the page shows
the system status as online followed by the four categories; if the API cannot be
reached it shows the offline status and an error message.

## Tests

```bash
cd server && npm test    # Vitest + Supertest — unit and API
cd client && npm test    # Vitest + Testing Library — UI component and UI style
npm run e2e              # Playwright — end-to-end and responsive, from the root
```

`npm run e2e` starts the API and the client itself; nothing needs to be running first.
It does need `server/.env` (or an `E2E_DATABASE_URL`), and `npm run e2e:install` once to
fetch the browser. It uses its own database schema, its own ports and its own upload
directory, so it never touches development data — the table in
[`docs/lab-02/tests.md`](docs/lab-02/tests.md) §5 lists exactly what it uses.

See [`docs/lab-02/tests.md`](docs/lab-02/tests.md) for the Lab 2 test plan and evidence,
and [`docs/lab-01/tests.md`](docs/lab-01/tests.md) for Lab 1.

## API

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/health` | `200 { "status": "ok", "service": "TokTickIT API" }` | — |
| GET | `/api/categories` | `200 [{ "id": 1, "name": "Account and Access" }, …]` | `500 { "error": "Could not load categories." }` |

`/api/health` deliberately does not touch the database, so it answers even when
PostgreSQL is down. On a database failure `/api/categories` logs the underlying
error server-side and returns a generic message, so no internal detail is exposed.

## Repository layout

```text
client/
  src/            React app (App.tsx, api.ts, components/, requester/, tickets/)
  tests/lab-01/   UI tests
  tests/lab-02/   UI component and UI style tests
server/
  src/            Express app (app.ts, index.ts, prisma.ts, routes and rules)
  prisma/         schema, migrations, seed
  scripts/        prepare-e2e.ts — resets the E2E schema
  tests/lab-01/   API tests
  tests/lab-02/   unit and API tests
e2e/lab-02/       Playwright end-to-end and responsive specs
artifacts/lab-02/screenshots/   committed responsive evidence
docs/lab-01/      tests.md, reviewer.md, ai_use.md
docs/lab-02/      specification.md, api-spec.md, ui-spec.md, tests.md, reviewer.md, ai-use.md
```

## Branching model

`feature/*` → `lab1-staging` → `main`. Both `lab1-staging` and `main` are protected:
one approval is required and direct pushes are blocked, so every change arrives by
reviewed pull request.

## Troubleshooting

**`P1000: Authentication failed`** — usually the wrong port rather than bad
credentials. If another PostgreSQL is listening on 5432, a `DATABASE_URL` pointing
there will reach the wrong server and fail authentication. Confirm the URL uses
**5433**.

**The API dies with no error in the log** — an orphaned `tsx watch` process may be
competing for port 3000. Check with `netstat -ano | findstr :3000` and stop strays.
