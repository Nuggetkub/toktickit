import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-08 — AC-20, AC-21, AC-22 (docs/lab-03/tests.md).
//
// The screen's claims are about what it *sends* as much as what it shows: a role
// filter that changes the dropdown but not the query, or an edit that posts
// fields nobody touched, both look like working software. So each control is
// asserted against the request it produces as well as against the rows.
//
// "Create user" is the toolbar button, the panel's accessible name, its heading
// and its submit, so panel assertions are scoped with `within(panel)` rather
// than matched loosely — an unscoped query matches four elements.

const ADMIN = {
  id: 9,
  fullName: "Aurelia Admin",
  email: "aurelia.admin@toktickit.local",
  role: "ADMINISTRATOR",
  mustChangePassword: false,
};

function user(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    fullName: `Person ${id}`,
    email: `person${id}@toktickit.local`,
    role: "REQUESTER",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

type Answer = { status: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Answer;

function envelope(status: number, code: string, message: string, fieldErrors?: Record<string, string>): Answer {
  return { status, body: { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } } };
}

function mockApi(handlers: Record<string, Handler> = {}, seed: unknown[] = [user(1), user(2, { role: "IT_STAFF" })]) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      method,
      path: url.pathname,
      search: url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const answer = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
      headers: new Headers(),
    });

    const handler = handlers[`${method} ${url.pathname}`];
    if (handler) {
      const result = handler(init);
      return answer(result.status, result.body);
    }

    if (url.pathname === "/api/auth/me") return answer(200, { user: ADMIN });
    if (url.pathname === "/api/admin/users") return answer(200, { items: seed });
    if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderUsers() {
  render(
    <MemoryRouter initialEntries={["/users"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "User Management" });
}

/** The Create or Edit panel, which shares its wording with the toolbar. */
function panel(name: string) {
  return within(screen.getByRole("region", { name }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("User Management — the list", () => {
  it("shows the five columns the contract names, with role and status in words", async () => {
    mockApi();
    await renderUsers();

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Name", "Email", "Role", "Status", "Edit"]);

    // ui-spec.md §1: never colour alone.
    expect(within(table).getByText("Requester")).toBeInTheDocument();
    expect(within(table).getByText("IT Staff")).toBeInTheDocument();
    expect(within(table).getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("says Inactive in words for a deactivated account", async () => {
    mockApi({}, [user(1, { isActive: false })]);
    await renderUsers();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Inactive")).toBeInTheDocument();
  });

  it("omits an untouched filter rather than sending it blank", async () => {
    const { calls } = mockApi();
    await renderUsers();
    await screen.findByRole("table");

    // The server rejects an empty search rather than ignoring it, so a blank
    // filter must be absent from the query string, not present and empty.
    const first = calls.find((call) => call.path === "/api/admin/users")!;
    expect(first.search).toBe("");
  });

  it("sends the search and the role filter as query parameters", async () => {
    const { calls } = mockApi();
    await renderUsers();
    await screen.findByRole("table");

    await userEvent.type(screen.getByLabelText("Search by name or email"), "aurelia");
    await waitFor(() => {
      const last = calls.filter((call) => call.path === "/api/admin/users").at(-1)!;
      expect(new URLSearchParams(last.search).get("search")).toBe("aurelia");
    });

    await userEvent.selectOptions(screen.getByLabelText("Role"), "IT_STAFF");
    await waitFor(() => {
      const last = calls.filter((call) => call.path === "/api/admin/users").at(-1)!;
      expect(new URLSearchParams(last.search).get("role")).toBe("IT_STAFF");
    });
  });

  it("distinguishes no matches from a failure", async () => {
    mockApi({}, []);
    await renderUsers();
    expect(await screen.findByText("No users match your search.")).toBeInTheDocument();
  });

  it("offers a retry on failure and recovers on it", async () => {
    let attempt = 0;
    mockApi({
      "GET /api/admin/users": () => {
        attempt += 1;
        return attempt === 1 ? envelope(503, "DEPENDENCY_UNAVAILABLE", "nope") : { status: 200, body: { items: [user(1)] } };
      },
    });
    await renderUsers();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("person1@toktickit.local")).toBeInTheDocument();
  });
});

describe("User Management — creating", () => {
  it("shows only the password rules that apply to an initial password", async () => {
    // BR-11 has six rules; two of them judge a current password and a
    // confirmation, neither of which exists when an Administrator sets somebody
    // else's initial password. Rendering them anyway would tick two boxes for
    // every password ever typed.
    mockApi();
    await renderUsers();
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    const create = panel("Create user");
    expect(create.getByText(/At least 12 characters/)).toBeInTheDocument();
    expect(create.getByText(/Different from your email address/)).toBeInTheDocument();
    expect(create.queryByText(/Different from your current password/)).not.toBeInTheDocument();
    expect(create.queryByText(/Matches the confirmation/)).not.toBeInTheDocument();
  });

  it("will not submit until the rules are met, then posts the new account", async () => {
    const { calls } = mockApi({
      "POST /api/admin/users": () => ({ status: 201, body: user(7, { fullName: "New Hire", role: "IT_STAFF" }) }),
    });
    await renderUsers();
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    const create = panel("Create user");
    const submit = create.getByRole("button", { name: "Create user" });
    expect(submit).toBeDisabled();

    await userEvent.type(create.getByLabelText(/Full name/), "New Hire");
    await userEvent.type(create.getByLabelText(/Email address/), "new.hire@toktickit.local");
    await userEvent.selectOptions(create.getByLabelText(/^Role/), "IT_STAFF");
    await userEvent.type(create.getByLabelText(/Initial password/), "correct-horse-battery-staple");

    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/api/admin/users")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      fullName: "New Hire",
      email: "new.hire@toktickit.local",
      role: "IT_STAFF",
      isActive: true,
      initialPassword: "correct-horse-battery-staple",
    });
  });

  it("puts a duplicate email beneath its field and keeps what was typed", async () => {
    mockApi({
      "POST /api/admin/users": () => envelope(409, "EMAIL_ALREADY_EXISTS", "Another account already uses that email address."),
    });
    await renderUsers();
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    const create = panel("Create user");
    await userEvent.type(create.getByLabelText(/Full name/), "Second Claimant");
    await userEvent.type(create.getByLabelText(/Email address/), "taken@toktickit.local");
    await userEvent.type(create.getByLabelText(/Initial password/), "correct-horse-battery-staple");
    await userEvent.click(create.getByRole("button", { name: "Create user" }));

    // Asserted as *placement*, not presence. §9 puts a duplicate email beneath
    // its field, and the panel's error banner would carry the very same
    // sentence — so `findByText` inside the panel matched whichever element
    // held it. Disabling the EMAIL_ALREADY_EXISTS branch left this test green
    // until it checked what the message is attached to: with the branch gone the
    // message falls through to the banner, where the email input is neither
    // invalid nor described by it.
    const emailField = create.getByLabelText(/Email address/);
    await waitFor(() => expect(emailField).toBeInvalid());
    expect(emailField).toHaveAccessibleDescription(/Another account already uses that email address\./);

    // §9: the panel stays open with its values, so a refusal does not cost them
    // the form.
    expect(create.getByLabelText(/Email address/)).toHaveValue("taken@toktickit.local");
    expect(create.getByLabelText(/Full name/)).toHaveValue("Second Claimant");
  });
});

describe("User Management — editing", () => {
  it("sends only the fields that actually changed", async () => {
    const { calls } = mockApi({
      "PATCH /api/admin/users/1": () => ({ status: 200, body: { user: user(1, { fullName: "Renamed" }), unassignedTicketCount: 0 } }),
    });
    await renderUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Person 1" }));

    const edit = panel("Edit user");
    await userEvent.clear(edit.getByLabelText(/Full name/));
    await userEvent.type(edit.getByLabelText(/Full name/), "Renamed");
    await userEvent.click(edit.getByRole("button", { name: "Save user" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    // An unchanged role or email must not be sent: the server rejects unknown
    // fields and the safety rules would otherwise reason about a no-op change.
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ fullName: "Renamed" });
  });

  it("reports the tickets a deactivation unassigned", async () => {
    mockApi({
      "PATCH /api/admin/users/2": () => ({
        status: 200,
        body: { user: user(2, { role: "IT_STAFF", isActive: false }), unassignedTicketCount: 3 },
      }),
    });
    await renderUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Person 2" }));

    const edit = panel("Edit user");
    await userEvent.click(edit.getByLabelText("Active account"));
    await userEvent.click(edit.getByRole("button", { name: "Save user" }));

    // BR-25's consequence, told rather than left to be discovered in the queue.
    expect(await screen.findByText(/3 open tickets were unassigned/)).toBeInTheDocument();
  });

  it("disables Role and Active on your own account, and says why", async () => {
    mockApi({}, [user(9, { fullName: "Aurelia Admin", email: ADMIN.email, role: "ADMINISTRATOR" })]);
    await renderUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Aurelia Admin" }));

    const edit = panel("Edit user");
    expect(edit.getByLabelText(/^Role/)).toBeDisabled();
    expect(edit.getByLabelText("Active account")).toBeDisabled();
    expect(edit.getByText("You cannot deactivate your own account or change your own role.")).toBeInTheDocument();
    // The name is still editable: BR-41 removes access, not identity.
    expect(edit.getByLabelText(/Full name/)).toBeEnabled();
  });

  it("shows the last-Administrator refusal as an alert", async () => {
    mockApi(
      {
        "PATCH /api/admin/users/3": () =>
          envelope(409, "LAST_ACTIVE_ADMINISTRATOR", "At least one active Administrator must remain."),
      },
      [user(3, { fullName: "Other Admin", role: "ADMINISTRATOR" })],
    );
    await renderUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Other Admin" }));

    const edit = panel("Edit user");
    await userEvent.click(edit.getByLabelText("Active account"));
    await userEvent.click(edit.getByRole("button", { name: "Save user" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("At least one active Administrator is required.");
  });

  it("sets a new initial password from its own section", async () => {
    const { calls } = mockApi({
      "POST /api/admin/users/1/initial-password": () => ({ status: 200, body: user(1, { mustChangePassword: true }) }),
    });
    await renderUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Person 1" }));

    const edit = panel("Edit user");
    await userEvent.type(edit.getByLabelText(/New initial password/), "correct-horse-battery-staple");
    await userEvent.click(edit.getByRole("button", { name: "Set new initial password" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "/api/admin/users/1/initial-password")).toBe(true),
    );
    // Its own button, so a password reset can never ride along with a rename.
    expect(calls.find((call) => call.path === "/api/admin/users/1/initial-password")?.body).toEqual({
      initialPassword: "correct-horse-battery-staple",
    });
    // Scoped to the notice: the section's standing hint carries the same words,
    // so an unscoped query cannot tell the instruction from the confirmation.
    expect(await screen.findByRole("status")).toHaveTextContent(/must choose a new password/);
  });
});

describe("User Management — who may see it", () => {
  it("is refused to IT Staff, and asks the admin API for nothing", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "http://localhost");
        calls.push(url.pathname);
        const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
        if (url.pathname === "/api/auth/me") return json({ user: { ...ADMIN, id: 7, role: "IT_STAFF" } });
        if (url.pathname === "/api/staff/tickets") return json({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
        if (url.pathname === "/api/staff/assignees") return json([]);
        if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return json([]);
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={["/users"]}>
        <App />
      </MemoryRouter>,
    );

    // ui-spec.md §5's wording, which deliberately names no resource.
    expect(await screen.findByRole("heading", { name: "You do not have access to this page" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "User Management" })).not.toBeInTheDocument();
    // The screen gate is a courtesy; the proof that matters is that no request
    // for user data was made at all.
    expect(calls.some((path) => path.startsWith("/api/admin"))).toBe(false);
  });
});
