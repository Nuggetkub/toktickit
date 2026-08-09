import { useState } from "react";
import { checkSystem, Category } from "./api.js";

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

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
    <div className="container py-5" style={{ maxWidth: 640 }}>
      <h1 className="h3 mb-4">
        TokTickIT <span className="text-success">IT Service Desk</span>
      </h1>

      <button className="btn btn-success" onClick={handleCheck} disabled={state === "loading"}>
        {state === "loading" ? "Loading…" : "Check System"}
      </button>

      {state === "loading" && (
        <p className="mt-3 mb-0 text-secondary">Checking the API…</p>
      )}

      {state === "success" && (
        <>
          <p className="mt-3 mb-2">
            Status: <span className="text-success fw-semibold">Online</span>
          </p>

          <h2 className="h6 mt-4">Request categories</h2>
          {categories.length === 0 ? (
            <p className="text-secondary mb-0">No categories found.</p>
          ) : (
            <ul className="list-group">
              {categories.map((category) => (
                <li key={category.id} className="list-group-item">
                  {category.name}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {state === "error" && (
        <p className="mt-3 mb-0">
          Status: <span className="text-danger fw-semibold">Offline</span> — {error}
        </p>
      )}
    </div>
  );
}
