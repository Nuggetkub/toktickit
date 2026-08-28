import type { ReactNode } from "react";
import { Button } from "./Button.js";

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
  /** Selected Development Requester, shown once a testing context exists. */
  requesterName?: string;
  onChangeRequester?: () => void;
  children: ReactNode;
};

/**
 * The frame every Lab 2 screen sits in: TokTickIT identity, primary navigation,
 * the selected Development Requester, and Change Requester (ui-spec.md §4).
 *
 * It is presentational and prop-driven. Routing and the requester context land
 * in Issue #20, and this component is deliberately ready for both rather than
 * reaching for state it does not own yet.
 */
export function AppShell({
  navItems = [],
  activeKey,
  requesterName,
  onChangeRequester,
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

          {requesterName && (
            <div className="zen-shell__context">
              <span>Development Requester</span>
              <span className="zen-shell__requester">{requesterName}</span>
              {onChangeRequester && (
                <Button variant="secondary" onClick={onChangeRequester}>
                  Change Requester
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
