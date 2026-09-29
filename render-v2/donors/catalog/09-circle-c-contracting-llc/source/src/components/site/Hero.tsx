import { Phone, ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useClient } from "@/wss/bridge";
import { HeroMedia } from "@/wss/HeroMedia";
import { FieldConditions } from "@/components/site/FieldConditions";
import { SoilProfile } from "@/components/site/SoilProfile";

/**
 * Circle C — one-of-one hero.
 * Composition archetype: surveyor's plat sheet.
 *  - Left "spine": rotated coordinate stack + vertical EST. label
 *  - Right 2/3: cinematic excavation image with diagonal torn cut,
 *    duotone clay/ink wash, topographic contour overlay,
 *    animated trench utility line and drifting dust motes.
 *  - Foreground: oversized Oswald display + a "work-order" card
 *    pinned to lower-left containing the CTA + dial-tone strip.
 *  - Survey-stake corner brackets define the frame.
 */
export function Hero() {
  const {client} = useClient();
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 800);
        if (imgRef.current) {
          imgRef.current.parentElement?.style.setProperty("--py", `${y * 0.14}px`);
        }
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      id="top"
      className="relative min-h-[100svh] overflow-hidden bg-[oklch(0.13_0.012_60)]"
    >
      {/* ============== IMAGE PLATE (right 2/3 on md+) ============== */}
      <div className="absolute inset-0 md:left-[220px] overflow-hidden diag-cut-right">
        <HeroMedia imageRef={imgRef} />
        {/* Duotone + clay cast + topo */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, rgba(20,18,15,0.88) 0%, rgba(28,24,20,0.62) 38%, rgba(78,52,28,0.42) 65%, rgba(10,9,8,0.85) 100%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 78% 28%, rgba(232,158,72,0.20) 0%, rgba(0,0,0,0) 55%)",
          }}
        />
        <div className="absolute inset-0 hero-topo opacity-60" />

        {/* Animated trench utility line — drawn diagonally across image */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 1200 800"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M -20 640 C 220 600, 360 540, 560 520 S 980 420, 1240 360"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            className="trench-line"
          />
          {/* utility nodes */}
          {[
            [220, 600],
            [560, 520],
            [820, 460],
            [1080, 390],
          ].map(([cx, cy], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r="6" fill="var(--accent)" opacity="0.9" />
              <circle cx={cx} cy={cy} r="14" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.45" />
            </g>
          ))}
        </svg>

        {/* Dust motes */}
        <div className="absolute inset-0 pointer-events-none">
          {[
            { l: "22%", t: "60%", d: "0s",  s: 3 },
            { l: "44%", t: "72%", d: "1.4s", s: 2 },
            { l: "68%", t: "55%", d: "3.0s", s: 4 },
            { l: "82%", t: "68%", d: "4.6s", s: 2 },
            { l: "30%", t: "80%", d: "6.0s", s: 3 },
          ].map((m, i) => (
            <span
              key={i}
              className="dust-mote absolute rounded-full bg-[var(--accent)]"
              style={{
                left: m.l,
                top: m.t,
                width: m.s,
                height: m.s,
                animationDelay: m.d,
                opacity: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* ============== LEFT SPINE (plat sheet column) ============== */}
      <aside className="absolute inset-y-0 left-0 hidden md:flex w-[220px] flex-col justify-between border-r border-[oklch(0.82_0.16_70/0.35)] bg-[oklch(0.10_0.012_60)] z-20">
        {/* top stake mark */}
        <div className="px-5 pt-7">
          <div className="flex items-center gap-2 mono-cap text-[var(--accent)]">
            <span className="inline-block w-2 h-2 bg-[var(--accent)]" />
            PLAT&nbsp;/&nbsp;SHEET&nbsp;01
          </div>
          <div className="mt-3 mono-cap text-primary-foreground/55 leading-relaxed">
            {client.identity.city}<br />{client.identity.state}
          </div>
        </div>

        {/* Field briefing — derived from today's date for Onawa, IA */}
        <div className="flex-1 flex items-center">
          <div className="w-full">
            <FieldConditions variant="spine" />
          </div>
        </div>

        {/* bottom: scale bar */}
        <div className="px-5 pb-7">
          <div className="mono-cap text-primary-foreground/55 mb-2 flex items-center justify-between">
            <span>ILLUSTRATION</span>
            <span className="opacity-70">{client.identity.founded || ""}</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-sm border border-primary-foreground/30">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={i % 2 === 0 ? "flex-1 bg-primary-foreground/85" : "flex-1 bg-transparent"}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* survey-stake corners */}
      <span className="stake-corner tl" aria-hidden />
      <span className="stake-corner tr" aria-hidden />
      <span className="stake-corner bl" aria-hidden />
      <span className="stake-corner br" aria-hidden />

      {/* ============== CONTENT ============== */}
      <div className="relative z-10 pt-28 md:pt-32 pb-24 md:pb-32 min-h-[100svh] flex flex-col justify-end px-5 md:pl-[260px] md:pr-10 max-w-[1400px] mx-auto">
        {/* eyebrow strip */}
        <div className="flex items-center gap-3 mb-5">
          <span className="h-px w-8 bg-[var(--accent)]" />
          <span className="mono-cap text-[var(--accent)]">
            {client.hero.eyebrow}
          </span>
        </div>

        {/* Massive display headline */}
        <h1 className="font-display text-primary-foreground uppercase font-bold leading-[0.86] tracking-[-0.01em] text-[2.75rem] xs:text-5xl sm:text-6xl md:text-[5.25rem] lg:text-[7rem] xl:text-[8rem] text-balance drop-shadow-[0_4px_24px_oklch(0.10_0.012_60/0.6)]">
          {client.hero.line1}
          <br />
          <span className="relative inline-block">
            <span className="text-[var(--accent)]">{client.hero.emphasis}</span>
            <span className="text-primary-foreground"><br />{client.hero.line3}</span>
            {/* underline tick */}
            <span className="absolute -bottom-2 left-0 h-[3px] w-24 bg-[var(--accent)]" />
          </span>
        </h1>

        {/* sub deck */}
        <p className="mt-8 max-w-xl text-primary-foreground/85 text-base md:text-lg leading-relaxed">
          {client.hero.support}
        </p>

        {/* Mobile-only field briefing ribbon */}
        <div className="md:hidden mt-6">
          <FieldConditions variant="ribbon" />
        </div>

        {/* ===== Work-order card (replaces traditional badge / CTA row) ===== */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 md:gap-6 items-stretch max-w-3xl">
          {/* Left: work order */}
          <div
            className="rounded-md overflow-hidden border shadow-deep"
            style={{
              background:
                "linear-gradient(180deg, oklch(0.985 0.01 80 / 0.98) 0%, oklch(0.94 0.014 75 / 0.98) 100%)",
              borderColor: "oklch(0.78 0.16 65 / 0.6)",
            }}
          >
            <div
              className="text-[10px] font-display uppercase px-4 py-1.5 flex items-center justify-between"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
                letterSpacing: "0.22em",
              }}
            >
              <span>Work Order · New Request</span>
              <span className="mono-cap opacity-80">REV&nbsp;A</span>
            </div>
            <div className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-display uppercase tracking-wide text-primary text-lg leading-tight">
                  Request a quote
                </div>
                <div className="mono-cap text-primary/70 mt-1">
                  {client.trust.badges.map(b => b.label).join(" · ")}
                </div>
              </div>
              <a
                href="#contact"
                className="group shrink-0 inline-flex items-center gap-2 bg-primary text-primary-foreground font-bold uppercase tracking-[0.14em] text-xs px-5 py-3 rounded-sm hover:bg-[var(--accent)] hover:text-primary transition-colors"
              >
                Contact Us
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </div>

          {/* Right: dial-tone strip (single tel CTA, monospace presentation) */}
          <a
            href={client.identity.phoneTel}
            className="group flex md:flex-col items-center md:items-start justify-between md:justify-center gap-2 px-5 py-4 rounded-md border border-[oklch(0.82_0.16_70/0.5)] bg-[oklch(0.10_0.012_60/0.6)] backdrop-blur hover:bg-[var(--accent)] hover:text-primary transition-colors"
          >
            <span className="mono-cap text-[var(--accent)] group-hover:text-primary/80">
              Direct Line
            </span>
            <span className="font-display text-primary-foreground group-hover:text-primary text-xl md:text-2xl tracking-wider flex items-center gap-2">
              <Phone className="h-4 w-4" />
              {client.identity.phoneDisplay}
            </span>
          </a>
        </div>

        {/* ===== Section A–A′ subsurface diagram ===== */}
        <div className="mt-10 md:mt-14 max-w-4xl">
          <SoilProfile />
        </div>

        {/* ===== bottom site-stakeout ribbon ===== */}
        <div className="mt-6 md:mt-8 border-t border-primary-foreground/15 pt-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 mono-cap text-primary-foreground/70">
          {client.services.slice(0,4).map((service,i) => <div key={service.name}><span className="text-[var(--accent)]">SVC {String(i+1).padStart(2,'0')} </span>{service.shortLabel}</div>)}
        </div>
      </div>

      {/* bottom edge fade into next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background z-10" />
    </section>
  );
}
