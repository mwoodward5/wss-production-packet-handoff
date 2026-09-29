import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import type { BeforeAfterPair } from "../trust.config";

function Pair({ pair }: { pair: BeforeAfterPair }) {
  const [pos, setPos] = React.useState(50);
  return (
    <figure style={{ margin: 0 }}>
      <div className="tw-ba">
        <img className="tw-img tw-ba__after" src={pair.afterSrc} alt={`After: ${pair.alt}`} loading="lazy" />
        <div className="tw-ba__before" style={{ width: `${pos}%` }}>
          <img className="tw-img" src={pair.beforeSrc} alt={`Before: ${pair.alt}`} loading="lazy"
               style={{ width: "100vw", maxWidth: "none", height: "100%" }} />
        </div>
        <div className="tw-ba__handle" style={{ left: `${pos}%` }} aria-hidden="true">
          <span className="tw-ba__knob">⇔</span>
        </div>
        <input
          className="tw-ba__range"
          type="range" min={0} max={100} value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={`Reveal before and after for ${pair.alt}`}
        />
      </div>
      <figcaption className="tw-row" style={{ justifyContent: "space-between", marginTop: ".5rem", fontSize: ".82rem" }}>
        <span>{pair.label ?? pair.alt}</span>
        {pair.durationLabel ? <span className="tw-muted">{pair.durationLabel}</span> : null}
      </figcaption>
    </figure>
  );
}

/** Drag/keyboard before-after comparisons — the single strongest visual proof for transform trades. */
export function BeforeAfterSlider({ limit }: { limit?: number }) {
  const cfg = useTrust();
  const pairs = (cfg.proof.beforeAfter ?? []).slice(0, limit);
  return (
    <Gate id="BeforeAfterSlider" when={pairs.length > 0}>
      <div className="tw-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        {pairs.map((p) => <Pair key={p.id} pair={p} />)}
      </div>
    </Gate>
  );
}
