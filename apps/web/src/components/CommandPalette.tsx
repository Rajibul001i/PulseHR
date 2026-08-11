/**
 * Command palette (⌘K / Ctrl+K).
 *
 * docs/12-ui-modernisation.md §2.2 / Phase 3 item 13: "For an HR admin who does the same
 * six things all day, a palette beats navigation."
 *
 * Scope note: the doc's example is "Type 'Farhana' → jump to her profile" — there is no
 * employee-profile page in the app to jump to (F2's self-service pages aren't built), so
 * that's left out rather than faked. What's here: every page the sidebar can reach
 * (locked items included, same as the sidebar — docs/12-ui-modernisation.md §2.1, hidden
 * ≠ correct), plus theme toggle and sign out. "Run payroll" / "Run scoring batch" navigate
 * to the page that runs them rather than duplicating that polling logic here.
 *
 * Opens/closes instantly, no exit/entrance animation — this is used dozens of times a day
 * by design, and the frequency rule (used throughout this session's motion work) is
 * unambiguous: keyboard-initiated, high-frequency UI gets no animation, ever.
 */
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import type { PlanFeatureKey, Role, SubscriptionDto } from '../api';
import './command-palette.css';

interface NavItem {
  to: string;
  label: string;
  feature?: PlanFeatureKey;
  roles?: Role[];
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: NavItem[];
  role: Role;
  subscription: SubscriptionDto | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  nav,
  role,
  subscription,
  theme,
  onToggleTheme,
  onSignOut,
}: CommandPaletteProps) {
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === 'Escape' && open) {
        // cmdk's <Command> has no notion of "open" -- it doesn't close itself on Escape.
        onOpenChange(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const items = useMemo(
    () =>
      nav
        .filter((i) => !i.roles || i.roles.includes(role))
        .map((i) => ({
          ...i,
          locked: Boolean(i.feature && subscription && !subscription.entitlements.includes(i.feature)),
        })),
    [nav, role, subscription],
  );

  function go(to: string) {
    navigate(to);
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => onOpenChange(false)}>
      <Command
        className="cmdk-panel"
        label="Command palette"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <Command.Input autoFocus placeholder="Jump to a page, run a job, or search…" />
        <Command.List>
          <Command.Empty>No matches.</Command.Empty>

          <Command.Group heading="Go to">
            {items.map((item) => (
              <Command.Item key={item.to} value={item.label} onSelect={() => go(item.locked ? '/plan' : item.to)}>
                <span>{item.label}</span>
                {item.locked && <span className="cmdk-lock" aria-label="requires an upgrade">🔒 Upgrade</span>}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Actions">
            {role === 'HR_ADMIN' && (
              <Command.Item value="Run payroll" onSelect={() => go('/payslips')}>
                Run payroll…
              </Command.Item>
            )}
            {role === 'HR_ADMIN' && (
              <Command.Item value="Run scoring batch attrition" onSelect={() => go('/')}>
                Run attrition scoring batch…
              </Command.Item>
            )}
            <Command.Item
              value={`Toggle theme switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onSelect={() => { onToggleTheme(); onOpenChange(false); }}
            >
              Switch to {theme === 'dark' ? 'light' : 'dark'} mode
            </Command.Item>
            <Command.Item value="Sign out log out" onSelect={() => { onSignOut(); onOpenChange(false); }}>
              Sign out
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
