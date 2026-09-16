import { describe, it, expect, vi, afterEach } from "vitest";
import { UNREACHABLE_MESSAGE, fetchCategories } from "../../src/api.js";

// UI-12 — AC-07. The API client is the boundary where a raw browser failure has
// to become something a person can read. If that translation moves or breaks,
// the jargon reaches the screen.
//
// This is also the first `.test.ts` in the client suite: the Vitest glob only
// matched `.test.tsx` until Issue #18 widened it, so a file like this would
// silently never have run.
//
// UPDATED IN LAB 3 (Issue #48). It used to exercise `fetchRequesters`, which is
// gone with the Development Requester selector and its endpoint. The assertions
// are unchanged in substance — the same translation, on a call that still
// exists. `fetchCategories` runs the identical path through `send`, `toApiError`
// and the `ApiError` envelope.

afterEach(() => vi.restoreAllMocks());

describe("API client error translation", () => {
  it("turns a network-level TypeError into a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchCategories()).rejects.toThrow(UNREACHABLE_MESSAGE);
    await expect(fetchCategories()).rejects.not.toThrow(/Failed to fetch/);
  });

  it("reports a non-OK HTTP response without exposing the status text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), headers: new Headers() }),
    );

    await expect(fetchCategories()).rejects.toThrow(/could not be completed/i);
  });

  it("returns the parsed body when the request succeeds", async () => {
    const categories = [{ id: 2, name: "Network" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => categories, headers: new Headers() }),
    );

    await expect(fetchCategories()).resolves.toEqual(categories);
  });

  it("sends the session cookie, or every authenticated call would be a 401", async () => {
    // decision D-02: the API is a different origin, so the cookie only travels
    // when the request asks for it. This is the single line that, if dropped,
    // signs the whole application out.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [], headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);

    await fetchCategories();

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });
});
