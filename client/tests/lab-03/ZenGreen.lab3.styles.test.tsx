import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriorityBadge, RoleBadge, StatusBadge, TICKET_STATUSES, type TicketStatus } from "../../src/components/index.js";
import App from "../../src/App.js";

// STYLE-01 in docs/lab-03/tests.md (AC-24). Lab 3 named this file and never
// wrote it; issue #78 owns it, and it is delivered in Lab 4.
//
// "Status, priority and role badges carry text and their specified tone
// classes; the notes panel uses --zen-private; Work panel fields are editable
// and ticket information read-only; focus rings are present."
//
// jsdom applies no external stylesheet, so a rendered colour would prove
// nothing (as the Lab 2 style suite explains). What is checked instead is the
// markup each component emits, and the rule each tone class has in the
// stylesheet, read from disk and compared with the Lab 3 ui-spec §1 tables,
// which are transcribed here by hand.

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles/zen-green.css"), "utf8");

/** Every declaration of the rules whose selector list names `.className`, merged. */
function declarations(className: string): Record<string, string> {
  const found: Record<string, string> = {};
  // Comments are removed first: some contain commas, which would otherwise
  // split a selector list in the wrong place.
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /([^{}]+)\{([^}]*)\}/g;
  for (const [, selectors, body] of css.matchAll(rule)) {
    const names = selectors.split(",").map((s) => s.trim());
    if (!names.includes(`.${className}`)) continue;
    for (const line of body.split(";")) {
      const [property, ...value] = line.split(":");
      if (property && value.length) found[property.trim()] = value.join(":").trim();
    }
  }
  return found;
}

// Lab 3 ui-spec §1, "Status badge tones": the word, and its tone.
const STATUS: Record<TicketStatus, { words: string; tone: string; rule: Record<string, string> }> = {
  NEW: { words: "New", tone: "zen-badge--status-new", rule: { border: "1px solid var(--zen-border)", color: "var(--zen-text)" } },
  OPEN: { words: "Open", tone: "zen-badge--status-open", rule: { background: "var(--zen-pale)", color: "var(--zen-secondary)" } },
  IN_PROGRESS: { words: "In Progress", tone: "zen-badge--status-progress", rule: { background: "var(--zen-secondary)", color: "#FFFFFF" } },
  WAITING_FOR_REQUESTER: { words: "Waiting for Requester", tone: "zen-badge--status-waiting", rule: { border: "1px solid var(--zen-warning)", color: "var(--zen-warning)" } },
  RESOLVED: { words: "Resolved", tone: "zen-badge--status-resolved", rule: { background: "var(--zen-primary)", color: "#FFFFFF" } },
  CLOSED: { words: "Closed", tone: "zen-badge--status-closed", rule: { background: "var(--zen-readonly)", color: "var(--zen-text-muted)" } },
  // "Amber fill tint": the warning surface, with warning text.
  REOPENED: { words: "Reopened", tone: "zen-badge--status-reopened", rule: { background: "var(--zen-warning-surface)", color: "var(--zen-warning)" } },
  CANCELLED: { words: "Cancelled", tone: "zen-badge--status-cancelled", rule: { background: "var(--zen-readonly)", color: "var(--zen-text-muted)" } },
};

describe("STYLE-01 status badges carry their words and their Lab 3 tone", () => {
  it.each(TICKET_STATUSES.map((status) => [status] as const))("%s", (status) => {
    const expected = STATUS[status];
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(expected.words);
    expect(badge).toHaveClass("zen-badge", expected.tone);
    expect(declarations(expected.tone)).toMatchObject(expected.rule);
  });

  it("gives Closed and Cancelled one tone, so only the words tell them apart, as the spec intends", () => {
    expect(declarations("zen-badge--status-closed")).toEqual(declarations("zen-badge--status-cancelled"));
  });
});

describe("STYLE-01 role badges carry their words and their Lab 3 tone", () => {
  // "Requester neutral, IT Staff --zen-pale, Administrator --zen-primary outline."
  it.each([
    ["REQUESTER", "Requester", "zen-badge--role-requester", { border: "1px solid var(--zen-border)" }],
    ["IT_STAFF", "IT Staff", "zen-badge--role-staff", { background: "var(--zen-pale)" }],
    ["ADMINISTRATOR", "Administrator", "zen-badge--role-admin", { border: "1px solid var(--zen-primary)" }],
  ] as const)("%s", (role, words, tone, rule) => {
    render(<RoleBadge role={role} />);
    expect(screen.getByText(words)).toHaveClass("zen-badge", tone);
    expect(declarations(tone)).toMatchObject(rule);
  });
});

