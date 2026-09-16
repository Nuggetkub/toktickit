import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, changePassword } from "../api.js";
import { Button, Card, ErrorAlert, Field } from "../components/index.js";
import { landingPath, useAuth } from "./AuthContext.js";

// ui-spec.md §4. Two modes: mandatory after a first sign-in, voluntary from the
// user menu.

const MIN = 12;
const MAX = 128;

type Rule = { label: string; met: (state: RuleInput) => boolean };

type RuleInput = {
  current: string;
  next: string;
  confirm: string;
  email: string;
};

/**
 * Exactly the five rules BR-11 states, plus the confirmation.
 *
 * They are listed here once and both rendered and evaluated from this list, so
 * the checklist cannot promise something the server will then refuse. Writing
 * the rules twice — once as text, once as a condition — is how a screen ends up
 * ticking "at least 12 characters" for an eleven-character password.
 */
export const PASSWORD_RULES: Rule[] = [
  { label: `At least ${MIN} characters`, met: ({ next }) => next.length >= MIN },
  { label: `No more than ${MAX} characters`, met: ({ next }) => next.length > 0 && next.length <= MAX },
  { label: "Not only spaces", met: ({ next }) => next.trim().length > 0 },
  { label: "Different from your current password", met: ({ next, current }) => next.length > 0 && next !== current },
  {
    label: "Different from your email address",
    met: ({ next, email }) => next.length > 0 && next.toLowerCase() !== email.toLowerCase(),
  },
  { label: "Matches the confirmation", met: ({ next, confirm }) => next.length > 0 && next === confirm },
];

export default function ChangePassword() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const mandatory = user.mustChangePassword;
  const state: RuleInput = { current, next, confirm, email: user.email };
  const allRulesMet = PASSWORD_RULES.every((rule) => rule.met(state));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const errors: Record<string, string> = {};
    if (!current) errors.currentPassword = "Enter your current password.";
    if (!allRulesMet) errors.newPassword = "Your new password does not meet every rule yet.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setFailure("");
    try {
      const updated = await changePassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      setUser(updated);
      // Nothing typed here is kept in memory once it has been used.
      setCurrent("");
      setNext("");
      setConfirm("");

      if (mandatory) navigate(landingPath(updated.role), { replace: true });
      else setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        // A wrong current password is a field error, never a sign-out: the
        // session is perfectly valid and the client treats 401 as "session
        // ended" (BR-47), so the server answers 400 here on purpose.
        setFieldErrors(error.fieldErrors);
        setCurrent("");
      } else {
        setFailure(error instanceof ApiError ? error.message : "The password could not be changed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={mandatory ? "zen-auth" : undefined}>
      <Card title="Choose a new password" as="h1">
        {mandatory && <p>You must choose a new password before continuing.</p>}
        {saved && (
          <p className="zen-status" role="status">
            Your password has been changed.
          </p>
        )}
        {failure && <ErrorAlert>{failure}</ErrorAlert>}

        <form onSubmit={submit} noValidate>
          <Field id="currentPassword" label="Current password" required error={fieldErrors.currentPassword}>
            {(control) => (
              <input
                {...control}
                type={shown ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            )}
          </Field>

          <Field
            id="newPassword"
            label="New password"
            required
            error={fieldErrors.newPassword}
            hint="Your new password must meet every rule listed below."
          >
            {(control) => (
              <input
                {...control}
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            )}
          </Field>

          <ul className="zen-checklist" aria-label="Password rules">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.met(state);
              return (
                <li key={rule.label} className={met ? "zen-checklist__item--met" : undefined}>
                  {/* The state is in words, not only in a colour or a tick. */}
                  <span aria-hidden="true">{met ? "✓" : "•"}</span> {rule.label}
                  <span className="zen-visually-hidden">{met ? " — met" : " — not met yet"}</span>
                </li>
              );
            })}
          </ul>

          <Field id="confirmPassword" label="Confirm new password" required error={fieldErrors.confirmPassword}>
            {(control) => (
              <input
                {...control}
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            )}
          </Field>

          <Button variant="tertiary" onClick={() => setShown((value) => !value)}>
            {shown ? "Hide passwords" : "Show passwords"}
          </Button>

          <div className="zen-shell__nav">
            <Button type="submit" busy={busy} busyLabel="Saving password…">
              Save new password
            </Button>

            {/* Mandatory mode offers no Cancel: there is nowhere to go back to
                until the password is changed (ui-spec.md §4). Log out is the one
                other action, and it stays in the shell rather than being
                repeated here — two identical buttons on one screen is a worse
                answer than one in the place it always sits. */}
            {!mandatory && (
              <Button variant="secondary" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
