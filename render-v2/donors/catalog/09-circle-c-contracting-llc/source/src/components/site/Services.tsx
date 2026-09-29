import { useClient } from "@/wss/bridge";
import { Droplets, Waves, Shovel, Siren, Construction, Trees, Pickaxe, ArrowUpRight } from "lucide-react";



export function Services() {
  const {client, plan} = useClient();
  const services = client.services.map((s,i) => ({title:s.name, desc:s.description, icon:Shovel, big:i===0, image:"", href:s.href}));
  return (
    <section id="services" className="relative py-24 md:py-32 bg-background">
      <div className="container-tight">
        <div className="grid lg:grid-cols-12 gap-8 items-end mb-14">
          <div className="lg:col-span-8 reveal">
            <span className="eyebrow mb-5">What We Do</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-[3.75rem] font-bold uppercase leading-[0.98] text-balance mt-4">
              Services
            </h2>
          </div>
          <p className="lg:col-span-4 text-muted-foreground text-lg leading-relaxed reveal reveal-delay-1">
            {client.content.serviceIntro}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {services.map((s, i) => {
            const Icon = s.icon;
            const span = s.big ? "lg:col-span-2 lg:row-span-2" : "";
            return (
              <article
                key={s.title}
                className={`reveal group relative overflow-hidden rounded-2xl bg-card border border-border shadow-card hover:shadow-deep hover:-translate-y-1 transition-all duration-500 ${span}`}
              >
                {s.image && (
                  <div className={`relative overflow-hidden ${s.big ? "h-80 lg:h-[26rem]" : "h-52"}`}>
                    <img
                      src={s.image}
                      alt={s.title}
                      loading="lazy"
                      width={800}
                      height={600}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.13_0.012_60/0.75)] via-[oklch(0.16_0.015_60/0.10)] to-transparent" />
                    <div className="absolute top-4 left-4 inline-flex items-center justify-center bg-primary/85 text-accent font-display text-[11px] font-bold tracking-[0.2em] px-2 py-1 rounded-sm backdrop-blur-sm">
                      0{i + 1}
                    </div>
                  </div>
                )}
                <div className="p-6 md:p-7">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-md bg-accent/15 text-accent ring-1 ring-accent/25">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-display text-xl md:text-2xl font-bold uppercase tracking-wide">
                        {s.title}
                      </h3>
                    </div>
                    {!s.image && (
                      <span className="font-display text-muted-foreground/60 text-xs font-bold tracking-[0.25em] mt-1">
                        0{i + 1}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{s.desc}</p>
                  <div className="mt-5 pt-4 border-t border-border/70 flex items-center justify-between">
                    <a
                      href={s.href || "#contact"}
                      className="text-xs font-display font-bold uppercase tracking-[0.18em] text-foreground hover:text-accent transition inline-flex items-center gap-1.5"
                    >
                      View service
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}