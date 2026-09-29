import { getSite, hoursText } from "@/lib/wss";
import { HeroMedia } from "./HeroMedia";

import { ArrowDown, Phone, MapPin, ArrowUpRight, Sparkles, ShieldCheck } from "lucide-react";
import { BUSINESS } from "@/lib/business";

export function Hero() {
  const c=getSite();
  return (
    <section
      id="top"
      className="relative isolate min-h-[100svh] w-full overflow-hidden bg-loam pt-14 sm:pt-16"
    >
      {/* ============ BACKDROP : detailing studio plate ============ */}
      <div className="absolute inset-0 -z-10">
        <HeroMedia />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, oklch(0.10 0.005 240 / 0.94) 0%, oklch(0.10 0.005 240 / 0.78) 38%, oklch(0.12 0.005 240 / 0.34) 60%, oklch(0.12 0.005 240 / 0.18) 100%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, oklch(0.13 0.005 240 / 0.5) 0%, transparent 14%, transparent 62%, oklch(0.10 0.005 240 / 0.94) 100%)",
          }}
        />
        <div className="absolute right-[-10%] top-[20%] h-[70vh] w-[70vh] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle at center, oklch(0.55 0.21 27 / 0.45), transparent 65%)" }}
        />
        <div className="grain absolute inset-0 opacity-[0.5]" />
      </div>

      {/* ============ TOP HAIRLINE ============ */}
      <div className="pointer-events-none absolute inset-x-0 top-14 sm:top-16 z-10 mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex items-center justify-between border-t border-bone/10 pt-4 text-bone/55 text-[10px] tracking-[0.32em] uppercase font-mono">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-1 w-6 bg-accent" />
            {c.identity.businessName}
          </span>
          <span className="hidden sm:inline">{c.identity.city}, {c.identity.state}</span>
          {c.trust.badges.length > 0 && <span className="hidden md:inline-flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-accent" />
            {c.trust.badges[0]?.label || ""}
          </span>}
        </div>
      </div>

      {/* ============ MAIN GRID ============ */}
      <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 grid grid-cols-12 gap-x-8 gap-y-12 min-h-[calc(100svh-3.5rem)] pt-16 pb-28 sm:pt-20 sm:pb-32">

        {/* LEFT */}
        <div className="col-span-12 lg:col-span-7 flex flex-col justify-center relative">
          <span className="hidden lg:block absolute -left-4 top-8 bottom-8 w-px bg-gradient-to-b from-transparent via-bone/25 to-transparent" />

          <div className="flex items-center gap-3 mb-6 reveal">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-accent breathe" />
              <span className="absolute inset-0 rounded-full bg-accent" />
            </span>
            <span className="text-bone/85 text-[11px] tracking-[0.32em] uppercase">
              {c.hero.eyebrow}
            </span>
          </div>

          <h1 className="reveal reveal-delay-1 font-display text-bone text-[clamp(2.85rem,8vw,7rem)] leading-[0.92] tracking-[-0.025em] text-balance">
            <span className="block">{c.hero.line1}</span>
            <span className="block">

              <em className="not-italic relative inline-block italic font-display text-accent">
                <span className="relative z-10">{c.hero.emphasis}</span>
                <svg
                  className="absolute left-[-2%] right-[-2%] -bottom-1 sm:-bottom-2 w-[104%] motion-safe:animate-[underlineDraw_1.4s_ease-out_0.9s_forwards] z-0"
                  viewBox="0 0 220 14"
                  fill="none"
                  preserveAspectRatio="none"
                  style={{ height: "0.32em", strokeDasharray: 280, strokeDashoffset: 280 }}
                  aria-hidden
                >
                  <path d="M2 9 C 50 2, 110 12, 218 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </em>
            </span>
            <span className="block text-bone/95">{c.hero.line3}</span>
          </h1>

          <div className="reveal reveal-delay-2 mt-9 flex items-start gap-5 max-w-2xl">
            <span className="hidden sm:block mt-2 h-12 w-px bg-accent/60" />
            <p className="text-bone/85 text-[15.5px] sm:text-[17px] leading-[1.65] text-pretty font-light">
              {c.hero.support}
            </p>
          </div>

          <div className="reveal reveal-delay-3 mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#contact"
              className="group relative inline-flex items-center gap-3 rounded-full bg-accent px-8 py-4 text-accent-foreground font-medium shadow-[0_22px_60px_-15px_oklch(0.55_0.21_27/0.6)] hover:shadow-[0_30px_80px_-15px_oklch(0.55_0.21_27/0.85)] hover:-translate-y-0.5 transition-all duration-500"
            >
              <span>Contact us</span>
              <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-foreground/15 group-hover:bg-accent-foreground/25 transition">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </a>
            <a
              href={BUSINESS.phoneHref}
              className="inline-flex items-center gap-3 rounded-full border border-bone/30 bg-bone/[0.04] backdrop-blur-md px-7 py-4 text-bone hover:bg-bone/10 hover:border-bone/50 transition"
            >
              <Phone className="h-4 w-4 text-accent" />
              <span className="font-medium tracking-tight">{BUSINESS.phone}</span>
            </a>
          </div>

          <div className="reveal reveal-delay-4 mt-12 grid grid-cols-3 gap-4 sm:gap-8 max-w-xl">
            {hoursText() && <Stat k="Hours" v={hoursText()} />}
            {c.trust.badges.slice(0,2).map((b,i)=><Stat key={i} k={b.label} v={b.sublabel} />)}
          </div>
        </div>

        {/* RIGHT — paint medallion */}
        <aside className="col-span-12 lg:col-span-5 flex items-center justify-center reveal reveal-delay-2 relative">
          <div className="relative w-full max-w-[520px] aspect-square">

            <svg className="absolute inset-0 -m-6 motion-safe:animate-[ringSpin_120s_linear_infinite] text-bone/35" viewBox="0 0 200 200" aria-hidden>
              <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" strokeWidth="0.3" />
              {Array.from({ length: 60 }).map((_, i) => {
                const a = (i / 60) * Math.PI * 2;
                const len = i % 5 === 0 ? 4 : 1.6;
                const r = (n: number) => Number(n.toFixed(3));
                const x1 = r(100 + Math.cos(a) * 98);
                const y1 = r(100 + Math.sin(a) * 98);
                const x2 = r(100 + Math.cos(a) * (98 - len));
                const y2 = r(100 + Math.sin(a) * (98 - len));
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={i % 5 === 0 ? 0.6 : 0.3} />;
              })}
            </svg>

            <div className="pointer-events-none absolute inset-0 -m-6 text-bone/55 text-[9px] tracking-[0.4em] font-mono uppercase">
              <span className="absolute left-1/2 -translate-x-1/2 top-0">N</span>
              <span className="absolute left-1/2 -translate-x-1/2 bottom-0">S</span>
              <span className="absolute top-1/2 -translate-y-1/2 left-0">W</span>
              <span className="absolute top-1/2 -translate-y-1/2 right-0">E</span>
            </div>

            <span className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full text-bone/55 text-[10px] tracking-[0.4em] font-mono uppercase whitespace-nowrap pb-3">
              Spec №&nbsp;001
            </span>

            <div className="absolute inset-0 rounded-full overflow-hidden ring-1 ring-bone/15 shadow-[0_50px_120px_-30px_rgba(0,0,0,0.85),inset_0_0_60px_rgba(0,0,0,0.4)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_45%_40%,oklch(0.65_0.20_27/0.18),transparent_60%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_55%,oklch(0.10_0.005_240/0.7)_100%)]" />

              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 200" aria-hidden>
                {[78, 64, 50, 36, 22].map((r, i) => (
                  <circle
                    key={r}
                    cx="100"
                    cy="100"
                    r={r}
                    fill="none"
                    stroke="oklch(0.985 0.008 80 / 0.42)"
                    strokeWidth="0.5"
                    strokeDasharray={2 * Math.PI * r}
                    strokeDashoffset={2 * Math.PI * r}
                    style={{
                      animation: `ringDraw 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
                      animationDelay: `${0.4 + i * 0.18}s`,
                    }}
                  />
                ))}
              </svg>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-[58%] aspect-square rounded-full border border-bone/20">
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-2 w-px bg-bone/50" />
                  <span className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1 h-2 w-px bg-bone/50" />
                  <span className="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1 w-2 h-px bg-bone/50" />
                  <span className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1 w-2 h-px bg-bone/50" />
                </div>
              </div>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center w-[58%]">
                  <img src={c.identity.logoOnDark} alt={`${c.identity.businessName} logo`} className="mx-auto h-20 w-20 sm:h-28 sm:w-28 object-contain" width={112} height={112} />
                  <div className="mt-3 font-display text-bone text-lg sm:text-2xl leading-tight tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)]">
                    {c.identity.businessName}
                  </div>
                  <div className="mt-2 text-bone/75 text-[10px] tracking-[0.4em] font-mono uppercase">
                    {c.services[0].shortLabel}
                  </div>
                </div>
              </div>
            </div>

            {c.trust.badges.length > 0 && <div className="absolute -top-3 -right-2 sm:-top-4 sm:-right-4 motion-safe:animate-[floatY_6s_ease-in-out_infinite]">
              <div className="rounded-full bg-bone text-loam pl-1.5 pr-4 py-1.5 flex items-center gap-2 shadow-[0_18px_40px_-15px_rgba(0,0,0,0.65)]">
                <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <span className="absolute inset-0 rounded-full bg-accent breathe" />
                  <ShieldCheck className="relative h-3 w-3" />
                </span>
                <div className="leading-tight">
                  <div className="text-[8.5px] tracking-[0.28em] uppercase font-mono opacity-65">Business details</div>
                  <div className="text-[12px] font-medium">{c.trust.badges[0]?.label}</div>
                </div>
              </div>
            </div>}

            {c.trust.areas.length > 0 && <div className="absolute -bottom-4 -left-4 sm:-bottom-6 sm:-left-6 motion-safe:animate-[floatY_7s_ease-in-out_infinite_reverse]">
              <div className="rounded-2xl bg-loam/85 backdrop-blur-xl border border-bone/15 px-4 py-3 shadow-[0_18px_40px_-15px_rgba(0,0,0,0.65)] max-w-[220px]">
                <div className="flex items-center gap-2 text-bone/55 text-[9px] tracking-[0.32em] font-mono uppercase">
                  <MapPin className="h-3 w-3 text-accent" /> Service area
                </div>
                <div className="mt-1 text-bone font-display text-[15px] leading-snug">
                  {c.trust.areas.slice(0,3).join(" · ")}
                </div>
              </div>
            </div>}

            <svg className="hidden lg:block absolute -left-24 top-[42%] w-24 h-12 text-bone/35" viewBox="0 0 100 50" aria-hidden>
              <path d="M 0 25 H 80" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 3" />
              <circle cx="80" cy="25" r="2" fill="currentColor" />
              <text x="2" y="20" fontSize="6" fill="currentColor" fontFamily="ui-monospace,monospace" letterSpacing="0.18em">
                FIG. 01
              </text>
            </svg>
          </div>
        </aside>
      </div>

      {/* BOTTOM TICKER */}
      <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-bone/10 bg-loam/55 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-3 flex items-center justify-between text-[11px] tracking-[0.22em] uppercase text-bone/60 font-mono gap-4">
          <span className="inline-flex items-center gap-3 shrink-0">
            <span className="inline-block h-1 w-6 bg-accent" />
            {c.services.slice(0,3).map(s=>s.shortLabel).join(" · ")}
          </span>
          <span className="hidden md:inline truncate">{c.services.slice(3).map(s=>s.shortLabel).join(" · ")}</span>
          <a href="#services" className="hidden sm:inline-flex items-center gap-2 text-bone/85 hover:text-accent transition shrink-0">
            Begin <ArrowDown className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-t border-bone/15 pt-3">
      <div className="text-bone/50 text-[9.5px] tracking-[0.32em] uppercase font-mono">{k}</div>
      <div className="mt-1 text-bone font-display text-[17px] leading-tight">{v}</div>
    </div>
  );
}
