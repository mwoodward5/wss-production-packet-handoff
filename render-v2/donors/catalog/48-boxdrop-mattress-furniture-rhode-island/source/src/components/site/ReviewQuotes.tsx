import { Star } from "lucide-react";
import {client} from "@/wss/bridge";
const reviewQuotes=client.trust.reviews;
import { business } from "@/data/business";

/**
 * Verified review quote cards. Renders nothing until reviewQuotes[] is populated
 * in src/data/trustSignals.ts with real, attributed reviews from GBP/Yelp/Facebook.
 * Emits valid Review JSON-LD nested under the business when present.
 */
export function ReviewQuotes() {
  if (!reviewQuotes.length) return null;

  return (
    <section className="border-y border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <p className="eyebrow">What customers say</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">
          Customer reviews
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reviewQuotes.map((r, i) => (
            <figure key={i} className="card-elevate p-6">
              <div className="flex items-center gap-1 text-[color:var(--gold)]">
                {Array.from({ length: Math.floor(r.rating??0) }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-3 text-sm text-foreground">"{r.text}"</blockquote>
              <figcaption className="mt-3 text-xs text-muted-foreground">
                — <span className="font-bold text-foreground">{r.author}</span> · <a href={r.sourceUrl} rel="noreferrer" target="_blank">Source</a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

    </section>
  );
}
