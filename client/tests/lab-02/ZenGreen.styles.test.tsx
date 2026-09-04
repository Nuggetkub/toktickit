import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  ReadOnlyField,
  StatusMessage,
} from "../../src/components/index.js";

/**
 * STYLE-01 — the automated half of Part 9.
 *
 * jsdom does not apply an external stylesheet, so asserting a rendered colour
 * here would prove nothing. Instead this suite asserts the two things that can
 * be checked mechanically and that actually regress in practice: the token
 * values in the stylesheet itself, and the markup contract every screen relies
 * on — labels, required markers, message placement, button state and ARIA
 * roles. Colour rendering is covered by the visual checklist in ui-spec.md §11
 * and the Playwright screenshots in Issue #27.
 */

// Read from disk rather than imported. Vitest disables CSS processing, so a
// `?raw` import of a stylesheet resolves to an empty string and every token
// assertion below would pass vacuously. The suite runs from the client package
// root, which is a stable anchor.
const stylesheet = readFileSync(resolve(process.cwd(), "src/styles/zen-green.css"), "utf8");

describe("Zen Green tokens", () => {
  // These four values are fixed by the labsheet, not by us. Pinning them means
  // a well-meaning tweak to the palette fails the suite instead of silently
  // shipping a different theme.
  it.each([
    ["--zen-primary", "#006B3C"],
    ["--zen-secondary", "#0B7A46"],
    ["--zen-pale", "#EAF6EF"],
    ["--zen-page", "#F5F7F6"],
  ])("defines %s as %s", (token, value) => {
    expect(stylesheet).toMatch(new RegExp(`${token}:\\s*${value};`, "i"));
  });

  it("uses a charcoal-green body colour rather than pure black", () => {
    expect(stylesheet).toMatch(/--zen-text:\s*#12241C;/i);
    expect(stylesheet).not.toMatch(/--zen-text:\s*#000(000)?;/i);
  });

  it("defines the read-only surface, error and warning tokens", () => {
    expect(stylesheet).toMatch(/--zen-readonly:/);
    expect(stylesheet).toMatch(/--zen-error:/);
    expect(stylesheet).toMatch(/--zen-warning:/);
  });

  it("declares the three labsheet breakpoints", () => {
    expect(stylesheet).toMatch(/max-width:\s*991px/);
    expect(stylesheet).toMatch(/max-width:\s*767px/);
  });
});

describe("Button", () => {
  it("renders each variant with its own class", () => {
    render(
      <>
        <Button variant="primary">Submit Ticket</Button>
        <Button variant="secondary">Download</Button>
        <Button variant="tertiary">Clear filters</Button>
        <Button variant="destructive">Remove</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Submit Ticket" })).toHaveClass("zen-button--primary");
    expect(screen.getByRole("button", { name: "Download" })).toHaveClass("zen-button--secondary");
    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveClass("zen-button--tertiary");
    expect(screen.getByRole("button", { name: "Remove" })).toHaveClass("zen-button--destructive");
  });

  it("is disabled and announced as busy while submitting", () => {
    render(
      <Button busy busyLabel="Creating ticket…">
        Submit Ticket
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Creating ticket…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("cannot be activated while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Submit Ticket
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" })).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Change Requester</Button>);
    expect(screen.getByRole("button", { name: "Change Requester" })).toHaveAttribute("type", "button");
  });
});

describe("Field", () => {
  it("labels its control and marks a required field", () => {
    render(
      <Field id="summary" label="Ticket Summary" required>
        {(control) => <input type="text" {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Ticket Summary/);
    expect(input).toHaveAttribute("id", "summary");
    expect(input).toHaveAttribute("aria-required", "true");
    // The asterisk is decorative; the accessible name carries the requirement.
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the validation message beneath its own field and wires it up", () => {
    render(
      <Field id="summary" label="Ticket Summary" required error="Summary must be at least 5 characters.">
        {(control) => <input type="text" {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Ticket Summary/);
    const message = screen.getByText("Summary must be at least 5 characters.");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "summary-error");
    expect(message).toHaveAttribute("id", "summary-error");
    // Placement: the message follows the control inside the same field group,
    // rather than being collected at the top of the form.
    expect(input.parentElement).toBe(message.parentElement);
    expect(input.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("announces a validation message that appears after submission", () => {
    // aria-describedby alone is only read when the control takes focus, so an
    // error revealed by submitting would be silent for a screen-reader user
    // sitting anywhere else on the form. Re-rendering from valid to invalid is
    // exactly that transition.
    const { rerender } = render(
      <Field id="summary" label="Ticket Summary" required>
        {(control) => <input type="text" {...control} />}
      </Field>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <Field id="summary" label="Ticket Summary" required error="Summary must be at least 5 characters.">
        {(control) => <input type="text" {...control} />}
      </Field>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Summary must be at least 5 characters.");
    expect(alert).toHaveAttribute("id", "summary-error");
    // The description wiring stays, for the case where focus does reach the field.
    expect(screen.getByLabelText(/Ticket Summary/)).toHaveAttribute("aria-describedby", "summary-error");
  });

  it("marks the group invalid so the control can be styled", () => {
    const { container } = render(
      <Field id="description" label="Description" error="Required.">
        {(control) => <textarea {...control} />}
      </Field>,
    );

    expect(container.querySelector(".zen-field")).toHaveClass("zen-field--invalid");
  });

  it("shows a read-only value distinctly from an editable one", () => {
    const { container } = render(<ReadOnlyField label="Ticket Number" value="Assigned after saving" />);

    expect(container.querySelector(".zen-field")).toHaveClass("zen-field--readonly");
    expect(screen.getByText("Assigned after saving")).toBeInTheDocument();
    // Nothing focusable: Lab 2 never lets a requester edit a system value.
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });
});

describe("Feedback components", () => {
  it("announces loading politely with role=status", () => {
    render(<StatusMessage>Loading Development Requesters…</StatusMessage>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Development Requesters…");
  });

  it("announces an actionable failure with role=alert and offers a retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorAlert onRetry={onRetry}>Unable to load Development Requesters.</ErrorAlert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Development Requesters.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("gives an empty state a title and its own recovery action", () => {
    render(
      <EmptyState
        title="You have not created any tickets yet."
        action={<Button>Create Ticket</Button>}
      />,
    );

    expect(screen.getByText("You have not created any tickets yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Ticket" })).toBeInTheDocument();
  });

  it("renders a badge as readable text, not colour alone", () => {
    render(<Badge tone="danger">Removed</Badge>);
    const badge = screen.getByText("Removed");
    expect(badge).toHaveClass("zen-badge--danger");
    expect(badge).toHaveTextContent("Removed");
  });
});

describe("AppShell", () => {
  const navItems = [
    { key: "create-ticket", label: "Create Ticket" },
    { key: "my-tickets", label: "My Tickets" },
  ];

  it("shows the TokTickIT identity and marks the active route", () => {
    render(
      <AppShell navItems={navItems} activeKey="my-tickets">
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByText("TokTickIT")).toBeInTheDocument();

    const active = screen.getByRole("button", { name: "My Tickets" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("zen-nav__item--active");

    const inactive = screen.getByRole("button", { name: "Create Ticket" });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("shows the selected requester and calls back on Change Requester", async () => {
    const onChangeRequester = vi.fn();
    render(
      <AppShell requesterName="Nadia Rahman" onChangeRequester={onChangeRequester}>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByText("Nadia Rahman")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change Requester" }));
    expect(onChangeRequester).toHaveBeenCalledTimes(1);
  });

  it("omits the requester context entirely when none is selected", () => {
    render(
      <AppShell navItems={navItems}>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.queryByText("Development Requester")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change Requester" })).not.toBeInTheDocument();
  });

  it("renders its children inside a main landmark", () => {
    render(
      <AppShell>
        <Card title="IT Service Desk">
          <p>content</p>
        </Card>
      </AppShell>,
    );

    expect(screen.getByRole("main")).toContainElement(screen.getByText("content"));
  });
});
