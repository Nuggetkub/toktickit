# Lab 1 — Test Plan and Evidence

All test files live under `server/tests/lab-01/` and `client/tests/lab-01/`.

## Test specification

| Test ID | Test File Path | Tool | Test Description |
|---|---|---|---|
| API-01 | `server/tests/lab-01/health.test.ts` | Supertest | `GET /api/health` returns HTTP 200 with the JSON body `{ status: "ok", service: "TokTickIT API" }`. |
| API-02 | `server/tests/lab-01/categories.test.ts` | Supertest | `GET /api/categories` returns the four seeded categories in id order. A second case asserts the ids ascend and each object exposes only `{ id, name }`. |
| UI-01 | `client/tests/lab-01/App.test.tsx` | Vitest | The "TokTickIT" heading renders on the page. |
| UI-02 | `client/tests/lab-01/App.test.tsx` | Vitest | Clicking `[Check System]` against a healthy API moves the view out of its loading state and shows Online plus all four categories in order. |
| UI-03 | `client/tests/lab-01/App.test.tsx` | Vitest | When the API is unavailable the view shows Offline plus a user-facing error message, and the category list does not render. |

**Result: 6 tests, 0 failures, 0 skipped, 0 todo.** API-02 and UI-03 each contribute
two assertions/cases, which is why the runner reports 3 server and 3 client tests.

## Evidence — all tests passing on `main`

Server, `cd server && npm test`:

```text
 ✓ tests/lab-01/health.test.ts (1 test) 16ms
 ✓ tests/lab-01/categories.test.ts (2 tests) 151ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
```

Client, `cd client && npm test`:

```text
 ✓ tests/lab-01/App.test.tsx (3 tests) 210ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

`tsc --noEmit` is clean on the client. Both suites were run on `main` at commit
`845493f`.

## Evidence — database schema and idempotent seed

Migration `20260808153643_init`:

```sql
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
```

The unique index on `name` is what makes the seed idempotent — it upserts on that
column. Proven by running `npm run prisma:seed` **twice** and reading the table back
directly in psql:

```text
toktickit=# SELECT id, name FROM "Category" ORDER BY id;
 id |        name
----+--------------------
  1 | Account and Access
  2 | Hardware
  3 | Software
  4 | Network
(4 rows)
```

Seeding runs sequentially rather than in parallel so autoincrement ids follow the
canonical category order on a fresh database, which is what API-02 asserts.

## Evidence — live API

```text
$ curl -i http://localhost:3000/api/health
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Content-Type: application/json; charset=utf-8

{"status":"ok","service":"TokTickIT API"}
```

```text
$ curl http://localhost:3000/api/categories
[{"id":1,"name":"Account and Access"},{"id":2,"name":"Hardware"},
 {"id":3,"name":"Software"},{"id":4,"name":"Network"}]
```

## Evidence — failure path

The 500 branch was exercised by stopping the database container rather than by
mocking it, to confirm no internal detail leaks:

```text
$ docker stop toktickit-db
$ curl -i http://localhost:3000/api/categories
HTTP/1.1 500 Internal Server Error
{"error":"Could not load categories."}
```

The full `PrismaClientKnownRequestError` was written to the server log only.

Worth recording: `/api/health` still returned **200** with the database stopped,
because the lazy Prisma singleton means the health route never opens a connection.
That is intended, but it does mean a healthy response says nothing about the
database.
