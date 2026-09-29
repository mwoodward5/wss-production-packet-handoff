import { gallery } from "@/wss/model";
import { useClient } from "@/wss/bridge";
import { ArrowUpRight } from "lucide-react";
export function Work() {
  const {client, plan} = useClient();
  const photos = gallery(client).map(m => ({src:m.path, caption:"", tag:""}));
  if (!photos.length) return null;
  return (
    <section id="work" className="py-24 md:py-32 bg-secondary relative overflow-hidden">
      <div className="container-tight">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14 reveal">
          <div className="max-w-2xl">
            <span className="eyebrow mb-5">Gallery</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold uppercase leading-[0.98] text-balance mt-4">
              Project
              <br />
              <span className="text-accent">gallery.</span>
            </h2>
          </div>
          <p className="text-muted-foreground md:max-w-sm leading-relaxed">
            
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
          {photos.map((p, i) => (            <figure
              key={i}
              className={`reveal reveal-delay-${i + 1} group relative overflow-hidden rounded-xl aspect-[4/5] shadow-card hover:shadow-deep transition-all duration-500`}
            >
              <img
                src={p.src}
                alt={p.caption}
                loading="lazy"
                width={600}
                height={750}
                className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.13_0.012_60/0.92)] via-[oklch(0.16_0.015_60/0.20)] to-transparent" />
              {p.tag && <div className="absolute top-4 left-4">
                <span className="inline-block bg-accent/95 text-accent-foreground text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-1 rounded-sm">
                  {p.tag}
                </span>
              </div>}
              <figcaption className="absolute bottom-0 inset-x-0 p-4 md:p-5 text-primary-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-bold uppercase tracking-wide text-sm md:text-base leading-tight">
                    {p.caption}
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition" />
                </div>
              </figcaption>
            </figure>
          ))}
        </div>

      </div>
    </section>
  );
}