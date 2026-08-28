import { useState } from "react";
import { checkSystem, Category } from "./api.js";
import {
  AppShell,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  StatusMessage,
  type NavItem,
} from "./components/index.js";

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

// Create Ticket and My Tickets arrive with Issues #22 and #24. They are shown
// disabled rather than hidden so the shell is honest about what exists.
const NAV_ITEMS: NavItem[] = [
  { key: "system-check", label: "System Check" },
  { key: "create-ticket", label: "Create Ticket", disabled: true },
  { key: "my-tickets", label: "My Tickets", disabled: true },
];

export default function App() {
  const [state, setState] = useState<UiState>("idle");
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");

  async function handleCheck() {
    setState("loading");
    setError("");
    try {
      const status = await checkSystem();
      setCategories(status.categories);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the API.");
      setState("error");
    }
  }

  return (
    <AppShell navItems={NAV_ITEMS} activeKey="system-check">
      <Card title="IT Service Desk" as="h1">
        <Button variant="primary" onClick={handleCheck} busy={state === "loading"} busyLabel="Loading…">
          Check System
        </Button>

        {state === "loading" && <StatusMessage>Checking the API…</StatusMessage>}

        {state === "success" && (
          <>
            <p>
              System Status: <span className="zen-text-success">Online</span>
            </p>

            <h2 className="zen-section-title">Supported Request Categories:</h2>
            {categories.length === 0 ? (
              <EmptyState title="No categories found." />
            ) : (
              <ul className="zen-list">
                {categories.map((category) => (
                  <li key={category.id}>{category.name}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {state === "error" && (
          <ErrorAlert onRetry={handleCheck}>
            System Status: <span className="zen-text-error">Offline</span> — {error}
          </ErrorAlert>
        )}
      </Card>
    </AppShell>
  );
}
