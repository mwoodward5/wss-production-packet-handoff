import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Risk-reversal panel — warranties, satisfaction promises, price locks. */
export function GuaranteePanel({ columns = 3, items }: { columns?: number; items?: { id: string; title: string; detail: string; icon?: string }[] }) {
  const cfg = useTrust();
  const gs = items ?? cfg.proof.guarantees ?? [];
  return (
    <Gate id="GuaranteePanel" when={gs.length > 0}>
      <ul className="tw-grid" style={{ gridTemplateColumns: `repeat(auto-fit,minmax(220px,1fr))`, listStyle: "none", margin: 0, padding: 0, maxWidth: columns * 340 }}>
        {gs.map((g) => (
          <li key={g.id} className="tw-card">
            {g.icon ? <span aria-hidden="true" style={{ fontSize: "1.4rem" }}>{g.icon}</span> : null}
            <h3 className="tw-h tw-h3" style={{ fontSize: "1.02rem" }}>{g.title}</h3>
            <p className="tw-muted" style={{ margin: 0, fontSize: ".88rem", lineHeight: 1.5 }}>{g.detail}</p>
          </li>
        ))}
      </ul>
    </Gate>
  );
}
