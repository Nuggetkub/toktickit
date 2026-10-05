import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsTaken } from "../../src/actions/ActionsTaken";
import { ActionStatusBadge } from "../../src/components/index.js";
import { AppShell } from "../../src/components/AppShell";
import { MetricCard } from "../../src/components/MetricCard";
import type { ActionTaken } from "../../src/api";

// STYLE-01 in docs/lab-04/tests.md (AC-28): the Lab 4 components' markup, and
// the stylesheet rules behind it, read from disk. jsdom applies no external
// stylesheet, so a rendered colour would prove nothing (Lab 3 STYLE-01 explains
// the same); the computed focus ring and the layouts are proven in a browser by
// RESP-01. The last three groups pin the defects RESP-01's captures exposed in
// issue #90.

const css = readFileSync(resolve(process.cwd(), "src/styles/zen-green.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The merged declarations of every rule whose selector list contains `selector` exactly. */
function rule(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const line of body.split(";")) {
      const [property, ...value] = line.split(":");
      if (property && value.length) found[property.trim()] = value.join(":").trim();
    }
  }
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("STYLE-01 MetricCard: a label, a value and a sentence-form name, with a focus ring", () => {
  it("reads as a sentence and holds its label, value and explanation", () => {
    render(<MemoryRouter><MetricCard label="Unassigned" value={4} noun="ticket" explanation="Active tickets that nobody owns yet" to="/queue?owner=unassigned" /></MemoryRouter>);
    const card = screen.getByRole("link", { name: "Unassigned: 4 tickets" });
    expect(card).toHaveClass("zen-metric");
    expect(card).toHaveAttribute("href", "/queue?owner=unassigned");
    expect(within(card).getByText("Unassigned")).toHaveClass("zen-metric__label");
    expect(within(card).getByText("4")).toHaveClass("zen-metric__value");
    expect(within(card).getByText("Active tickets that nobody owns yet")).toHaveClass("zen-metric__explanation");
  });

  it("says one in the singular, and a same-page count is an anchor, never nowhere", () => {
    render(<MemoryRouter><MetricCard label="My open actions" value={1} noun="action" explanation="Assigned to you" to="#my-open-actions" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "My open actions: 1 action" })).toHaveAttribute("href", "#my-open-actions");
  });

  it("is a link, so the shared focus ring applies, and nothing switches it off", () => {
    // Matched whole: its selector has commas inside :where(), which rule() would split.
    const ring = css.match(/:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/);
    expect(ring?.[1].split(",").map((s) => s.trim())).toContain("a");
    expect(ring?.[2]).toMatch(/outline:\s*3px solid var\(--zen-secondary\)/);
    expect(rule(".zen-metric").outline).toBeUndefined();
    expect(rule(".zen-metric:focus").outline).toBeUndefined();
  });
});

describe("STYLE-01 ActionStatusBadge carries its word and its tone (ui-spec §1)", () => {
  it.each([
    ["OPEN", "Open", "zen-badge--status-waiting"],
    ["COMPLETED", "Completed", "zen-badge--status-resolved"],
    ["CANCELLED", "Cancelled", "zen-badge--status-cancelled"],
  ] as const)("%s", (status, words, tone) => {
    render(<ActionStatusBadge status={status} />);
    expect(screen.getByText(words)).toHaveClass("zen-badge", tone);
    expect(Object.keys(rule(`.${tone}`)).length).toBeGreaterThan(0);
  });
});

describe("STYLE-01 the active navigation item: aria-current and an underline, not colour alone", () => {
  it("marks the active item for assistive technology and draws its underline", () => {
    render(
      <AppShell navItems={[{ key: "/dashboard", label: "Dashboard" }, { key: "/queue", label: "Ticket Queue" }]} activeKey="/dashboard" userName="Grace Okafor" userRole="IT_STAFF">
        <p>content</p>
      </AppShell>,
    );
    const active = screen.getByRole("button", { name: "Dashboard" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("zen-nav__item--active");
    expect(screen.getByRole("button", { name: "Ticket Queue" })).not.toHaveAttribute("aria-current");
    // The underline is a coloured bottom border on a 3 px one every item reserves.
    expect(rule(".zen-nav__item")["border-bottom"]).toBe("3px solid transparent");
    expect(rule(".zen-nav__item--active")["border-bottom-color"]).toBe("var(--zen-primary)");
  });
});

// The Actions section, as the list and the form render it.
const ME = { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" as const };
function action(id: number, overrides: Partial<ActionTaken> = {}): ActionTaken {
  return {
    id, ticketId: 42, status: "OPEN", actionAt: "2026-09-20T09:00:00.000Z",
    description: `Work item ${id}`, result: null, followUpRequired: false, followUpNote: null, attachmentNotes: null,
    assignee: ME, performedBy: null, completedAt: null, cancelledBy: null, cancelledAt: null, cancellationReason: null,
    createdBy: ME, createdAt: "2026-09-20T09:05:00.000Z", updatedAt: "2026-09-20T09:05:00.000Z", version: 1,
    ...overrides,
  };
}
function mockActions(items: ActionTaken[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/tickets/42/actions") return answer({ items });
    if (url.pathname === "/api/staff/assignees") return answer([ME]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  }));
}

describe("STYLE-01 the Follow-up note is announced (ui-spec §7)", () => {
  it("the checkbox has aria-controls naming the note, which follows it once ticked", async () => {
    mockActions([]);
    render(<ActionsTaken ticketId={42} ticketStatus="IN_PROGRESS" canWrite currentUserId={ME.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    const box = screen.getByRole("checkbox", { name: "Follow-up required" });
    expect(box).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(box);
    const note = screen.getByLabelText(/^Follow-up note/);
    expect(box).toHaveAttribute("aria-controls", note.id);
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("STYLE-01 the defects RESP-01's captures exposed (issue #90)", () => {
  it("a checkbox or radio in a field is sized as one, not stretched like a text box", () => {
    for (const selector of ['.zen-field input[type="checkbox"]', '.zen-field input[type="radio"]']) {
      expect(rule(selector), selector).toMatchObject({ width: "1.25rem", "min-height": "0", padding: "0" });
    }
    // Its label keeps the 44 px touch height.
    expect(rule('.zen-field label:has(> input[type="checkbox"])')).toMatchObject({ "min-height": "44px", display: "flex" });
  });

  it("a status badge in the Actions table stays whole while long text in the row wraps", () => {
    expect(rule(".zen-actions-table td")["overflow-wrap"]).toBe("anywhere");
    expect(rule(".zen-actions-table .zen-badge")).toMatchObject({ "white-space": "nowrap", "overflow-wrap": "normal" });
  });

  it("each Actions cell holds one wrapper, so a mobile label-and-value row cannot split into columns", async () => {
    mockActions([action(1, { status: "COMPLETED", result: "Link stable under load.", followUpRequired: true, followUpNote: "Check again Friday." })]);
    render(<ActionsTaken ticketId={42} ticketStatus="IN_PROGRESS" canWrite currentUserId={ME.id} />);
    const row = (await screen.findByText("Work item 1")).closest("tr")!;
    for (const label of ["Description", "Status"]) {
      const cell = row.querySelector<HTMLElement>(`td[data-label="${label}"]`)!;
      const parts = Array.from(cell.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent!.trim() !== ""));
      expect(parts, label).toHaveLength(1);
    }
    expect(within(row.querySelector<HTMLElement>('td[data-label="Description"]')!).getByText("Link stable under load.")).toBeInTheDocument();
  });
});
