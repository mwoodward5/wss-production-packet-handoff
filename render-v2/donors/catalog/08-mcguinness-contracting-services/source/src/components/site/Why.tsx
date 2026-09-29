import { CLIENT, crew } from "@/lib/wss";
import { ShieldCheck, MessageSquare, HardHat, Snowflake } from "lucide-react";
export function Why() {
 const finisher=crew()?.path;
 const badge=CLIENT.trust.badges[0];
 const points=CLIENT.content.values.map(p=>({icon:HardHat,title:p.title,desc:p.body}));
  return (
    <section id="why" className="relative py-24 md:py-32">
      <div className="container mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
        {finisher && <div className="relative pb-24 sm:pb-28 lg:pb-0 lg:pr-10">
          <div className="relative rounded-sm overflow-hidden shadow-elegant aspect-[4/5] bg-[var(--ink)]">
            <img
              src={finisher}
              alt={`${CLIENT.identity.businessName} team`}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover object-top"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            <div className="absolute top-5 left-5 right-5 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-white/80">
              <span>{CLIENT.identity.businessName}</span>
              <span>{CLIENT.identity.city} · {CLIENT.identity.state}</span>
            </div>
          </div>
          {badge && <div className="absolute bottom-0 left-3 sm:left-6 lg:left-auto lg:right-0 bg-card border border-border rounded-sm p-5 shadow-card max-w-[260px]">
            <div className="text-3xl font-display uppercase text-gradient-warm">{badge.label}</div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-sans">
              {badge.sublabel}
            </p>
          </div>}
        </div>}

        <div>
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            About {CLIENT.identity.businessName}
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            {CLIENT.content.whyHeadline || CLIENT.identity.businessName}
          </h2>
          <p className="mt-5 text-muted-foreground text-lg font-sans">
            {CLIENT.content.about}
          </p>

          <div className="mt-10 grid sm:grid-cols-2 gap-5">
            {points.map((p) => (
              <div key={p.title} className="flex gap-4">
                <div className="shrink-0 h-11 w-11 rounded-sm bg-secondary border border-border flex items-center justify-center">
                  <p.icon className="h-5 w-5 text-[var(--ink)]" />
                </div>
                <div>
                  <h3 className="font-display text-base uppercase">{p.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed font-sans">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