describe("STYLE-01 priority badges keep their Lab 2 tones and always carry their label", () => {
  it.each([
    ["LOW", "zen-badge--neutral"],
    ["MEDIUM", "zen-badge--neutral"],
    ["HIGH", "zen-badge--warning"],
    ["URGENT", "zen-badge--danger"],
  ] as const)("%s", (priority, tone) => {
    render(
      <>
        <PriorityBadge kind="Requested" priority={priority} />
        <PriorityBadge kind="IT" priority={priority} />
      </>,
    );
    const badges = screen.getAllByText(priority);
    expect(badges).toHaveLength(2);
    for (const badge of badges) expect(badge).toHaveClass("zen-badge", tone);
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });
});

describe("STYLE-01 the private surface (Lab 3 ui-spec §1)", () => {
  it("defines --zen-private as the pale amber the spec names", () => {
    expect(stylesheet).toMatch(/--zen-private:\s*#FFF7E8;/i);
  });

  it("uses it on the Internal Notes panel, with a warning left border, and nowhere else", () => {
    expect(declarations("zen-discussion--private")).toMatchObject({
      background: "var(--zen-private)",
      "border-left": "4px solid var(--zen-warning)",
    });
    expect(stylesheet.match(/var\(--zen-private\)/g)).toHaveLength(1);
  });
});

describe("STYLE-01 focus rings are present", () => {
  it("draws a visible outline on focus, and no rule removes it", () => {
    expect(stylesheet).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--zen-secondary\)/);
    expect(stylesheet).not.toMatch(/:focus(-visible)?\s*\{[^}]*outline:\s*(none|0)\s*;/);
  });
});

// On the real IT Staff Ticket Detail: the Requester's facts are read-only, the
// Work panel's controls are editable, and Internal Notes sit on the private
// surface with the heading the spec gives them.
describe("STYLE-01 on the IT Staff Ticket Detail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockApi() {
    const detail = {
      id: 42, ticketNumber: "TKT-2026-00042", ticketDate: "2026-09-14T09:14:22.518Z",
      requester: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" }, category: { id: 2, name: "Network" },
      relatedSystem: { id: 5, name: "Campus Wi-Fi" }, summary: "Cannot connect", description: "Authentication failure.",
      requestedPriority: "HIGH", itPriority: "URGENT", currentStatus: "IN_PROGRESS",
      owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }, resolutionSummary: null, requesterResolvedAt: null,
      version: 4, attachments: [], createdAt: "2026-09-14T09:14:22.518Z", updatedAt: "2026-09-14T10:02:51.004Z",
      resolutionGate: { openActions: 0, completedActions: 1, latestFollowUpRequired: false, reopenedSinceWork: false, ready: true },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(String(input), "http://localhost");
      const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
      if (url.pathname === "/api/auth/me") return answer({ user: { id: 7, fullName: "Grace Okafor", email: "grace@toktickit.local", role: "IT_STAFF", mustChangePassword: false } });
      if (url.pathname === "/api/tickets/42") return answer(detail);
      if (url.pathname === "/api/tickets/42/actions") return answer({ items: [] });
      if (url.pathname === "/api/tickets/42/history") return answer({ items: [], recordedFromCreation: true });
      if (["/api/tickets/42/comments", "/api/tickets/42/internal-notes", "/api/categories", "/api/related-systems"].includes(url.pathname)) return answer([]);
      if (url.pathname === "/api/staff/assignees") return answer([{ id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }]);
      throw new Error(`Unexpected request: ${url.pathname}`);
    }));
  }

  async function renderDetail() {
    mockApi();
    render(<MemoryRouter initialEntries={["/queue/42"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
  }

  it("shows the ticket information read-only and the Work panel editable", async () => {
    await renderDetail();
    const information = screen.getByRole("heading", { name: "Ticket information" }).closest("section")!;
    // No editable control among the Requester's facts.
    expect(within(information).queryAllByRole("textbox").filter((el) => !(el as HTMLInputElement).readOnly)).toHaveLength(0);
    expect(within(information).queryAllByRole("combobox")).toHaveLength(0);

    const work = screen.getByRole("heading", { name: "Work" }).closest("section")!;
    for (const label of ["Owner", "IT Priority", "Status"]) {
      expect(within(work).getByLabelText(new RegExp(`^${label}`))).toBeEnabled();
    }
  });

  it("puts Internal Notes on the private surface, under the heading the spec gives it", async () => {
    await renderDetail();
    screen.getByRole("tab", { name: /^Internal notes/ }).click();
    const heading = await screen.findByText("Internal notes — visible only to IT Staff and Administrators");
    expect(heading.closest("section")).toHaveClass("zen-discussion--private");
  });
});
