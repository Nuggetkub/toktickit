import { useState } from "react";
import { checkSystem, Category } from "./api.js";
import { Button, Card, EmptyState, ErrorAlert, StatusMessage } from "./components/index.js";

// The Lab 1 system check, moved out of App.tsx when App became the router in
// Issue #20. The markup and behaviour are unchanged — only where it is mounted
// moved, and tests/lab-01/App.test.tsx now renders this component directly.

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

export default function SystemCheck() {
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
  );
}
