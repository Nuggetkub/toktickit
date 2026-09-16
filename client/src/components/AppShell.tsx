import type { ReactNode } from "react";
import type { Role } from "../api.js";
import { Button } from "./Button.js";
import { RoleBadge } from "./RoleBadge.js";

export type NavItem = {
  key: string;
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
};

type AppShellProps = {
  navItems?: NavItem[];
  /** `key` of the active nav item. */
  activeKey?: string;
  /** The signed-in user, shown on the right with their role (ui-spec.md §2). */
  userName?: string;
  userRole?: Role;
  onChangePassword?: () => void;
  onLogout?: () => void;
  children: ReactNode;
};

/**
 * The frame every screen sits in: TokTickIT identity, the role's navigation, and
 * the signed-in user with a role badge, Change password and Log out
 * (ui-spec.md §2).
 *
 * It stays presentational and prop-driven — it reads no context and makes no
 * authorization decision. Which items reach `navItems` is the router's business
 * (`App.tsx`), and what a role may actually *do* is the server's (issue #47).
 *
 * Every prop is optional so the shell still renders as a bare frame, which is
 * what the Lab 1 system-check screen uses it for.
 */
export function AppShell({
  navItems = [],
  activeKey,
  userName,
  userRole,
  onChangePassword,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <div className="zen-shell">
      <header className="zen-shell__header">
        <div className="zen-shell__bar">
          <p className="zen-shell__brand">TokTickIT</p>

          {navItems.length > 0 && (
            <nav className="zen-shell__nav" aria-label="Primary">
              {navItems.map((item) => {
                const isActive = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`zen-nav__item${isActive ? " zen-nav__item--active" : ""}`}
                    // Both colour and an underline mark the active route, and
                    // aria-current carries it to assistive technology.
                    aria-current={isActive ? "page" : undefined}
                    disabled={item.disabled}
                    onClick={item.onSelect}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}

          {userName && (
            <div className="zen-shell__context">
              <span className="zen-shell__user">{userName}</span>
              {userRole && <RoleBadge role={userRole} />}
              {onChangePassword && (
                <Button variant="tertiary" onClick={onChangePassword}>
                  Change password
                </Button>
              )}
              {onLogout && (
                <Button variant="secondary" onClick={onLogout}>
                  Log out
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="zen-shell__main">{children}</main>
    </div>
  );
}
