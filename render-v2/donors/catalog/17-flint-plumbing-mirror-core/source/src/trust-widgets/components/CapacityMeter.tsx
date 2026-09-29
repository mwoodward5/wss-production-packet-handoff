import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Honest scarcity: how full the book is, from a real number. No fake countdowns. */
export function CapacityMeter({ periodLabel = "this month" }: { periodLabel?: string }) {
  const cfg = useTrust();
  const ratio = cfg.availability.bookedRatio;
  const slots = cfg.availability.slotsLeft;
  const has = typeof ratio === "number" || typeof slots === "number";
  const pct = typeof ratio === "number" ? Math.max(0, Math.min(100, Math.round(ratio * 100))) : undefined;

  return (
    <Gate id="CapacityMeter" when={has}>
      <div className="tw-card">
        <div className="tw-row" style={{ justifyContent: "space-between" }}>
          <span className="tw-eyebrow" style={{ margin: 0 }}>Availability {periodLabel}</span>
          {typeof slots === "number" ? <strong>{slots} left</strong> : null}
        </div>
        {typeof pct === "number" ? (
          <>
            <div className="tw-meter" style={{ marginTop: ".7rem" }} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                 aria-label={`Schedule ${pct}% booked ${periodLabel}`}>
              <div className="tw-meter__fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="tw-muted" style={{ margin: ".55rem 0 0", fontSize: ".82rem" }}>{pct}% booked {periodLabel}</p>
          </>
        ) : null}
        {cfg.availability.nextAvailable ? (
          <p style={{ margin: ".5rem 0 0", fontSize: ".88rem" }}>Next opening: <strong>{cfg.availability.nextAvailable}</strong></p>
        ) : null}
      </div>
    </Gate>
  );
}
