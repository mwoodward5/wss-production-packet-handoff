import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Horizontal rail of poster-first video testimonials; video only loads on click. */
export function VideoTestimonialStrip() {
  const cfg = useTrust();
  const vids = cfg.proof.videoTestimonials ?? [];
  const [active, setActive] = React.useState<string | null>(null);

  return (
    <Gate id="VideoTestimonialStrip" when={vids.length > 0}>
      <ul className="tw-rail" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {vids.map((v) => (
          <li key={v.id} className="tw-card" style={{ width: 260, padding: ".5rem" }}>
            <div style={{ position: "relative", aspectRatio: "9/16", borderRadius: "var(--tw-radius)", overflow: "hidden", background: "var(--tw-surface-alt)" }}>
              {active === v.id ? (
                <video className="tw-img" src={v.videoUrl} poster={v.posterUrl} controls autoPlay playsInline preload="metadata" />
              ) : (
                <button type="button" onClick={() => setActive(v.id)}
                  style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", height: "100%" }}
                  aria-label={`Play testimonial from ${v.author}`}>
                  <img className="tw-img" src={v.posterUrl} alt="" loading="lazy" />
                  <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <span style={{ width: 54, height: 54, borderRadius: 999, background: "var(--tw-accent)", color: "var(--tw-accent-text)", display: "grid", placeItems: "center" }}>▶</span>
                  </span>
                </button>
              )}
            </div>
            <p style={{ margin: ".6rem .2rem .2rem", fontSize: ".85rem" }}>{v.author}</p>
            {v.caption ? <p className="tw-muted" style={{ margin: "0 .2rem .3rem", fontSize: ".78rem" }}>{v.caption}</p> : null}
          </li>
        ))}
      </ul>
    </Gate>
  );
}
