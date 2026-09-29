import {CLIENT} from "@/lib/wss";
/**
 * Owner-Led Inspection Process — full-width band, four-stop horizontal track
 * with monospaced step codes. No floating cards.
 */

const STEPS=CLIENT.content.values.map((v,i)=>({n:`S-${String(i+1).padStart(2,"0")}`,t:v.title,d:v.body}));

export const Process = () => !STEPS.length ? null : (
  <section id="process" className="relative overflow-hidden bg-primary py-20 text-primary-foreground md:py-24">
    <div className="absolute inset-0 blueprint-grid-dark opacity-40" aria-hidden="true" />
    <div className="container-tight relative">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-signal">
            Section · 03 / About us
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-[44px] md:leading-[1.05]">
            {CLIENT.content.whyHeadline || CLIENT.identity.businessName}
          </h2>
        </div>
        <p className="text-primary-foreground/75 md:col-span-4">
          {CLIENT.content.about}
        </p>
      </div>

      {/* Horizontal track */}
      <div className="relative mt-12">
        <div className="absolute left-0 right-0 top-5 hidden h-px bg-primary-foreground/20 md:block" aria-hidden="true" />
        <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative">
              <div className="flex items-center gap-3">
                <span className="relative z-10 flex h-10 w-10 items-center justify-center border-2 border-accent bg-primary font-mono text-[10px] font-bold tracking-wider text-accent" style={{ borderRadius: "2px" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/55">{s.n}</span>
              </div>
              <h3 className="mt-5 font-display text-xl font-bold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-primary-foreground/75">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  </section>
);
