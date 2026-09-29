import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Insurance / bond coverage proof — the #1 objection for trades. */
export function InsuranceProofPanel() {
  const cfg = useTrust();
  const items = (cfg.proof.credentials ?? []).filter((c) => c.kind === "insurance" || c.kind === "bond");
  return (
    <Gate id="InsuranceProofPanel" when={items.length > 0}>
      <div className="tw-card">
        <p className="tw-eyebrow">Coverage</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: ".7rem" }}>
          {items.map((c) => (
            <li key={c.id} className="tw-row" style={{ justifyContent: "space-between", gap: "1rem" }}>
              <span>
                <strong>{c.name}</strong>
                <span className="tw-muted"> · {c.issuer}{c.number ? ` · #${c.number}` : ""}</span>
              </span>
              {c.expiresAt ? <span className="tw-muted" style={{ fontSize: ".8rem" }}>Valid through {c.expiresAt}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </Gate>
  );
}
