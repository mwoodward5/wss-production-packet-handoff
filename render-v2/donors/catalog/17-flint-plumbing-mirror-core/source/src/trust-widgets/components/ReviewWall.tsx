import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { Stars } from "./primitives";
import { ReviewerFace } from "@/components/ReviewerFace";


/** Filterable masonry wall of every review. */
export function ReviewWall({ initialCount = 6 }: { initialCount?: number }) {
  const cfg = useTrust();
  const reviews = cfg.proof.reviews ?? [];
  const platforms = Array.from(new Set(reviews.map((r) => r.platform).filter(Boolean))) as string[];
  const [platform, setPlatform] = React.useState<string>("All");
  const [shown, setShown] = React.useState(initialCount);

  const filtered = platform === "All" ? reviews : reviews.filter((r) => r.platform === platform);

  return (
    <Gate id="ReviewWall" when={reviews.length > 0}>
      <div>
        {platforms.length > 1 ? (
          <div className="tw-row" role="group" aria-label="Filter reviews by platform" style={{ marginBottom: "1rem" }}>
            {["All", ...platforms].map((p) => (
              <button key={p} type="button" className="tw-btn" aria-pressed={platform === p}
                style={platform === p ? { borderColor: "var(--tw-accent)", color: "var(--tw-text)" } : undefined}
                onClick={() => { setPlatform(p); setShown(initialCount); }}>
                {p}
              </button>
            ))}
          </div>
        ) : null}

        <div className="tw-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {filtered.slice(0, shown).map((r) => (
            <article key={r.id} className="tw-card">
              <div className="tw-row" style={{ gap: ".7rem", alignItems: "center" }}>
                <ReviewerFace name={r.author} avatarUrl={r.avatarUrl} platform={r.platform} size={42} />
                <span>
                  <strong style={{ display: "block", fontSize: ".9rem" }}>{r.author}</strong>
                  <Stars value={r.rating} />
                </span>
              </div>
              <p style={{ fontSize: ".92rem", lineHeight: 1.55 }}>“{r.body}”</p>
              <p className="tw-muted" style={{ margin: 0, fontSize: ".8rem" }}>
                {r.date ? `${r.date} · ` : ""}{r.platform ?? ""}{r.serviceTag ? ` · ${r.serviceTag}` : ""}
              </p>

              {r.sourceUrl ? (
                <a className="tw-muted" style={{ fontSize: ".78rem" }} href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                  Read on {r.platform ?? "source"}
                </a>
              ) : null}
            </article>
          ))}
        </div>

        {filtered.length > shown ? (
          <div className="tw-row" style={{ justifyContent: "center", marginTop: "1.2rem" }}>
            <button type="button" className="tw-btn" onClick={() => setShown((n) => n + initialCount)}>
              Show more reviews
            </button>
          </div>
        ) : null}
      </div>
    </Gate>
  );
}
