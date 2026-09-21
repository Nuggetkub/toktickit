// Sign-in throttling (BR-09).
//
// Five failed attempts for one normalised email within fifteen minutes cause
// every further attempt for that email — including one with the correct
// password — to be refused until the window expires. Unknown emails are counted
// identically, so the throttle cannot be used to discover which accounts exist.
//
// The clock is a parameter rather than a call to Date.now() inside, so the tests
// can move time forward instead of waiting fifteen minutes.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

type Window = { failures: number; startedAt: number };

// In memory, per process (decision D-16). That is correct for the single-process
// local deployment Lab 3 targets, and the limitation is recorded in tests.md §7:
// restarting the API clears the counts, and a multi-process deployment would
// need a shared store.
const windows = new Map<string, Window>();

export type ThrottleState = { throttled: boolean; retryAfterSeconds: number };

/** Whether this key is currently refused, and for how much longer. */
export function throttleState(key: string, now: number = Date.now()): ThrottleState {
  const window = windows.get(key);
  if (!window) return { throttled: false, retryAfterSeconds: 0 };

  const endsAt = window.startedAt + WINDOW_MS;
  if (endsAt <= now) {
    // The window has passed; the count goes with it.
    windows.delete(key);
    return { throttled: false, retryAfterSeconds: 0 };
  }

  if (window.failures < MAX_FAILURES) return { throttled: false, retryAfterSeconds: 0 };
  return { throttled: true, retryAfterSeconds: Math.ceil((endsAt - now) / 1000) };
}

/**
 * Records one failure. The window starts at the first failure rather than
 * sliding, so a caller cannot keep a lockout alive indefinitely by attempting
 * once a minute — after fifteen minutes from the first failure the count is
 * gone, which is also why BR-09 promises no permanent lock.
 */
export function recordFailure(key: string, now: number = Date.now()): void {
  const window = windows.get(key);
  if (!window || window.startedAt + WINDOW_MS <= now) {
    windows.set(key, { failures: 1, startedAt: now });
    return;
  }
  window.failures += 1;
}

/** A successful sign-in clears the count (BR-09). */
export function clearFailures(key: string): void {
  windows.delete(key);
}

/** Test seam only: forget every window. */
export function resetThrottle(): void {
  windows.clear();
}
