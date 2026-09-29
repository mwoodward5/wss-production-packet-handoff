import { client } from "@/lib/wss-bridge";
import { Star, Quote } from "lucide-react";
import { TESTIMONIALS, REVIEW_URL, BUSINESS } from "@/lib/business";

export function Testimonials({ heading = "What Customers Say" }: { heading?: string }) {
  if (!TESTIMONIALS.length) return null;
  return (
    <section className="py-20 sm:py-24" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Reviews</p>
          <h2 id="testimonials-heading" className="mt-2 text-3xl font-bold sm:text-5xl">
            {heading}
          </h2>
          {client.trust.aggregate?.rating != null && <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="flex" aria-label={`${client.trust.aggregate.rating} out of 5 stars`}>
              {Array.from({ length: Math.floor(client.trust.aggregate.rating) }).map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-accent text-accent" aria-hidden />
              ))}
            </div>
            <span className="font-semibold text-foreground">
              {client.trust.aggregate.rating.toFixed(1)} ★
            </span>
            <span>·</span>
            <span>{client.trust.aggregate.count} reviews</span>
          </div>}
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="relative rounded-2xl border border-border bg-card p-7 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
            >
              <Quote className="absolute right-6 top-6 h-8 w-8 text-primary/15" aria-hidden />
              <div className="flex" aria-hidden>
                {Array.from({ length: Math.floor(t.rating ?? 0) }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-accent text-accent" />
                ))}
              </div>
              <blockquote className="mt-4 text-sm leading-relaxed text-foreground/90">
                "{t.text}"
              </blockquote>
              <figcaption className="mt-5 text-sm">
                <div className="font-semibold text-foreground">{t.name}</div>
                <a href={t.sourceUrl} className="text-muted-foreground">Review source</a>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-12 text-center">
          <a
            href={REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-6 py-3 text-sm font-bold text-accent-foreground shadow-amber transition-smooth hover:opacity-95"
          >
            <Star className="h-4 w-4" /> Read reviews
          </a>
        </div>
      </div>
    </section>
  );
}
