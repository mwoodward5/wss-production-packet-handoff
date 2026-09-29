/**
 * Review quotes carousel — reads from REVIEWS config.
 */
import { REVIEWS } from "@/config";
import { Star } from "lucide-react";

export function ReviewQuotes() {
  if (!REVIEWS.length) return null;
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
      {REVIEWS.slice(0, 6).map((r, i) => (
        <article key={i} className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-1 mb-3">
            {Array.from({ length: r.rating }).map((_, k) => (
              <Star key={k} className="w-4 h-4 fill-primary text-primary" />
            ))}
          </div>
          <p className="text-sm text-foreground leading-relaxed">"{r.body}"</p>
          <div className="mt-4 text-xs text-muted-foreground">— {r.author}</div>
        </article>
      ))}
    </div>
  );
}
