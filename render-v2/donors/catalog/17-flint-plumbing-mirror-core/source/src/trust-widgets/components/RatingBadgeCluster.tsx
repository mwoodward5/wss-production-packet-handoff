import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { Stars } from "./primitives";

/** Per-platform rating badges (Google / Yelp / Facebook / ...). Verified numbers only. */
export function RatingBadgeCluster() {
  const cfg = useTrust();
  const ratings = (cfg.proof.ratings ?? []).filter((r) => r.ratingValue > 0 && r.reviewCount > 0);
  return (
    <Gate id="RatingBadgeCluster" when={ratings.length > 0}>
      <ul className="tw-row" style={{ listStyle: "none", margin: 0, padding: 0, gap: ".7rem" }}>
        {ratings.map((r) => {
          const inner = (
            <>
              <span style={{ fontWeight: 600 }}>{r.platform}</span>
              <Stars value={r.ratingValue} />
              <span>{r.ratingValue.toFixed(1)}</span>
              <span className="tw-muted">({r.reviewCount})</span>
            </>
          );
          return (
            <li key={r.platform}>
              {r.profileUrl ? (
                <a className="tw-chip" href={r.profileUrl} target="_blank" rel="noopener noreferrer nofollow"
                   aria-label={`${r.platform}: ${r.ratingValue} stars from ${r.reviewCount} reviews (opens in a new tab)`}>
                  {inner}
                </a>
              ) : (
                <span className="tw-chip">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Gate>
  );
}
