import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** "We answer in X minutes" promise — measured value only. */
export function ResponseTimePromise() {
  const cfg = useTrust();
  const m = cfg.availability.responseTimeMinutes;
  return (
    <Gate id="ResponseTimePromise" when={typeof m === "number" && m > 0}>
      <div className="tw-card tw-row" style={{ gap: "1rem" }}>
        <span style={{ fontFamily: "var(--tw-font-heading)", fontSize: "2rem", lineHeight: 1 }}>{m}<span style={{ fontSize: "1rem" }}>min</span></span>
        <span className="tw-muted" style={{ fontSize: ".9rem" }}>
          Average response time to new {cfg.labels.workNoun} requests, measured across the last 90 days.
        </span>
      </div>
    </Gate>
  );
}
