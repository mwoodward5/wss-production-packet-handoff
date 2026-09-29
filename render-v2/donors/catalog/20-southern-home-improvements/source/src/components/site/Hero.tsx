import { useSite } from "@/lib/wss";
import { HeroMedia } from "./HeroMedia";
import { ArrowRight, CloudLightning, Phone } from "lucide-react";

export function Hero() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const slates=client.services.map(s=>({code:client.identity.businessName,scope:s.name}));
  return (
    <section id="top" className="relative isolate overflow-hidden bg-ink text-cream">
      {/* Cinematic plate */}
      <div className="absolute inset-0 -z-10">
        <HeroMedia />
        {/* warm grade + readability scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/45 to-ink/55" />
        <div className="absolute inset-0 mix-blend-soft-light bg-[radial-gradient(ellipse_at_30%_70%,_oklch(0.72_0.16_42/0.25),_transparent_60%)]" />
        {/* film grain */}
        <div aria-hidden className="absolute inset-0 opacity-[0.07] mix-blend-overlay [background-image:radial-gradient(rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:3px_3px]" />
      </div>

      {/* corner registration marks */}
      <RegMark className="left-5 top-5 lg:left-8 lg:top-8" />
      <RegMark className="right-5 top-5 rotate-90 lg:right-8 lg:top-8" />
      <RegMark className="bottom-24 left-5 -rotate-90 lg:bottom-28 lg:left-8" />
      <RegMark className="bottom-24 right-5 rotate-180 lg:bottom-28 lg:right-8" />

      <div className="relative mx-auto flex min-h-[640px] max-w-7xl flex-col justify-end px-5 pt-32 pb-32 sm:min-h-[720px] lg:min-h-[780px] lg:px-8 lg:pt-44 lg:pb-36">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-clay-soft">
          {client.hero.eyebrow}
        </p>
        <h1 className="mt-5 max-w-4xl font-display text-[44px] font-medium leading-[0.98] tracking-tight text-cream sm:text-[64px] lg:text-[88px]">
          {client.hero.line1}
          <br />
          <span className="italic text-clay-soft">{client.hero.emphasis} {client.hero.line3}</span>
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-cream/80 sm:text-base">
          {client.hero.support}
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href={emailHref ? "#planner" : client.identity.phoneTel}
            className="group inline-flex items-center gap-2 rounded-full bg-cream px-6 py-3.5 text-sm font-semibold text-ink shadow-warm transition hover:bg-clay hover:text-cream"
          >
            Plan my project
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>
          <a
            href={client.identity.phoneTel}
            className="inline-flex items-center gap-2 rounded-full border border-cream/30 px-6 py-3.5 text-sm font-medium text-cream backdrop-blur transition hover:border-cream hover:bg-cream/10"
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2.5} /> {client.identity.phoneDisplay}
          </a>
        </div>
      </div>

      {/* Film-slate ticker pinned to hero bottom */}
      <div className="absolute inset-x-0 bottom-0 border-t border-cream/15 bg-ink/55 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 text-[11px] font-medium text-cream/85 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-clay-soft opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-clay" />
            </span>
            <span className="font-semibold uppercase tracking-[0.2em]">{client.identity.businessName}</span>
            <span className="hidden text-cream/55 sm:inline">{hours}</span>
          </div>
          <div className="flex items-center gap-5 overflow-hidden">
            <div className="flex animate-[slateScroll_18s_linear_infinite] gap-8 whitespace-nowrap motion-reduce:animate-none">
              {[...slates, ...slates].map((s, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-cream/70">
                  <span className="font-mono text-[10px] tracking-widest text-clay-soft">{s.code}</span>
                  <span className="text-cream/80">{s.scope}</span>
                  <span className="text-cream/30">·</span>
                </span>
              ))}
            </div>
            <a href={emailHref ? "#planner" : client.identity.phoneTel} className="hidden shrink-0 items-center gap-1.5 font-semibold text-cream hover:text-clay-soft md:inline-flex">
              <CloudLightning className="h-3.5 w-3.5" strokeWidth={2.5} />
              Plan a project
              <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes heroDrift {
          0% { transform: scale(1.04) translate3d(0,0,0); }
          100% { transform: scale(1.08) translate3d(-1%, -1%, 0); }
        }
        @keyframes slateScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}

function RegMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`absolute h-5 w-5 text-cream/40 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M0 6 H10 M6 0 V10" />
      <circle cx="6" cy="6" r="2.5" />
    </svg>
  );
}
