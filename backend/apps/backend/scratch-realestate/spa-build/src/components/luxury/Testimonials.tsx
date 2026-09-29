import { useReveal } from "@/hooks/useReveal";
import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { liveReviews, REVIEW_PROFILE, showReviewsSection } from "@/lib/content";

// VERIFIED ISLAND REVIEWS ONLY (truth law). The source design shipped three
// fabricated testimonials with invented client names; none of that survives.
// The engine's content island (window.__WSS_CONTENT__.reviews) is the ONLY
// source of quotes, rendered on the design's own rotating editorial frame.
// With no verified reviews but a verified profile, the honest review-ask card
// renders; with neither, the whole section collapses (and the navbar link to
// it collapses too — see lib/content.ts). Declared in BOILERPLATE.json
// renders[] so the engine does not append its own duplicate reviews block.
export default function Testimonials() {
  const { ref, revealed } = useReveal();
  const [active, setActive] = useState(0);

  // Auto-rotate
  useEffect(() => {
    if (liveReviews.length < 2) return;
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % liveReviews.length);
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  if (!showReviewsSection) return null;

  return (
    <section id="testimonials" className="scroll-mt-24 bg-sand py-40 md:py-56" ref={ref}>
      <div className="luxury-section">
        <div className={`text-center mb-20 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.4em] uppercase text-gold mb-6">
            Client Reflections
          </p>
          <h2 className="font-display font-medium text-charcoal leading-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
            Words That <em className="italic">Matter</em>
          </h2>
        </div>

        {liveReviews.length > 0 ? (
          <div className={`max-w-5xl mx-auto text-center reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.2s" }}>
            {/* Large decorative quotes */}
            <span className="font-display text-[120px] md:text-[160px] text-gold/10 leading-none select-none block -mb-16 md:-mb-24">"</span>

            <div className="relative min-h-[340px] md:min-h-[280px]">
              {liveReviews.map((r, i) => (
                <div
                  key={i}
                  className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-700"
                  style={{
                    opacity: active === i ? 1 : 0,
                    transform: active === i ? "translateY(0)" : "translateY(20px)",
                    pointerEvents: active === i ? "auto" : "none",
                  }}
                >
                  <p className="font-display text-xl md:text-2xl lg:text-3xl italic text-charcoal/75 leading-relaxed mb-10 max-w-4xl">
                    "{r.text}"
                  </p>
                  <div className="luxury-divider mx-auto mb-5" />
                  <div className="flex items-center justify-center gap-3">
                    {r.avatarUrl ? (
                      <img
                        src={r.avatarUrl}
                        alt={r.name ? `${r.name} profile photo` : "Reviewer profile photo"}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span aria-hidden className="w-10 h-10 rounded-full bg-gold/15 text-gold-dark flex items-center justify-center font-display text-sm font-semibold shrink-0">
                        {r.initials || "•"}
                      </span>
                    )}
                    <div className="text-left">
                      {r.name && <p className="font-display text-base md:text-lg text-charcoal leading-tight">{r.name}</p>}
                      <div className="flex items-center gap-2">
                        {r.rating > 0 && (
                          <span className="flex gap-0.5 text-gold-dark" aria-label={`${r.rating} out of 5 stars`}>
                            {Array.from({ length: r.rating }).map((_, j) => (
                              <Star key={j} className="w-3 h-3 fill-current" />
                            ))}
                          </span>
                        )}
                        {r.fromGoogle && (
                          <span className="text-[10px] font-body font-semibold tracking-wider uppercase text-muted-foreground border border-charcoal/15 rounded-full px-2 py-0.5">
                            Google
                          </span>
                        )}
                      </div>
                      {r.city && <p className="font-body text-xs text-muted-foreground mt-0.5">{r.city}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Dots with progress */}
            {liveReviews.length > 1 && (
              <div className="flex items-center justify-center gap-4 mt-16">
                {liveReviews.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActive(i)}
                    className="relative w-8 h-1 bg-charcoal/10 overflow-hidden"
                    aria-label={`Testimonial ${i + 1}`}
                  >
                    <div
                      className={`absolute inset-0 bg-gold transition-transform duration-700 origin-left ${
                        active === i ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`max-w-2xl mx-auto text-center reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.2s" }}>
            <p className="font-body text-sm text-muted-foreground leading-[1.9]">
              Worked together on a purchase or a sale? An honest Google review helps
              the next client find representation they can trust.
            </p>
            <a
              href={REVIEW_PROFILE}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-2 font-body text-[11px] tracking-luxury uppercase border border-gold/40 text-gold-dark px-10 py-4 hover:bg-gold hover:text-charcoal transition-all duration-500"
            >
              <Star className="w-4 h-4" /> Leave a Google Review
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
