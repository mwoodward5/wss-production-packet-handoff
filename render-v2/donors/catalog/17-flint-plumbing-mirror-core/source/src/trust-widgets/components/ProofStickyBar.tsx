import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { aggregateRatingOf } from "../seo/jsonld";
import { Stars } from "./primitives";
import { telHref } from "../seo/geo";
import { FacePile } from "@/components/ReviewerFace";

/** Slim top bar pairing the strongest proof point with the primary action. */
export function ProofStickyBar({ position = "top" }: { position?: "top" | "bottom" }) {
  const cfg = useTrust();
  const agg = aggregateRatingOf(cfg);
  const license = (cfg.proof.credentials ?? []).find((c) => (c.kind ?? "license") === "license");
  const cta = cfg.contact.bookingUrl ?? cfg.contact.quoteUrl;
  const tel = telHref(cfg.contact.phone);
  const has = Boolean(agg || license) && Boolean(cta || tel);
  const people = (cfg.proof.reviews ?? [])
    .filter((review) => Boolean(review.avatarUrl))
    .map((review) => ({ author: review.author, avatarUrl: review.avatarUrl, platform: review.platform }));

  return (
    <Gate id="ProofStickyBar" when={has}>
      <div
        className="tw-row"
        style={{
          position: "sticky", [position]: 0, zIndex: 40, justifyContent: "space-between",
          background: "var(--tw-surface)", borderBottom: position === "top" ? "1px solid var(--tw-line)" : undefined,
          borderTop: position === "bottom" ? "1px solid var(--tw-line)" : undefined,
          padding: ".55rem clamp(12px,4vw,24px)", fontSize: ".85rem",
        } as React.CSSProperties}
      >
        <span className="tw-row" style={{ gap: ".6rem" }}>
          <FacePile people={people} max={3} />
          {agg ? (<><Stars value={agg.ratingValue as number} /><strong>{agg.ratingValue}</strong><span className="tw-muted">({agg.reviewCount} reviews)</span></>) : null}
          {license ? <span className="tw-muted">{license.name}{license.number ? ` #${license.number}` : ""}</span> : null}
        </span>
        <span className="tw-row">
          {tel ? <a className="tw-btn tw-btn--ghost" href={tel}>{cfg.contact.phoneDisplay ?? "Call"}</a> : null}
          {cta ? <a className="tw-btn tw-btn--primary" href={cta}>{cfg.labels.bookCta}</a> : null}
        </span>
      </div>
    </Gate>
  );
}
