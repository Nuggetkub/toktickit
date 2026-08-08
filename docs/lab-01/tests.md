# Lab 1 — Test Plan and Evidence  (fill this in)

All test files live under server/tests/lab-01/ and client/tests/lab-01/.

| # | Tool | Test | Result |
|---|------|------|--------|
| 1 | Supertest | GET /api/health returns 200, status=ok | pass (Issue 2) |
| 2 | Supertest | GET /api/categories returns 4 seeded categories in id order | todo — Issue 4 |
| 3 | Vitest | Heading renders | pass |
| 4 | Vitest | Success state shows Online + category list | todo — Issue 4 |
| 5 | Vitest | Error state shows Offline + message | todo — Issue 4 |

Paste your passing terminal output / screenshot below.

## Issue 2 — `GET /api/health`

Server (`cd server && npm test`):

```
 ↓ tests/lab-01/categories.test.ts (1 test | 1 skipped)
 ✓ tests/lab-01/health.test.ts (1 test) 20ms

 Test Files  1 passed | 1 skipped (2)
      Tests  1 passed | 1 todo (2)
```

Client (`cd client && npm test`):

```
 ✓ tests/lab-01/App.test.tsx (3 tests | 2 skipped) 19ms

 Test Files  1 passed (1)
      Tests  1 passed | 2 todo (3)
```

Live check against the running API (`curl -i http://localhost:3000/api/health`):

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Content-Type: application/json; charset=utf-8

{"status":"ok","service":"TokTickIT API"}
```
