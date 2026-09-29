import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Current wait / next-available badge. Renders only from verified availability data. */
export function WaitTimeBadge() {
  const cfg = useTrust();
  const { waitTimeMinutes, nextAvailable } = cfg.availability;
  const has = typeof waitTimeMinutes === "number" || Boolean(nextAvailable);
  return (
    <Gate id="WaitTimeBadge" when={has}>
      <p className="tw-chip" style={{ margin: 0, color: "var(--tw-text)" }}>
        {typeof waitTimeMinutes === "number" ? <span>≈{waitTimeMinutes} min current wait</span> : null}
        {nextAvailable ? <span className="tw-muted">Next opening: {nextAvailable}</span> : null}
      </p>
    </Gate>
  );
}
