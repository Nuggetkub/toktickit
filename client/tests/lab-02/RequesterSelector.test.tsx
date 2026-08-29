import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import { REQUESTER_STORAGE_KEY } from "../../src/requester/index.js";

// UI-01 — AC-01. The selector offers active requesters, says what it is, and
// handles loading, empty and failure.

const REQUESTERS = [
  { id: 3, fullName: "Marisa Chen", email: "marisa.chen@toktickit.local" },
  { id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" },
];

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * Routes each endpoint to its own response. Never a blanket `fetch` stub: a
 * single mock answering every URL is a suite that cannot fail, which is the
 * defect this project has already reviewed once on a partner PR.
 */
function mockFetch(handler: (url: string) => unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = handler(String(url));
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp(initialPath = "/select-requester") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Development Requester selection", () => {
  it("states plainly that it is not a login screen", async () => {
    mockFetch(() => REQUESTERS);
    renderApp();

    expect(
      await screen.findByText(/This is not a login screen and provides no security\./i),
    ).toBeInTheDocument();
  });

  it("shows a loading state, then the active requesters returned by the API", async () => {
    mockFetch(() => REQUESTERS);
    renderApp();

    expect(screen.getByRole("status")).toHaveTextContent("Loading Development Requesters");

    const select = await screen.findByLabelText(/Development Requester/);
    const options = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([
      "Choose a Development Requester",
      "Marisa Chen — marisa.chen@toktickit.local",
      "Nadia Rahman — nadia.rahman@toktickit.local",
    ]);
  });

  it("keeps Continue disabled until a requester is chosen", async () => {
    mockFetch(() => REQUESTERS);
    renderApp();

    const button = await screen.findByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/Development Requester/), "1");
    expect(button).toBeEnabled();
  });

  it("stores only the requester id and moves on to the requester's screens", async () => {
    mockFetch(() => REQUESTERS);
    renderApp();

    await userEvent.selectOptions(await screen.findByLabelText(/Development Requester/), "1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    // BR-07: an identifier, and nothing that resembles a credential.
    expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBe("1");
    expect(JSON.stringify({ ...window.localStorage })).not.toMatch(/token|password|secret/i);
  });

  it("explains an empty list rather than showing an empty dropdown", async () => {
    mockFetch(() => []);
    renderApp();

    expect(
      await screen.findByText(/No active Development Requesters are available\./i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers a retry after a failure, without leaking the browser's error text", async () => {
    let attempt = 0;
    mockFetch(() => {
      attempt += 1;
      return attempt === 1 ? new TypeError("Failed to fetch") : REQUESTERS;
    });
    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);
    expect(alert).not.toHaveTextContent(/Failed to fetch/);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByLabelText(/Development Requester/)).toBeInTheDocument());
  });

  it("shows the selected requester in the shell and clears it on Change Requester", async () => {
    mockFetch(() => REQUESTERS);
    renderApp();

    await userEvent.selectOptions(await screen.findByLabelText(/Development Requester/), "3");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect((await screen.findAllByText("Marisa Chen")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Change Requester" }));

    expect(
      await screen.findByRole("heading", { name: "Development Requester Selection" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBeNull();
    expect(screen.queryAllByText("Marisa Chen")).toHaveLength(0);
  });
});
