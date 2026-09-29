import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { aggregateRatingOf } from "../seo/jsonld";
import { Stars } from "./primitives";
import { FacePile } from "@/components/ReviewerFace";

/** One-line aggregate rating summary. Renders null unless a real rating exists. */
export function StarSummaryBar({ compact = false }: { compact?: boolean }) {
  const cfg = useTrust();
  const agg = aggregateRatingOf(cfg);
  const people = (cfg.proof.reviews ?? [])
    .filter((review) => Boolean(review.avatarUrl))
    .map((review) => ({
      author: review.author,
      avatarUrl: review.avatarUrl,
      platform: review.platform,
    }));
  if (!agg) return null;
  return (
    <Gate id="StarSummaryBar" when={Boolean(agg)}>
      <div className="tw-row" style={{ justifyContent: compact ? "flex-start" : "center", flexWrap: "wrap" }}>
        <FacePile people={people} max={5} />
        <Stars value={agg!.ratingValue as number} label={`${agg!.ratingValue} out of 5`} />
        <strong>{agg!.ratingValue}</strong>
        <span className="tw-muted">
          from {agg!.reviewCount} {cfg.labels.customerNoun} reviews
        </span>
      </div>
    </Gate>
  );
}
