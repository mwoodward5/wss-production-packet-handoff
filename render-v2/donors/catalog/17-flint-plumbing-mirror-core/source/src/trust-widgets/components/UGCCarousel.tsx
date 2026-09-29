import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Customer-photo carousel with credit line — real UGC only. */
export function UGCCarousel() {
  const cfg = useTrust();
  const items = cfg.proof.ugc ?? [];
  const railRef = React.useRef<HTMLUListElement>(null);
  const scroll = (dir: 1 | -1) => railRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  return (
    <Gate id="UGCCarousel" when={items.length > 0}>
      <div>
        <ul ref={railRef} className="tw-rail" style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label={`${cfg.labels.customerNoun} photos`}>
          {items.map((m) => (
            <li key={m.id} style={{ width: 260 }}>
              <div style={{ aspectRatio: "4/5", borderRadius: "var(--tw-radius)", overflow: "hidden", border: "1px solid var(--tw-line)" }}>
                <img className="tw-img" src={m.src} alt={m.alt} loading="lazy" width={m.width} height={m.height} />
              </div>
              {m.credit ? <p className="tw-muted" style={{ fontSize: ".76rem", marginTop: ".4rem" }}>{m.credit}</p> : null}
            </li>
          ))}
        </ul>
        <div className="tw-row" style={{ justifyContent: "flex-end", marginTop: ".6rem" }}>
          <button type="button" className="tw-btn tw-btn--ghost" onClick={() => scroll(-1)} aria-label="Scroll photos left">←</button>
          <button type="button" className="tw-btn tw-btn--ghost" onClick={() => scroll(1)} aria-label="Scroll photos right">→</button>
        </div>
      </div>
    </Gate>
  );
}
