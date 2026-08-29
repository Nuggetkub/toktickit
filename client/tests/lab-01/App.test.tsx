import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SystemCheck from "../../src/SystemCheck.js";
import { AppShell } from "../../src/components/index.js";

// These tests mock at the `fetch` level rather than mocking checkSystem, so the
// real api.ts runs — including its error translation. Mocking checkSystem would
// skip that module entirely and leave the translation untested.
//
// UPDATED IN LAB 2 (Issue #20). App.tsx became the router, so the Lab 1 screen
// now lives in src/SystemCheck.tsx and these tests render it directly. Nothing
// about the screen's markup, behaviour or assertions changed — only the import
// and the element under test. It is rendered inside AppShell because that is
// where the TokTickIT identity has lived since Issue #18, and this test
// asserts on it.
afterEach(() => vi.restoreAllMocks());

const SEEDED = [
  { id: 1, name: "Account and Access" },
  { id: 2, name: "Hardware" },
  { id: 3, name: "Software" },
  { id: 4, name: "Network" },
];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Routes each endpoint to its own response, so ordering bugs cannot hide. */
function mockFetch(routes: { health?: unknown; categories?: unknown }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/health")) {
      return routes.health ?? jsonResponse({ status: "ok", service: "TokTickIT API" });
    }
    if (url.includes("/api/categories")) {
      return routes.categories ?? jsonResponse(SEEDED);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("System check screen", () => {
  // UI-01
  it("renders the TokTickIT heading", () => {
    render(
      <AppShell>
        <SystemCheck />
      </AppShell>,
    );
    expect(screen.getByText(/TokTickIT/i)).toBeInTheDocument();
  });

  // UI-02
  it("shows Online and the seeded categories on success", async () => {
    const fetchMock = mockFetch({});

    render(
      <AppShell>
        <SystemCheck />
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /check system/i }));

    expect(await screen.findByText("Online")).toBeInTheDocument();
    // Wording required by the demo specification.
    expect(screen.getByText(/System Status:/)).toBeInTheDocument();
    expect(screen.getByText("Supported Request Categories:")).toBeInTheDocument();

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Account and Access",
      "Hardware",
      "Software",
      "Network",
    ]);

    // Both endpoints were really called through api.ts.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/health");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/categories");
  });

  // UI-03
  it("shows an Offline error message when the API is unavailable", async () => {
    // What the browser actually throws when the server is not running.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(
      <AppShell>
        <SystemCheck />
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /check system/i }));

    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/System Status:/)).toBeInTheDocument();
    // The raw browser jargon must be translated, not shown to the user.
    expect(screen.getByText(/Unable to connect to TokTickIT API/i)).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows Offline when the categories endpoint returns an error status", async () => {
    mockFetch({ categories: jsonResponse({ error: "Could not load categories." }, 500) });

    render(
      <AppShell>
        <SystemCheck />
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /check system/i }));

    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
