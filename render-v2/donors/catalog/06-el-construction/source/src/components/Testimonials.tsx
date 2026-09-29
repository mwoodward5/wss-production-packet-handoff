import { useEffect, useState } from "react";
import { Star, Quote } from "lucide-react";
import { site, client } from "@/lib/site";
import { trackReviewClick } from "@/lib/track";
import { SectionHeading } from "./SectionHeading";

const REVIEWS=client.trust.reviews;

export function Testimonials() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (REVIEWS.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % REVIEWS.length), 6000);
    return () => clearInterval(t);
  }, []);

  const aggregate=client.trust.aggregate;
  if (!REVIEWS.length && !aggregate) return null;
  return (
    <section className="bg-gradient-hero relative overflow-hidden py-20 text-primary-foreground">
      <div className="absolute inset-0 bg-mesh-animated opacity-40" />
      <div className="relative mx-auto max-w-4xl px-4 text-center lg:px-6">
        <SectionHeading
          eyebrow="What Clients Say"
          title="Client reviews"
          align="center"
          tone="dark"
        />
        {aggregate && <p className="mt-6 text-lg"><a href={aggregate.sourceUrl} className="underline">{aggregate.rating == null ? '' : `${aggregate.rating}/5 · `}{aggregate.count} reviews</a></p>}
        {REVIEWS.length > 0 && (          <>
            <div className="relative mx-auto mt-10 min-h-[260px] max-w-2xl">
              {REVIEWS.map((r, i) => (
                <div
                  key={i}
                  className={`absolute inset-0 rounded-3xl border border-white/15 bg-white/10 p-8 backdrop-blur shadow-elegant transition-opacity duration-700 ${i === idx ? "opacity-100" : "pointer-events-none opacity-0"}`}
                >
                  <div className="flex justify-center gap-1">
                    {Array.from({ length: Math.floor(r.rating ?? 0) }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-gold text-gold" />
                    ))}
                  </div>
                  <p className="mt-5 text-lg italic text-primary-foreground/90">"{r.text}"</p>
                  <div className="mt-5 text-sm font-semibold">
                    {r.author} <a href={r.sourceUrl} className="text-primary-foreground/60">Review source</a>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center gap-2">
              {REVIEWS.map((_, i) => (
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
