import { useEffect, useState } from "react";
import { Star, Quote } from "lucide-react";
import { trackReviewClick } from "@/lib/track";
import { SectionHeading } from "./SectionHeading";
import { useLiveIdentity, useLiveReviews } from "@/lib/wssc";

/**
 * NO FAKE REVIEWS — a hard law. The carousel renders ONLY verified reviews
 * from the content island. With none published and a review profile verified,
 * the honest ask-the-customer card renders. With neither, the whole section
 * collapses away rather than inventing praise.
 */
export function Testimonials() {
  const reviews = useLiveReviews();
  const id = useLiveIdentity();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reviews.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % reviews.length), 6000);
    return () => clearInterval(t);
  }, [reviews.length]);

  if (reviews.length === 0 && !id.profileUrl) return null;

  return (
    <section className="bg-gradient-hero relative overflow-hidden py-20 text-primary-foreground">
      <div className="absolute inset-0 bg-mesh-animated opacity-40" />
      <div className="relative mx-auto max-w-4xl px-4 text-center lg:px-6">
        <SectionHeading
          eyebrow="What Clients Say"
          title="Built on word-of-mouth."
          align="center"
          tone="dark"
        />
        {reviews.length === 0 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-white/15 bg-white/10 p-8 backdrop-blur shadow-elegant">
            <Quote className="mx-auto h-8 w-8 text-gold" />
            <p className="mt-5 text-lg leading-relaxed text-primary-foreground/90">
              If we've worked on your project — a pour, a demolition, a renovation — a quick honest review
              means a lot to a crew that earns its reputation one job at a time.
            </p>
            <a
              href={id.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackReviewClick("testimonials")}
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-gold px-6 py-3 text-base font-semibold text-gold-foreground shadow-glow transition-all hover:-translate-y-0.5"
            >
              <Star className="h-5 w-5" /> Leave a Google Review
            </a>
          </div>
        ) : (
          <>
            <div className="relative mx-auto mt-10 min-h-[260px] max-w-2xl">
              {reviews.map((r, i) => (
                <div
                  key={i}
                  className={`absolute inset-0 rounded-3xl border border-white/15 bg-white/10 p-8 backdrop-blur shadow-elegant transition-opacity duration-700 ${i === idx ? "opacity-100" : "pointer-events-none opacity-0"}`}
                >
                  <div className="flex justify-center gap-1">
                    {Array.from({ length: r.rating }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-gold text-gold" />
                    ))}
                  </div>
                  <p className="mt-5 text-lg italic text-primary-foreground/90">"{r.text}"</p>
                  <div className="mt-5 text-sm font-semibold">
                    {r.name} {r.city ? <span className="text-primary-foreground/60">— {r.city}</span> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center gap-2">
              {reviews.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Show review ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={`h-2 w-2 rounded-full transition-all ${i === idx ? "w-6 bg-gold" : "bg-white/30"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
