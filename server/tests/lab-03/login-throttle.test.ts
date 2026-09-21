import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FAILURES,
  WINDOW_MS,
  clearFailures,
  recordFailure,
  resetThrottle,
  throttleState,
} from "../../src/login-throttle.js";

// UNIT-05 in docs/lab-03/tests.md — the BR-09 rule, with time as a parameter so
// the window can be tested without waiting fifteen minutes.

const KEY = "nadia.rahman@toktickit.local";
const START = Date.UTC(2026, 8, 15, 9, 0, 0);

beforeEach(() => resetThrottle());

describe("sign-in throttle (BR-09)", () => {
  it("allows five failures and refuses the sixth attempt", () => {
    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) {
      expect(throttleState(KEY, START).throttled).toBe(false);
      recordFailure(KEY, START);
    }

    expect(throttleState(KEY, START).throttled).toBe(true);
  });

  it("reports how long is left, counting from the first failure", () => {
    recordFailure(KEY, START);
    for (let attempt = 2; attempt <= MAX_FAILURES; attempt += 1) {
      // Four more failures, spread over the next five minutes.
      recordFailure(KEY, START + attempt * 60_000);
    }

    const halfway = START + WINDOW_MS / 2;
    const state = throttleState(KEY, halfway);
    expect(state.throttled).toBe(true);
    // The window runs from the *first* failure, so half of it remains.
    expect(state.retryAfterSeconds).toBe(WINDOW_MS / 2000);
  });

  it("forgets the window once it has passed, so the lock is never permanent", () => {
    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) recordFailure(KEY, START);
    expect(throttleState(KEY, START).throttled).toBe(true);

    expect(throttleState(KEY, START + WINDOW_MS).throttled).toBe(false);
    // And the count is gone rather than merely ignored: five fresh failures are
    // needed again, so a single later failure does not re-lock the account.
    recordFailure(KEY, START + WINDOW_MS);
    expect(throttleState(KEY, START + WINDOW_MS).throttled).toBe(false);
  });

  it("clears the count on a successful sign-in", () => {
    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) recordFailure(KEY, START);
    expect(throttleState(KEY, START).throttled).toBe(true);

    clearFailures(KEY);
    expect(throttleState(KEY, START).throttled).toBe(false);
  });

  it("counts an unknown email the same way, so the throttle reveals no accounts", () => {
    const unknown = "nobody@toktickit.local";

    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) {
      recordFailure(unknown, START);
      recordFailure(KEY, START);
    }

    // Identical treatment is the whole point: if an address that exists were
    // throttled on different terms from one that does not, the difference would
    // be the account list this rule is meant to protect.
    expect(throttleState(unknown, START)).toEqual(throttleState(KEY, START));
    expect(throttleState(unknown, START).throttled).toBe(true);
  });

  it("keeps one email's failures away from another's", () => {
    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) recordFailure(KEY, START);

    expect(throttleState(KEY, START).throttled).toBe(true);
    expect(throttleState("somchai.pattana@toktickit.local", START).throttled).toBe(false);
  });
});
