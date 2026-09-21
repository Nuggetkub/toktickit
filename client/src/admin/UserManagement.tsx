import { useEffect, useState } from "react";
import {
  ApiError,
  USER_NAME_MAX,
  USER_NAME_MIN,
  USER_ROLES,
  createAdminUser,
  fetchAdminUsers,
  setUserInitialPassword,
  updateAdminUser,
  type AdminUser,
  type AdminUserEdit,
  type Role,
} from "../api.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  RoleBadge,
  StatusMessage,
} from "../components/index.js";
import { INITIAL_PASSWORD_RULES, useAuth } from "../auth/index.js";

// Administrator User Management (ui-spec.md §9).
//
// One screen: the list on the left, a panel on the right for Create and Edit.
// The panel is deliberately one component in two modes rather than two screens —
// the fields are the same four, and the only real difference is that Edit cannot
// set a password inline and Create cannot reset one.

const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

// Typing is not a request (the same rule the two ticket lists follow).
const SEARCH_DEBOUNCE_MS = 300;

type PanelMode = { kind: "create" } | { kind: "edit"; user: AdminUser };

type Draft = {
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  initialPassword: string;
};

const EMPTY_DRAFT: Draft = {
  fullName: "",
  email: "",
  role: "REQUESTER",
  isActive: true,
  initialPassword: "",
};

function draftFor(mode: PanelMode): Draft {
  if (mode.kind === "create") return EMPTY_DRAFT;
  return {
    fullName: mode.user.fullName,
    email: mode.user.email,
    role: mode.user.role,
    isActive: mode.user.isActive,
    initialPassword: "",
  };
}

