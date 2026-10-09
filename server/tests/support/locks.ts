import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/prisma.js";

// Forced interleaving without sleeps (Earth2509's non-blocking note on PR #94).
//
// The race tests hold a row lock in a transaction of their own, dispatch a
// request that must wait for it, and release. The first version waited a fixed
// 150–300 ms and hoped the request had reached the lock by then. On a slow
// machine it might not have, and the test would then pass for the wrong reason.
// This waits for evidence instead: the holder's backend pid, and Postgres
// reporting that the dispatched request is blocked by exactly that pid.
// Filtering on the holder's own pid keeps it correct while other test files
// run in parallel against the same database.

type Tx = Prisma.TransactionClient;

export type HoldOptions = {
  /** Runs inside the holding transaction, after the lock and before release. */
  during?: (tx: Tx) => Promise<unknown>;
  /** How many requests must be seen waiting on the holder before release. */
  waiters?: number;
  /** Upper bound on the wait, as a failure rather than a silent pass. */
  timeoutMs?: number;
};

/**
 * How many backends are waiting behind the holder, directly or transitively.
 * Two requests queued on one row are reported as holder <- first <- second, so
 * a count of only the holder's direct waiters never reaches two.
 */
async function blockedBy(pid: number): Promise<number> {
  const rows = await getPrisma().$queryRaw<Array<{ pid: number; blockers: number[] }>>`
    SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0
  `;
  const behind = new Set<number>([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (!behind.has(row.pid) && row.blockers.some((b) => behind.has(b))) {
        behind.add(row.pid);
        grew = true;
      }
    }
  }
  return behind.size - 1;
}

/**
 * Takes `lock` in a transaction, dispatches `fire` (which must call `.then()`
 * on a supertest request, since supertest is lazy), waits until `waiters`
 * requests are blocked by this transaction, then commits and returns what
 * `fire` resolved to.
 */
export async function whileHolding<T>(lock: (tx: Tx) => Promise<unknown>, fire: () => Promise<T>, options: HoldOptions = {}): Promise<T> {
  const { during, waiters = 1, timeoutMs = 10_000 } = options;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let signalReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => (signalReady = resolve));

  const holder = getPrisma().$transaction(
    async (tx) => {
      await lock(tx);
      if (during) await during(tx);
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      signalReady(pid);
      await held;
    },
    { timeout: timeoutMs + 10_000 },
  );

  const pid = await ready;
  const pending = fire();
  const deadline = Date.now() + timeoutMs;
  while ((await blockedBy(pid)) < waiters) {
    if (Date.now() > deadline) {
      release();
      await holder;
      throw new Error(`Timed out: expected ${waiters} request(s) blocked by backend ${pid}. The race was never set up.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  release();
  await holder;
  return pending;
}

/** The Ticket row lock every Action write and status change takes (BR-14). */
export const ticketRow = (ticketId: number) => (tx: Tx) => tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
