/**
 * Brand mark. Colours are fixed (not palette-dependent) -- a brand mark stays constant
 * across theme choices the same way a real logo does; only the surrounding chrome retheme.
 *
 * Ascending bars read as a rising trend ("pulse" of the org); the pin-and-line reads as a
 * heartbeat/vital-signs monitor -- both point at "predictive people analytics" without
 * spelling it out.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0d3f38" />
      <rect x="6" y="18" width="3" height="8" rx="1.5" fill="#7fe0c8" />
      <rect x="11" y="12.5" width="3" height="13.5" rx="1.5" fill="#7fe0c8" />
      <rect x="16" y="9" width="3" height="17" rx="1.5" fill="#7fe0c8" opacity="0.6" />
      <circle cx="24.5" cy="9" r="3" fill="#ff8a65" />
      <rect x="23" y="12.5" width="3" height="13.5" rx="1.5" fill="#ff8a65" />
    </svg>
  );
}

export function Logo({
  tagline,
  markSize = 28,
  compact = false,
}: {
  tagline?: string;
  markSize?: number;
  /** Sidebar padding assumes it's the first thing inside a padded rail. A centred login/
   *  careers card already provides its own spacing, so `compact` drops the built-in offset. */
  compact?: boolean;
}) {
  return (
    <div className="logo-lockup">
      <div className={`logo-row${compact ? ' compact' : ''}`}>
        <LogoMark size={markSize} />
        <span className="logo-word">
          Pulse<span className="logo-word-accent">HR</span>
        </span>
      </div>
      {tagline && <div className={`brand-sub${compact ? ' compact' : ''}`}>{tagline}</div>}
    </div>
  );
}
