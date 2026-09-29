import { Star } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";

export function Reviews() {
  const doubled = [...siteConfig.reviews, ...siteConfig.reviews];
  return (
    <section className="py-28 md:py-32 relative overflow-hidden">
      <div className="container-wss mb-14">
        <div className="section-label">Words from the chair</div>
        <h2 className="text-4xl md:text-5xl font-bold leading-[1.05] max-w-2xl">
          Clients who trusted the <span className="italic text-signal">process.</span>
        </h2>
      </div>

      <div className="relative">
        <div className="absolute inset-y-0 left-0 w-24 md:w-40 bg-gradient-to-r from-ink to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-24 md:w-40 bg-gradient-to-l from-ink to-transparent z-10 pointer-events-none" />
        <div className="flex gap-6 marquee-track snap-track w-max motion-reduce:animate-none">
          {doubled.map((r, i) => (
            <figure key={i} className="glass p-7 w-[340px] md:w-[400px] flex-shrink-0">
              <div className="flex gap-0.5 text-signal mb-4">
                {[0, 1, 2, 3, 4].map((s) => <Star key={s} size={14} fill="currentColor" strokeWidth={0} />)}
              </div>
              <blockquote className="font-display text-lg md:text-xl leading-snug text-bone mb-5">"{r.text}"</blockquote>
              <figcaption className="text-xs uppercase tracking-[0.24em] text-fadetext">— {r.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
