import { CLIENT } from "@/lib/wss";
import {
  Car, Footprints, Shapes, Building2, Wrench, Square, Construction, Flame,
} from "lucide-react";

export function Services() {
  const services=CLIENT.services.map(s=>({icon: Construction,title:s.name,desc:s.description,href:s.href}));
  return (
    <section id="services" className="relative py-24 md:py-32">
      <div className="container mx-auto px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            Services
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            Our services.
          </h2>
          <p className="mt-5 text-muted-foreground text-lg font-sans">{CLIENT.content.serviceIntro}</p>
        </div>

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {services.map((s) => (
            <article
              key={s.title}
              className="group relative rounded-sm border border-border bg-card p-6 shadow-card hover:shadow-elegant hover:-translate-y-0.5 transition-all duration-500"
            >
              <div className="h-12 w-12 rounded-sm bg-gradient-warm flex items-center justify-center text-[var(--ink)] shadow-glow">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-base uppercase tracking-tight"><a href={s.href || "#contact"}>{s.title}</a></h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed font-sans">{s.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
