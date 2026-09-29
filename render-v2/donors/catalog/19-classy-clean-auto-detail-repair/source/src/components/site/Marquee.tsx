import { getSite } from "@/lib/wss";

export function Marquee() {
  const ITEMS=getSite().services.map(s=>s.name);
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <section aria-hidden="true" className="border-y border-border bg-foreground text-background overflow-hidden">
      <div className="flex marquee whitespace-nowrap py-5">
        {doubled.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-6 px-6 text-sm uppercase tracking-[0.28em] text-background/80">
            {it}
            <span className="text-accent">✦</span>
          </span>
        ))}
      </div>
    </section>
  );
}
