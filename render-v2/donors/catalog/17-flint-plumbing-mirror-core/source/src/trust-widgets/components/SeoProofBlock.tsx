import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { JsonLd, Stars } from "./primitives";
import { aggregateRatingOf, faqSchema, localBusinessSchema, organizationSchema, reviewSchema } from "../seo/jsonld";
import { voiceAnswers } from "../seo/voice";
import { OpenNowStatus } from "./OpenNowStatus";

/**
 * THE SCHEMA GATE.
 * This is the only widget allowed to emit business-level JSON-LD, and it renders
 * the same facts visibly first — so structured data can never outrun the DOM.
 */
export function SeoProofBlock({
  showVisible = true,
  emitReviews = true,
  emitFaq = true,
}: { showVisible?: boolean; emitReviews?: boolean; emitFaq?: boolean }) {
  const cfg = useTrust();
  const business = localBusinessSchema(cfg);
  const org = organizationSchema(cfg);
  const agg = aggregateRatingOf(cfg);
  const answers = voiceAnswers(cfg);
  const p = cfg.location.primary;

  const visibleFacts = Boolean(cfg.business?.name && cfg.business?.url);

  return (
    <Gate id="SeoProofBlock" when={visibleFacts}>
      <div>
        {showVisible ? (
          <div className="tw-card">
            <p className="tw-eyebrow">{cfg.business.category}</p>
            <h2 className="tw-h tw-h3" style={{ marginBottom: ".4rem" }}>{cfg.business.name}</h2>
            {cfg.business.description ? <p className="tw-muted" style={{ marginTop: 0, fontSize: ".9rem" }}>{cfg.business.description}</p> : null}
            {p ? (
              <address style={{ fontStyle: "normal", fontSize: ".9rem", lineHeight: 1.6 }}>
                {p.street}, {p.city}, {p.region} {p.postal}
                {cfg.contact.phone ? <><br /><a href={`tel:${cfg.contact.phone}`}>{cfg.contact.phoneDisplay ?? cfg.contact.phone}</a></> : null}
              </address>
            ) : null}
            <div className="tw-row" style={{ marginTop: ".6rem" }}>
              <OpenNowStatus />
              {agg ? (
                <span className="tw-row" style={{ gap: ".4rem" }}>
                  <Stars value={agg.ratingValue as number} />
                  <span className="tw-muted">{agg.ratingValue} · {agg.reviewCount} reviews</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <JsonLd data={business} />
        <JsonLd data={org} />
        {emitReviews && (cfg.proof.reviews ?? []).length ? <JsonLd data={reviewSchema(cfg)} /> : null}
        {emitFaq && answers.length ? <JsonLd data={faqSchema(cfg, ".tw-voice-answer", answers)} /> : null}
      </div>
    </Gate>
  );
}
