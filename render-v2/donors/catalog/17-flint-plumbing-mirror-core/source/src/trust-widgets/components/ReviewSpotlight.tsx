import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { Stars, useInterval } from "./primitives";
import { ReviewerFace } from "@/components/ReviewerFace";


/** Single large rotating review with manual controls. */
export function ReviewSpotlight({ intervalMs = 7000 }: { intervalMs?: number }) {
  const cfg = useTrust();
  const reviews = cfg.proof.reviews ?? [];
  const reduced = useReducedMotion();
  const [i, setI] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  useInterval(() => setI((n) => (n + 1) % reviews.length),
    reduced || paused || reviews.length < 2 ? null : intervalMs);

  const r = reviews[i];
  return (
    <Gate id="ReviewSpotlight" when={reviews.length > 0 && !!r}>
      <figure
        className="tw-card"
        style={{ margin: 0, textAlign: "center", padding: "1.8rem" }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div aria-live="polite">
          <div style={{ display: "grid", placeItems: "center", marginBottom: ".9rem" }}>
            <ReviewerFace name={r?.author ?? ""} avatarUrl={r?.avatarUrl} platform={r?.platform} size={72} />
          </div>
          <Stars value={r?.rating ?? 0} />
          <blockquote style={{ margin: "1rem auto", maxWidth: "58ch", fontFamily: "var(--tw-font-heading)", fontSize: "clamp(1.1rem,2.2vw,1.5rem)", lineHeight: 1.45 }}>
            “{r?.body}”
          </blockquote>
          <figcaption className="tw-muted" style={{ fontSize: ".85rem" }}>
            {r?.author}{r?.platform ? ` · ${r.platform}` : ""}{r?.date ? ` · ${r.date}` : ""}
          </figcaption>
        </div>

        {reviews.length > 1 ? (
          <div className="tw-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
            <button type="button" className="tw-btn tw-btn--ghost" onClick={() => setI((n) => (n - 1 + reviews.length) % reviews.length)} aria-label="Previous review">←</button>
            <span className="tw-muted" style={{ fontSize: ".8rem" }}>{i + 1} / {reviews.length}</span>
            <button type="button" className="tw-btn tw-btn--ghost" onClick={() => setI((n) => (n + 1) % reviews.length)} aria-label="Next review">→</button>
          </div>
        ) : null}
      </figure>
    </Gate>
  );
}
