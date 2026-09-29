import { getSite, serviceCopy } from "@/lib/wss";
import { useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";

export function JobPlanner() {
  const c=getSite();
  const PATHS=c.services.map((s,i)=>({id:String(i),label:s.name,desc:s.description,href:s.href}));
  const [active, setActive] = useState<string>("0");
  const path = PATHS.find((p) => p.id === active) || PATHS[0];

  return (
    <section id="estimator" className="relative py-24 sm:py-32 bg-foreground text-background overflow-hidden">
      <div className="absolute inset-0 grain pointer-events-none opacity-40" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-12 gap-6 items-end mb-12">
          <div className="col-span-12 lg:col-span-7">
            <span className="text-xs tracking-[0.3em] uppercase text-background/60">§ 02 — What does your car need?</span>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
              Pick a service. Explore the <em className="text-accent not-italic">details</em>.
            </h2>
          </div>
          <p className="col-span-12 lg:col-span-5 text-background/70 text-base leading-relaxed text-pretty">
            Select a service to prepare your enquiry.
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6 lg:gap-10">
          <div className="col-span-12 lg:col-span-5">
            <ul className="space-y-2">
              {PATHS.map((p) => {
                const isOn = p.id === active;
                return (
                  <li key={p.id}>
                    <button
                      aria-pressed={isOn}
                      onClick={() => setActive(p.id)}
                      className={`group w-full text-left rounded-xl border p-5 transition-all ${
                        isOn
                          ? "border-accent bg-accent/10"
                          : "border-background/15 hover:border-background/40 hover:bg-background/5"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display text-xl">{p.label}</span>
                        <ArrowRight
                          className={`h-4 w-4 transition-transform ${isOn ? "translate-x-1 text-accent" : "text-background/40"}`}
                        />
                      </div>
                      <p className={`mt-2 text-sm leading-relaxed ${isOn ? "text-background/85" : "text-background/55"}`}>
                        {p.desc}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="col-span-12 lg:col-span-7">
            <div className="rounded-2xl border border-background/15 bg-background/5 p-7 lg:p-10 backdrop-blur-sm">
              <h3 className="font-display text-3xl">{path.label}</h3>
              <p className="mt-6 text-background/80 whitespace-pre-line">{serviceCopy(c.services[Number(path.id)])}</p>
              <div className="mt-8 pt-6 border-t border-background/15 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                {c.trust.areas.length > 0 && <div className="flex items-center gap-2 text-sm text-background/70">
                  <MapPin className="h-4 w-4 text-accent" />
                  {c.trust.areas.join(" · ")}
                </div>}
                <a onClick={()=>window.dispatchEvent(new CustomEvent("wss-select-service",{detail:path.label}))} href="#contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-accent-foreground text-sm font-medium hover:bg-background hover:text-foreground transition">
                  Discuss this service →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
