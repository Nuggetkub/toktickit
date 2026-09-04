import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchRequesters, type Requester } from "../api.js";
import { Button, Card, EmptyState, ErrorAlert, Field, StatusMessage } from "../components/index.js";
import { useRequester } from "./RequesterContext.js";

type LoadState = "loading" | "ready" | "failed";

/**
 * The Development Requester selection screen (ui-spec.md §5).
 *
 * It says what it is out loud. Lab 2 has no authentication, and a screen that
 * looks like a login while providing none is worse than one that admits it.
 */
export default function RequesterSelector() {
  const [requesters, setRequesters] = useState<Requester[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [selectedId, setSelectedId] = useState("");
  const { select } = useRequester();
  const navigate = useNavigate();
  const location = useLocation();

  // Where the visitor was trying to go before the guard sent them here.
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/tickets";

  async function load() {
    setState("loading");
    try {
      setRequesters(await fetchRequesters());
      setState("ready");
    } catch {
      setState("failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function onContinue() {
    const chosen = requesters.find((candidate) => String(candidate.id) === selectedId);
    if (!chosen) return;
    select(chosen);
    navigate(returnTo, { replace: true });
  }

  return (
    <Card title="Development Requester Selection" as="h1">
      <p>
        Select a Development Requester to test requester-specific ticket behaviour.
        <strong> This is not a login screen and provides no security.</strong>
      </p>

      {state === "loading" && <StatusMessage>Loading Development Requesters…</StatusMessage>}

      {state === "failed" && (
        <ErrorAlert onRetry={() => void load()}>
          Development Requesters could not be loaded. Please try again.
        </ErrorAlert>
      )}

      {state === "ready" && requesters.length === 0 && (
        <EmptyState
          title="No active Development Requesters are available."
          description="Seed the database with npm run prisma:seed, then reload this page."
        />
      )}

      {state === "ready" && requesters.length > 0 && (
        <>
          <Field id="development-requester" label="Development Requester" required>
            {(control) => (
              <select
                {...control}
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">Choose a Development Requester</option>
                {requesters.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.fullName} — {candidate.email}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Button onClick={onContinue} disabled={selectedId === ""}>
            Continue
          </Button>
        </>
      )}
    </Card>
  );
}
