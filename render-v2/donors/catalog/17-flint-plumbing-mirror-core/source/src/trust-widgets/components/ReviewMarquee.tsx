import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { Stars } from "./primitives";
import { ReviewerFace } from "@/components/ReviewerFace";


/** Infinite, pause-on-hover review scroller. Falls back to a scrollable rail with reduced motion. */
export function ReviewMarquee({ speedSeconds = 46 }: { speedSeconds?: number }) {
  const cfg = useTrust();
  const reviews = cfg.proof.reviews ?? [];
  const reduced = useReducedMotion();
  const items = reduced ? reviews : [...reviews, ...reviews];

  return (
    <Gate id="ReviewMarquee" when={reviews.length > 1}>
      <div className="tw-marquee" style={{ ["--tw-speed" as string]: `${speedSeconds}s` }}>
        <ul
          className="tw-marquee__track"
          style={reduced ? { animation: "none", width: "100%", overflowX: "auto" } : undefined}
          aria-label={cfg.labels.reviewsTitle}
        >
          {items.map((r, i) => (
            <li key={`${r.id}-${i}`} className="tw-card" style={{ width: 320, flex: "0 0 auto" }}
                aria-hidden={!reduced && i >= reviews.length}>
              <div className="tw-row" style={{ justifyContent: "space-between" }}>
                <Stars value={r.rating} />
                {r.platform ? <span className="tw-muted" style={{ fontSize: ".75rem" }}>{r.platform}</span> : null}
              </div>
              <p style={{ margin: ".6rem 0", fontSize: ".92rem", lineHeight: 1.5 }}>“{r.body}”</p>
              <div className="tw-row" style={{ gap: ".7rem", alignItems: "center" }}>
                <ReviewerFace name={r.author} avatarUrl={r.avatarUrl} platform={r.platform} size={38} />
                <p className="tw-muted" style={{ margin: 0, fontSize: ".8rem" }}>
                  <strong style={{ color: "var(--tw-text)" }}>{r.author}</strong>
                  {r.location ? <><br />{r.location}</> : null}
                  {r.serviceTag ? <><br />{r.serviceTag}</> : null}
                </p>
              </div>

            </li>
          ))}
        </ul>
      </div>
    </Gate>
  );
}
