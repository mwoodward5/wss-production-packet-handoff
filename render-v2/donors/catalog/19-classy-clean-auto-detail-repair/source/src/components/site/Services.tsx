import { getSite } from "@/lib/wss";
import { Sparkles, Car, Wrench, ShieldCheck, Brush, PaintBucket, Cpu, Sofa } from "lucide-react";

export function Services() {
  const client=getSite();
  const SERVICES=client.services.map(s=>({icon:/diagnostic/i.test(s.name)?Cpu:/undercoat|rust/i.test(s.name)?ShieldCheck:/repair|mechanic/i.test(s.name)?Wrench:/paint/i.test(s.name)?PaintBucket:/interior|upholster/i.test(s.name)?Sofa:/mobile/i.test(s.name)?Car:Sparkles,title:s.name,body:s.description,tag:s.shortLabel,href:s.href}));
  return (
    <section id="services" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-12 gap-6 mb-16">
          <div className="col-span-12 lg:col-span-5">
            <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">§ 01 — Capabilities</span>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
              Services in <em className="text-accent not-italic">{client.identity.city}</em>.
            </h2>
          </div>
          <div className="col-span-12 lg:col-span-6 lg:col-start-7 flex items-end">
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed text-pretty">
              {client.content.serviceIntro}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          {SERVICES.map((s, i) => {
            const Icon = s.icon;
            return (
              <article
                key={i}
                className="group relative bg-card p-7 lg:p-8 flex flex-col min-h-[260px] hover:bg-secondary transition-colors duration-500"
              >
                <div className="flex items-start justify-between">
                  <Icon className="h-7 w-7 text-primary group-hover:text-accent transition-colors" strokeWidth={1.4} />
                  <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">{s.tag}</span>
                </div>
                <h3 className="mt-8 font-display text-xl leading-snug text-balance">{s.href ? <a href={s.href}>{s.title}</a> : s.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed flex-1">{s.body}</p>
                <span className="mt-5 font-mono text-[10px] text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")} / {String(SERVICES.length).padStart(2, "0")}
                </span>
              </article>
            );
          })}
        </div>

        <div className="mt-10 flex justify-center">
          <a href="#contact" className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-accent-foreground text-sm font-medium hover:bg-foreground transition">
            Get a quote on your vehicle →
          </a>
        </div>
      </div>
    </section>
  );
}
