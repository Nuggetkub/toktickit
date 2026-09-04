import { describe, it, expect, vi, afterEach } from "vitest";
import { UNREACHABLE_MESSAGE, fetchRequesters } from "../../src/api.js";

// UI-12 — AC-07. The API client is the boundary where a raw browser failure has
// to become something a person can read. If that translation moves or breaks,
// the jargon reaches the screen.
//
// This is also the first `.test.ts` in the client suite: the Vitest glob only
// matched `.test.tsx` until Issue #18 widened it, so a file like this would
// silently never have run.

afterEach(() => vi.restoreAllMocks());

describe("API client error translation", () => {
  it("turns a network-level TypeError into a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchRequesters()).rejects.toThrow(UNREACHABLE_MESSAGE);
    await expect(fetchRequesters()).rejects.not.toThrow(/Failed to fetch/);
  });

  it("reports a non-OK HTTP response without exposing the status text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

    await expect(fetchRequesters()).rejects.toThrow(/Could not load Development Requesters/);
  });

  it("returns the parsed body when the request succeeds", async () => {
    const requesters = [{ id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => requesters }));

    await expect(fetchRequesters()).resolves.toEqual(requesters);
  });
});
