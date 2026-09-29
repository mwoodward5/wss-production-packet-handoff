import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useOpenNow } from "../hooks/useOpenNow";

/** Live "Open now · Closes 6:00 PM" pill. Client-only so SSR never lies. */
export function OpenNowStatus() {
  const cfg = useTrust();
  const state = useOpenNow(cfg);
  return (
    <Gate id="OpenNowStatus" when={state.known}>
      <p className="tw-chip" style={{ margin: 0, color: "var(--tw-text)" }} aria-live="polite">
        <span className={state.open ? "tw-dot" : "tw-dot tw-dot--off"} aria-hidden="true" />
        <strong>{state.open ? "Open now" : "Closed"}</strong>
        {state.detail ? <span className="tw-muted">· {state.detail}</span> : null}
      </p>
    </Gate>
  );
}
