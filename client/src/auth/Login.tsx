import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import { Button, Card, ErrorAlert, Field } from "../components/index.js";
import { landingPath, useAuth } from "./AuthContext.js";

// ui-spec.md §3. No "Forgot your password?" and no sign-up link: neither exists
// in Lab 3, and the labsheet mockup that shows them is one of the six recorded
// deviations (ui-spec.md §12).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { signIn, sessionEnded } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = "Enter your email address";
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address";
    if (!password) errors.password = "Enter your password";
    return errors;
  }

  /**
   * Turns a sign-in failure into the wording ui-spec.md §3 fixes.
   *
   * The three refusals are deliberately *not* collapsed into one message here,
   * because the server has already decided what may be disclosed: it returns the
   * same `401` for an unknown email, a wrong password and an account with no
   * password (BR-06), and only names deactivation once the password is correct
   * (BR-07). The client's job is to render that decision, not to re-make it.
   */
  function describe(error: unknown): string {
    if (!(error instanceof ApiError)) return "Unable to connect to TokTickIT. Please try again.";

    if (error.code === "ACCOUNT_INACTIVE") {
      return "This account has been deactivated. Contact your administrator.";
    }
    if (error.code === "LOGIN_THROTTLED") {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
    if (error.code === "INVALID_CREDENTIALS") return "Email or password is incorrect.";
    if (error.status === undefined) return "Unable to connect to TokTickIT. Please try again.";
    return error.message;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      document.getElementById(errors.email ? "email" : "password")?.focus();
      return;
    }

    setBusy(true);
    setFailure("");
    try {
      const user = await signIn(email.trim(), password);
      // A pending first-login change outranks the landing page (BR-02): the
      // guard would bounce them here anyway, and going straight there avoids a
      // flash of a screen they are not allowed to use yet.
      navigate(user.mustChangePassword ? "/change-password" : landingPath(user.role), { replace: true });
    } catch (error) {
      setFailure(describe(error));
      // The email is kept and only the password is cleared: retyping an address
      // to fix a typo in a password is a small cruelty (ui-spec.md §3).
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="zen-auth">
      <Card title="Sign in to your account" as="h1">
        {sessionEnded && (
          <p className="zen-status" role="status">
            Your session has ended. Please sign in again.
          </p>
        )}

        {failure && <ErrorAlert>{failure}</ErrorAlert>}

        <form onSubmit={submit} noValidate>
          <Field id="email" label="Email" required error={fieldErrors.email}>
            {(control) => (
              <input
                {...control}
                type="email"
                autoComplete="username"
                readOnly={busy}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldErrors(({ email: _cleared, ...rest }) => rest);
                }}
              />
            )}
          </Field>

          <Field id="password" label="Password" required error={fieldErrors.password}>
            {(control) => (
              <div className="zen-password">
                <input
                  {...control}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  readOnly={busy}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors(({ password: _cleared, ...rest }) => rest);
                  }}
                />
                {/* A labelled control, not an icon alone: "Show password" is what
                    a screen reader announces and what a test can find. */}
                <Button variant="tertiary" onClick={() => setShowPassword((shown) => !shown)}>
                  {showPassword ? "Hide password" : "Show password"}
                </Button>
              </div>
            )}
          </Field>

          <Button type="submit" busy={busy} busyLabel="Signing in…">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
