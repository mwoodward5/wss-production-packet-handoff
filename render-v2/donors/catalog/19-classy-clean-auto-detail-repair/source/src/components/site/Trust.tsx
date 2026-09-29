import { getSite, aggregateRating, sectionCopy } from "@/lib/wss";
import { ShieldCheck } from "lucide-react";
import { BUSINESS } from "@/lib/business";

export function Trust() {
  const c=getSite();
  const aggregate=aggregateRating();
  const SIGNALS=c.trust.badges.map(b=>({icon:ShieldCheck,title:b.label,body:[b.sublabel,b.meta].filter(Boolean).join(" · ")}));
  if (!SIGNALS.length && !c.trust.areas.length && !c.trust.reviews.length && !aggregate) return null;
  return (
    <section className="py-24 sm:py-32 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-7">
            <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">§ 03 — {c.identity.businessName}</span>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
              Business details.
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {SIGNALS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="lift relative rounded-2xl border border-border bg-card p-7 min-h-[230px] flex flex-col">
                <Icon className="h-7 w-7 text-accent" strokeWidth={1.4} />
                <h3 className="mt-7 font-display text-xl leading-snug">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">{s.body}</p>
                <span className="mt-4 font-mono text-[10px] text-muted-foreground/50">— {BUSINESS.shortName}</span>
              </div>
            );
          })}
        </div>

        {aggregate && <a href={aggregate.sourceUrl} className="block mt-8 font-display text-2xl">{aggregate.rating} / 5 · {aggregate.count} reviews</a>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-8">{c.trust.reviews.slice(0,3).map((r,i)=><blockquote key={i} className="rounded-2xl border border-border bg-card p-7"><p>{r.text}</p><cite><a href={r.sourceUrl}>{r.author}</a></cite></blockquote>)}</div>
        {/* Service-area panel */}
        {c.trust.areas.length > 0 && <div className="mt-12 rounded-2xl border border-border bg-card p-7 sm:p-10">
          <div className="grid grid-cols-12 gap-6 items-center">
            <div className="col-span-12 lg:col-span-4">
              <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Service area</span>
              <h3 className="mt-2 font-display text-2xl sm:text-3xl">{c.trust.areas.join(" · ")}</h3>
              {sectionCopy('service-area') && <p className="mt-4 text-sm text-muted-foreground whitespace-pre-line">{sectionCopy('service-area')}</p>}
            </div>
            <div className="col-span-12 lg:col-span-8 flex flex-wrap gap-2">
              {BUSINESS.serviceAreas.map((a) => (
                <span key={a} className="inline-flex items-center rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-foreground/80">
                  {a}
                </span>
              ))}
              <span className="inline-flex items-center rounded-full bg-foreground text-background px-3.5 py-1.5 text-xs">
                Not on the list? Ask us.
              </span>
            </div>
          </div>
        </div>}
      </div>
    </section>
  );
}
