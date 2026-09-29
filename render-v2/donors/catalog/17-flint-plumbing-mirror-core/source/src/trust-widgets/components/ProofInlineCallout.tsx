import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { aggregateRatingOf } from "../seo/jsonld";
import { Stars } from "./primitives";

/** Drop-in mid-copy reassurance block: rating + a guarantee + a stat. */
export function ProofInlineCallout() {
  const cfg = useTrust();
  const agg = aggregateRatingOf(cfg);
  const guarantee = (cfg.proof.guarantees ?? [])[0];
  const stat = (cfg.proof.stats ?? [])[0];
  const has = Boolean(agg || guarantee || stat);

  return (
    <Gate id="ProofInlineCallout" when={has}>
      <aside className="tw-card tw-row" style={{ gap: "1.4rem", justifyContent: "space-between", flexWrap: "wrap" }}>
        {agg ? (
          <span className="tw-row" style={{ gap: ".5rem" }}>
            <Stars value={agg.ratingValue as number} />
            <span><strong>{agg.ratingValue}</strong> <span className="tw-muted">· {agg.reviewCount} reviews</span></span>
          </span>
        ) : null}
        {stat ? <span><strong>{stat.prefix}{stat.value.toLocaleString()}{stat.suffix}</strong> <span className="tw-muted">{stat.label}</span></span> : null}
        {guarantee ? <span className="tw-muted">{guarantee.title} — {guarantee.detail}</span> : null}
      </aside>
    </Gate>
  );
}
