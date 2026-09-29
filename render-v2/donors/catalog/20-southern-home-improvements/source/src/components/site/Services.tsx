import { useSite } from "@/lib/wss";
import { Home, Wrench, Layers, Cloud, Hammer, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function Services() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const services=client.services.map((s,i)=>({icon:[Home,Cloud,Layers,Wrench,Hammer,ShieldCheck][i%6],name:s.name,scope:s.shortLabel,line:s.description,timing:"",href:s.href}));
  return (
    <section id="services" className="relative bg-paper py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow">What we do</p>
            <h2 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl lg:text-5xl">
              Services <span className="italic text-clay">for your project.</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            {client.content.serviceIntro}
          </p>
        </div>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {services.map(({ icon: Icon, name, scope, line, timing, href }, i) => (
            <li
              key={name}
              className="group relative flex flex-col gap-4 bg-paper p-7 transition duration-300 hover:bg-cream"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-clay">
                  {String(i + 1).padStart(2, "0")} ⁄ {String(services.length).padStart(2, "0")}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">{scope}</span>
              </div>

              <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-ink ring-1 ring-ink/10 transition group-hover:bg-ink group-hover:text-cream">
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </span>

              <h3 className="font-display text-[22px] leading-snug text-ink">{name}</h3>
              <p className="text-sm leading-relaxed text-ink-soft">{line}</p>

              <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
                <span className="text-[11px] text-ink-soft">{timing}</span>
                <a
                  href={href || (emailHref ? "#planner" : client.identity.phoneTel)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition hover:text-clay"
                >
                  View service
                  <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
                </a>
              </div>

              {/* hairline sweep */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-7 bottom-0 h-px origin-left scale-x-0 bg-clay transition-transform duration-500 group-hover:scale-x-100"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
