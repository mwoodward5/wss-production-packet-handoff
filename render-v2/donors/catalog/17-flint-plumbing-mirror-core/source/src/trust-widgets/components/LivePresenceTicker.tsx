import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** "12 people viewing this week's openings" — only from a verified analytics number. */
export function LivePresenceTicker({ label }: { label?: string }) {
  const cfg = useTrust();
  const n = cfg.live.viewersNow;
  return (
    <Gate id="LivePresenceTicker" when={typeof n === "number" && n > 0}>
      <p className="tw-chip" aria-live="polite" style={{ margin: 0 }}>
        <span className="tw-dot" aria-hidden="true" />
        {label ?? `${n} ${n === 1 ? "person" : "people"} viewing availability now`}
      </p>
    </Gate>
  );
}