export default function UserManagement() {
  const { user: actor } = useAuth();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  const [mode, setMode] = useState<PanelMode | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [panelError, setPanelError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setState("loading");

    fetchAdminUsers({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(roleFilter ? { role: roleFilter } : {}),
    })
      .then((loaded) => {
        // A slow reply to an abandoned query must never overwrite a newer one.
        if (!active) return;
        setUsers(loaded);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });

    return () => {
      active = false;
    };
  }, [debouncedSearch, roleFilter, reloadToken]);

  function openCreate() {
    setMode({ kind: "create" });
    setDraft(EMPTY_DRAFT);
    clearPanelMessages();
  }

  function openEdit(target: AdminUser) {
    setMode({ kind: "edit", user: target });
    setDraft(draftFor({ kind: "edit", user: target }));
    clearPanelMessages();
  }

  function closePanel() {
    setMode(null);
    clearPanelMessages();
  }

  function clearPanelMessages() {
    setFieldErrors({});
    setPanelError("");
    setResetPassword("");
    setResetError("");
  }

  /**
   * One place that reads a refusal, so no control invents its own wording.
   *
   * A duplicate email belongs beneath the email field; the two safety refusals
   * and the last-Administrator rule are about the change as a whole and belong
   * in an alert the reader cannot miss.
   */
  function describeFailure(error: unknown): void {
    const apiError = error instanceof ApiError ? error : null;

    if (apiError?.code === "EMAIL_ALREADY_EXISTS") {
      setFieldErrors({ email: "Another account already uses that email address." });
      return;
    }
    if (apiError?.code === "LAST_ACTIVE_ADMINISTRATOR") {
      setPanelError("At least one active Administrator is required.");
      return;
    }
    if (apiError?.code === "CANNOT_DEACTIVATE_SELF" || apiError?.code === "CANNOT_CHANGE_OWN_ROLE") {
      setPanelError("You cannot deactivate your own account or change your own role.");
      return;
    }
    if (apiError?.fieldErrors && Object.keys(apiError.fieldErrors).length > 0) {
      setFieldErrors(apiError.fieldErrors);
      return;
    }
    setPanelError(apiError?.message ?? "The user could not be saved.");
  }

  async function save() {
    if (!mode) return;
    setFieldErrors({});
    setPanelError("");
    setNotice("");
    setSaving(true);

    try {
      if (mode.kind === "create") {
        const created = await createAdminUser({
          fullName: draft.fullName.trim(),
          email: draft.email.trim(),
          role: draft.role,
          isActive: draft.isActive,
          initialPassword: draft.initialPassword,
        });
        setNotice(`User saved. ${created.fullName} must choose a new password at their next sign-in.`);
      } else {
        // Only what actually changed: the server rejects unknown fields, and
        // sending an unchanged role would be a no-op the safety rules still
        // have to reason about.
        const edit: AdminUserEdit = {};
        if (draft.fullName.trim() !== mode.user.fullName) edit.fullName = draft.fullName.trim();
        if (draft.email.trim() !== mode.user.email) edit.email = draft.email.trim();
        if (draft.role !== mode.user.role) edit.role = draft.role;
        if (draft.isActive !== mode.user.isActive) edit.isActive = draft.isActive;

        if (Object.keys(edit).length === 0) {
          setPanelError("Nothing has changed yet.");
          setSaving(false);
          return;
        }

        const { unassignedTicketCount } = await updateAdminUser(mode.user.id, edit);
        // BR-25's consequence, reported rather than left for them to discover
        // in the queue (ui-spec.md §9).
        setNotice(
          unassignedTicketCount > 0
            ? `User saved. ${unassignedTicketCount} open ${unassignedTicketCount === 1 ? "ticket was" : "tickets were"} unassigned.`
            : "User saved",
        );
      }

      closePanel();
      setReloadToken((token) => token + 1);
    } catch (error) {
      // The panel stays open with what they typed (§9): a refusal must not cost
      // them the form.
      describeFailure(error);
    } finally {
      setSaving(false);
    }
  }

  async function applyInitialPassword() {
    if (!mode || mode.kind !== "edit") return;
    setResetError("");
    setNotice("");
    setResetting(true);

    try {
      await setUserInitialPassword(mode.user.id, resetPassword);
      setResetPassword("");
      setNotice(`${mode.user.fullName} must choose a new password the next time they sign in.`);
      setReloadToken((token) => token + 1);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setResetError(
        apiError?.fieldErrors?.initialPassword ?? apiError?.message ?? "The initial password could not be set.",
      );
    } finally {
      setResetting(false);
    }
  }

  const editingSelf = mode?.kind === "edit" && actor !== null && mode.user.id === actor.id;
  const passwordState = {
    current: "",
    next: mode?.kind === "create" ? draft.initialPassword : resetPassword,
    confirm: "",
    email: draft.email,
  };
  const passwordRulesMet = INITIAL_PASSWORD_RULES.every((rule) => rule.met(passwordState));

  return (
    <Card title="User Management" as="h1">
      {notice && <StatusMessage>{notice}</StatusMessage>}

      <div className="zen-toolbar" role="search">
        <Field id="user-search" label="Search by name or email">
          {(control) => (
            <input
              {...control}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Field>

        <Field id="user-role-filter" label="Role">
          {(control) => (
            <select {...control} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "" | Role)}>
              <option value="">All roles</option>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="zen-toolbar__actions">
          <Button onClick={openCreate}>Create user</Button>
        </div>
      </div>

      <div className="zen-users-layout">
        <div>
          {state === "loading" && <StatusMessage>Loading users…</StatusMessage>}

          {state === "failed" && (
            <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)}>
              The user list could not be loaded.
            </ErrorAlert>
          )}

          {state === "ready" && users.length === 0 && (
            <EmptyState title="No users match your search." description="Try a different term, or choose All roles." />
          )}

          {state === "ready" && users.length > 0 && (
            <div className="zen-table-wrap">
              <table className="zen-table">
                <caption className="zen-visually-hidden">All user accounts</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Name">{row.fullName}</td>
                      <td data-label="Email">{row.email}</td>
                      <td data-label="Role">
                        <RoleBadge role={row.role} />
                      </td>
                      <td data-label="Status">
                        {/* In words, never by colour alone (ui-spec.md §1). */}
                        <Badge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td data-label="Edit">
                        <Button variant="secondary" onClick={() => openEdit(row)}>
                          Edit {row.fullName}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {mode && (
          <section className="zen-users-panel" aria-label={mode.kind === "create" ? "Create user" : "Edit user"}>
            <h2 className="zen-card__title">{mode.kind === "create" ? "Create user" : `Edit ${mode.user.fullName}`}</h2>

            {panelError && <ErrorAlert>{panelError}</ErrorAlert>}

            <Field id="user-full-name" label="Full name" required error={fieldErrors.fullName}
              hint={`${USER_NAME_MIN} to ${USER_NAME_MAX} characters.`}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={draft.fullName}
                  onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
                />
              )}
            </Field>

            <Field id="user-email" label="Email address" required error={fieldErrors.email}>
              {(control) => (
                <input
                  {...control}
                  type="email"
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                />
              )}
            </Field>

            <Field id="user-role" label="Role" required error={fieldErrors.role}>
              {(control) => (
                <select
                  {...control}
                  value={draft.role}
                  disabled={editingSelf}
                  onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <div className="zen-checkbox">
              <input
                id="user-active"
                type="checkbox"
                checked={draft.isActive}
                disabled={editingSelf}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              <label htmlFor="user-active">Active account</label>
            </div>

            {/* BR-41 stated where the disabled controls are, rather than as a
                409 after the attempt. The server refuses it either way. */}
            {editingSelf && (
              <p className="zen-field__hint">You cannot deactivate your own account or change your own role.</p>
            )}

            {mode.kind === "create" && (
              <>
                <Field
                  id="user-initial-password"
                  label="Initial password"
                  required
                  error={fieldErrors.initialPassword}
                  hint="The user must choose a new password the next time they sign in."
                >
                  {(control) => (
                    <input
                      {...control}
                      type="password"
                      value={draft.initialPassword}
                      onChange={(event) => setDraft({ ...draft, initialPassword: event.target.value })}
                    />
                  )}
                </Field>
                <PasswordRules value={draft.initialPassword} email={draft.email} />
              </>
            )}

            <div className="zen-users-panel__actions">
              <Button
                busy={saving}
                busyLabel="Saving user…"
                disabled={mode.kind === "create" && !passwordRulesMet}
                onClick={() => void save()}
              >
                {mode.kind === "create" ? "Create user" : "Save user"}
              </Button>
              <Button variant="secondary" disabled={saving} onClick={closePanel}>
                Cancel
              </Button>
            </div>

            {mode.kind === "edit" && (
              // Its own section and its own button, so a password can never be
              // reset as a side effect of renaming somebody (§9).
              <div className="zen-users-panel__section">
                <h3 className="zen-card__title">Set new initial password</h3>
                <p className="zen-field__hint">
                  The user must choose a new password the next time they sign in. Their open sessions end immediately.
                </p>

                <Field id="user-reset-password" label="New initial password" required error={resetError}>
                  {(control) => (
                    <input
                      {...control}
                      type="password"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                    />
                  )}
                </Field>
                <PasswordRules value={resetPassword} email={mode.user.email} />

                <Button
                  variant="secondary"
                  busy={resetting}
                  busyLabel="Setting password…"
                  disabled={!passwordRulesMet}
                  onClick={() => void applyInitialPassword()}
                >
                  Set new initial password
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}

/**
 * BR-11's rules, rendered from the same list that evaluates them.
 *
 * `INITIAL_PASSWORD_RULES` is the subset that applies when an Administrator sets
 * somebody else's password: there is no current password to differ from, and §9
 * gives this field no confirmation. Showing those two anyway would tick them for
 * every password ever typed.
 */
function PasswordRules({ value, email }: { value: string; email: string }) {
  const state = { current: "", next: value, confirm: "", email };
  return (
    <ul className="zen-password-rules">
      {INITIAL_PASSWORD_RULES.map((rule) => {
        const met = rule.met(state);
        return (
          <li key={rule.label} data-met={met}>
            {met ? "✓" : "•"} {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
