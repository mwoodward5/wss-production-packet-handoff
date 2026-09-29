import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useReducedMotion } from "../hooks/useReducedMotion";

/**
 * Rotating "recent real activity" toasts.
 * Only renders entries supplied in config.live.recentActions — never synthesised.
 */
export function RecentActivityToasts({ intervalMs = 9000, dwellMs = 5200 }: { intervalMs?: number; dwellMs?: number }) {
  const cfg = useTrust();
  const actions = cfg.live.recentActions ?? [];
  const enabled = cfg.options?.activityToastsEnabled !== false;
  const reduced = useReducedMotion();
  const [idx, setIdx] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!actions.length || dismissed || reduced || !enabled) return;
    let timer: number;
    const cycle = () => {
      setVisible(true);
      timer = window.setTimeout(() => {
        setVisible(false);
        setIdx((n) => (n + 1) % actions.length);
      }, dwellMs);
    };
    const first = window.setTimeout(cycle, 3000);
    const loop = window.setInterval(cycle, intervalMs);
    return () => { window.clearTimeout(first); window.clearTimeout(timer); window.clearInterval(loop); };
  }, [actions.length, dismissed, reduced, enabled, intervalMs, dwellMs]);

  const a = actions[idx];
  return (
    <Gate id="RecentActivityToasts" when={Boolean(a) && enabled && !dismissed && visible}>
      <div className="tw-toasts" aria-live="polite">
        <div className="tw-toast tw-row" style={{ justifyContent: "space-between" }}>
          <span>
            <span className="tw-dot" style={{ display: "inline-block", marginRight: 8 }} aria-hidden="true" />
            {a?.text}{a?.city ? ` · ${a.city}` : ""}
            <span className="tw-muted"> · {a?.minutesAgo}m ago</span>
          </span>
          <button type="button" className="tw-btn tw-btn--ghost" style={{ minHeight: 32, padding: ".2rem .5rem" }}
            onClick={() => setDismissed(true)} aria-label="Dismiss activity notifications">×</button>
        </div>
      </div>
    </Gate>
  );
}
