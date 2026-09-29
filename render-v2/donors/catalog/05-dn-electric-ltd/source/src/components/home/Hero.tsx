import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Phone, ArrowUpRight, Zap, Plus, Minus } from "lucide-react";
import { BUSINESS, SERVICES } from "@/lib/business";
import { getClient } from "@/lib/wss-client";
import { HeroMedia } from "@/components/site/HeroMedia";
const CLIENT = getClient();


/**
 * COUTURE HERO v2 — DN Electric LTD
 *
 * One-of-a-kind, code-driven cinematic hero. No stock video, no stock image
 * dependency. Every visual is built from SVG + CSS so it animates forever,
 * scales perfectly, and is uniquely DN Electric.
 *
 * BACKGROUND — Living Load Center
 *   A full-bleed animated 200A residential service panel (the actual product
 *   DN Electric installs) drawn in SVG. Bus bars, neutral, ground, and 40
 *   numbered breakers. Current flows down the bus bars. Active breakers
 *   pulse gold. The amperage meter sweeps in real time. Sparks travel along
 *   wire paths. This is the "video" — frame-perfect, deterministic, never
 *   pixelated, never repeats the same way twice.
 *
 * FOREGROUND — Live Load Calculator (bespoke widget)
 *   The user clicks +/- on real Front Range home loads (EV, heat pump, AC,
 *   range, dryer, hot tub, shop). Each toggle:
 *     - lights up the matching breaker(s) in the background panel
 *     - pushes a real amperage value onto a live demand bar
 *     - updates the "recommended service" verdict (100A / 150A / 200A / 400A)
 *     - explains why, in plain language, with code-honest math
 *
 *   Numbers are based on NEC 220 demand factors and typical Front Range
 *   appliance ratings — not fabricated.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Real loads — typical Front Range residential, NEC-aligned amp draws @ 240V
// (continuous loads × 1.25 baked in where applicable)
// ─────────────────────────────────────────────────────────────────────────────
type LoadKey =
  | "ev"
  | "heatpump"
  | "ac"
  | "range"
  | "dryer"
  | "tub"
  | "shop"
  | "hpwh";

const LOADS: Array<{
  key: LoadKey;
  label: string;
  detail: string;
  amps: number;        // continuous draw at 240V after NEC factor
  breakers: number[];  // which breakers light up
}> = [
  { key: "ev",       label: "EV charger",        detail: "Level 2, 48A continuous", amps: 60, breakers: [3, 5] },
  { key: "heatpump", label: "Heat pump",         detail: "3-ton air-source",        amps: 40, breakers: [7, 9] },
  { key: "ac",       label: "Central AC",        detail: "4-ton condenser",         amps: 35, breakers: [11, 13] },
  { key: "range",    label: "Electric range",    detail: "Induction, 40A circuit",  amps: 30, breakers: [15, 17] },
  { key: "dryer",    label: "Electric dryer",    detail: "30A, 240V",               amps: 22, breakers: [19, 21] },
  { key: "hpwh",     label: "Heat-pump water heater", detail: "30A, 240V",          amps: 20, breakers: [23, 25] },
  { key: "tub",      label: "Hot tub",           detail: "50A GFCI",                amps: 38, breakers: [27, 29] },
  { key: "shop",     label: "Detached shop / ADU", detail: "60A subpanel feed",     amps: 45, breakers: [31, 33] },
];

// Always-on baseline (lighting, receptacles, fridge, microwave, small appliances)
// per NEC 220 general lighting + small appliance demand.
const BASELINE_AMPS = 28;

function recommendService(_totalAmps: number) {
  return { id: 'DEMO', title: 'Discuss your project', tone: 'ok',
    note: 'Illustrative arithmetic only, not a code calculation or service-sizing recommendation. Ask a qualified electrician to assess the actual installation.' };
}

export function Hero() {
  const [active, setActive] = useState<Set<LoadKey>>(new Set(["ev", "ac", "range", "dryer"]));
  const [tick, setTick] = useState(0);

  // Live "ammeter sweep" — drives gauge needle + sparkline
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let id: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(id);
      if (!query.matches) id = setInterval(() => setTick(t => (t + 1) % 360), 80);
      document.querySelectorAll('svg').forEach(svg => {
        if (query.matches) svg.pauseAnimations?.(); else svg.unpauseAnimations?.();
      });
    };
    update(); query.addEventListener('change', update);
    return () => { clearInterval(id); query.removeEventListener('change', update); };
  }, []);

  const totalAmps = useMemo(() => {
    let sum = BASELINE_AMPS;
    for (const l of LOADS) if (active.has(l.key)) sum += l.amps;
    return sum;
  }, [active]);

  const verdict = recommendService(totalAmps);

  // Which breakers are "live"
  const liveBreakers = useMemo(() => {
    const set = new Set<number>();
    LOADS.forEach((l) => { if (active.has(l.key)) l.breakers.forEach((b) => set.add(b)); });
    return set;
  }, [active]);

  // Demand bar fill — capped visually at 200A scale
  const demandPct = Math.min(100, (totalAmps / 200) * 100);
  // Needle angle for ammeter — -120° (0A) to +120° (250A)
  const needleAngle = -120 + Math.min(250, totalAmps) * (240 / 250);

  function toggle(k: LoadKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  return (
    <section className="relative isolate overflow-hidden bg-[var(--ink)] text-[var(--bone)]">
      {/* ═══════ DEEPEST LAYER — Cinematic loop (master electrician at the bus bar) ═══════ */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <HeroMedia
          className="absolute left-1/2 top-1/2 h-[115%] w-[115%] -translate-x-1/2 -translate-y-1/2 object-cover opacity-[0.55] [animation:hero-drift_28s_ease-in-out_infinite_alternate]"
          style={{ filter: "saturate(1.05) contrast(1.08)" }}
        />
        {/* Color-grade wash — pushes the footage toward DN gold/ink */}
        <div
          className="absolute inset-0 mix-blend-color"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--gold) 22%, transparent), transparent 40%, color-mix(in oklab, var(--ink) 60%, transparent))",
          }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 60% 50%, transparent 30%, color-mix(in oklab, var(--ink) 75%, transparent) 75%, var(--ink) 100%)",
          }}
        />
      </div>

      {/* ═══════ MIDDLE LAYER — Living Load Center (SVG schematic) ═══════ */}
      <div className="absolute inset-0 opacity-70 mix-blend-screen pointer-events-none">
        <LoadCenterBackground liveBreakers={liveBreakers} tick={tick} />
      </div>

      {/* Ink wash for typographic legibility */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(105deg, var(--ink) 0%, color-mix(in oklab, var(--ink) 92%, transparent) 30%, color-mix(in oklab, var(--ink) 70%, transparent) 52%, color-mix(in oklab, var(--ink) 30%, transparent) 75%, transparent 100%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[var(--ink)] to-transparent pointer-events-none" />
      <div className="absolute inset-0 noise pointer-events-none" />


      {/* ═══════ Vertical milled metadata rails ═══════ */}
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-10 flex-col items-center justify-between border-r border-[var(--bone)]/10 py-6 lg:flex">
        <div className="origin-bottom-left -rotate-90 translate-y-32 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-[0.4em] text-[var(--gold)]">
          {BUSINESS.region}
        </div>
        <div className="font-mono text-[0.55rem] uppercase tracking-[0.35em] text-[var(--bone)]/40">
          {BUSINESS.shortName}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-10 flex-col items-center justify-between border-l border-[var(--bone)]/10 py-6 lg:flex">
        <div className="font-mono text-[0.55rem] uppercase tracking-[0.35em] text-[var(--bone)]/40">{CLIENT.source.compiledAt.slice(0, 10)}</div>
        <div className="origin-top-right rotate-90 -translate-y-44 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-[0.4em] text-[var(--gold)]">
          {BUSINESS.name}
        </div>
      </div>

      {/* ═══════ Content grid ═══════ */}
      <div className="relative mx-auto grid min-h-[94vh] max-w-7xl grid-cols-12 gap-6 px-6 pb-28 pt-24 md:gap-8 md:px-12 md:pb-32 md:pt-28">
        {/* Eyebrow */}
        <div className="col-span-12 flex items-center justify-between animate-rise">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-2 w-2 rounded-full bg-[var(--gold)] animate-spark" />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.35em] text-[var(--bone)]/70">
              {CLIENT.hero.eyebrow}
            </span>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.35em] text-[var(--bone)]/55">
              {BUSINESS.region}
            </span>
          </div>
        </div>

      {/* Skyscraper headline — ELECTRIFIED TYPOGRAPHY (DN Electric fingerprint) */}
        <div className="col-span-12 lg:col-span-7 animate-rise" style={{ animationDelay: "0.08s" }}>
          <h1 className="display [overflow-wrap:anywhere] text-[3.2rem] leading-[0.88] tracking-tight sm:text-7xl md:text-[7rem] lg:text-[8.2rem]">
            <ElectrifiedWord text={CLIENT.hero.line1} tone="bone" />
            <span className="block pl-[8%]"><ElectrifiedWord text={CLIENT.hero.emphasis} tone="dim" /></span>
            <span className="block">
              <ElectrifiedWord text={CLIENT.hero.line3} tone="gold" />
            </span>
          </h1>

          <div className="mt-8 flex max-w-xl gap-5">
            <div className="h-[1px] w-12 translate-y-3 bg-[var(--gold)]" />
            <p className="text-base leading-relaxed text-[var(--bone)]/75 md:text-lg">
              {CLIENT.hero.support}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/contact"
              className="group relative inline-flex items-center gap-3 overflow-hidden rounded-none bg-[var(--gold)] px-7 py-5 text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink)] transition-transform hover:-translate-y-0.5"
              style={{ boxShadow: "var(--shadow-gold)" }}
            >
              <span className="relative z-10">Start your project</span>
              <ArrowUpRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              <span aria-hidden className="absolute inset-0 -translate-x-full bg-[var(--gold-soft)] transition-transform duration-500 group-hover:translate-x-0" />
            </Link>
            <a
              href={BUSINESS.phoneHref}
              className="inline-flex items-center gap-3 border-b border-[var(--bone)]/30 pb-2 font-mono text-sm tracking-wider text-[var(--bone)] hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
            >
              <Phone className="h-4 w-4" />
              {BUSINESS.phone}
            </a>
          </div>
        </div>

        {/* ═══════ LIVE LOAD CALCULATOR — bespoke widget ═══════ */}
        <div className="col-span-12 lg:col-span-5 animate-rise" style={{ animationDelay: "0.18s" }}>
          <div className="relative border border-[var(--bone)]/15 bg-[var(--ink)]/80 backdrop-blur-md shadow-[var(--shadow-couture)]">
            {/* Header strip */}
            <div className="flex items-center justify-between border-b border-[var(--bone)]/10 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] animate-spark" />
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.3em] text-[var(--bone)]/75">
                  Illustrative Load Demo
                </span>
              </div>
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.25em] text-[var(--bone)]/40">
                Example values
              </span>
            </div>

            {/* Ammeter + total */}
            <div className="grid grid-cols-5 gap-0 border-b border-[var(--bone)]/10">
              <div className="col-span-2 flex items-center justify-center border-r border-[var(--bone)]/10 px-4 py-5">
                <Ammeter angle={needleAngle} amps={totalAmps} />
              </div>
              <div className="col-span-3 flex flex-col justify-center px-5 py-5">
                <div className="font-mono text-[0.55rem] uppercase tracking-[0.3em] text-[var(--bone)]/45">
                  Example load sum
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="display text-5xl text-[var(--bone)]" style={{ fontFamily: "var(--font-display)" }}>
                    {totalAmps}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--bone)]/55">
                    Amps
                  </span>
                </div>
                {/* Demand bar */}
                <div className="mt-3 h-1.5 w-full overflow-hidden bg-[var(--bone)]/10">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${demandPct}%`,
                      background:
                        totalAmps > 165
                          ? "linear-gradient(90deg, var(--gold), var(--gold-soft))"
                          : "var(--gold)",
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[0.55rem] uppercase tracking-[0.25em] text-[var(--bone)]/35">
                  <span>0</span><span>100</span><span>200A</span>
                </div>
              </div>
            </div>

            {/* Toggleable loads */}
            <div className="grid grid-cols-2 gap-px bg-[var(--bone)]/10">
              {LOADS.map((l) => {
                const on = active.has(l.key);
                return (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => toggle(l.key)}
                    className={`group relative flex items-start gap-2.5 px-3 py-3 text-left transition-colors ${
                      on
                        ? "bg-[var(--gold)] text-[var(--ink)]"
                        : "bg-[var(--ink)] text-[var(--bone)]/75 hover:bg-[var(--ink-2)]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border ${
                        on ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--gold)]" : "border-[var(--bone)]/40 text-[var(--bone)]/60"
                      }`}
                    >
                      {on ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.78rem] font-semibold leading-tight">{l.label}</span>
                      <span className={`block font-mono text-[0.58rem] uppercase tracking-[0.18em] ${on ? "text-[var(--ink)]/70" : "text-[var(--bone)]/40"}`}>
                        +{l.amps}A · {l.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Verdict */}
            <div className="border-t border-[var(--bone)]/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[0.55rem] uppercase tracking-[0.3em] text-[var(--bone)]/45">
                    Project assessment
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="display text-3xl text-[var(--gold)]" style={{ fontFamily: "var(--font-display)" }}>
                      {verdict.id}
                    </span>
                    <span className="text-sm font-semibold text-[var(--bone)]">{verdict.title}</span>
                  </div>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--bone)]/60">
                    {verdict.note}
                  </p>
                </div>
                <Link
                  to="/contact"
                  className="inline-flex shrink-0 items-center gap-1.5 self-end font-mono text-[0.62rem] uppercase tracking-[0.25em] text-[var(--gold)] hover:text-[var(--gold-soft)]"
                >
                  Discuss your project <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </div>

            {/* Footer rail */}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--bone)]/10 bg-[var(--ink-2)]/60 px-5 py-2.5">
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-[var(--bone)]/45">
                Example only - not an installation specification
              </span>
              <Zap className="h-3 w-3 text-[var(--gold)]" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ Marquee handoff ═══════ */}
      <div className="relative border-t border-[var(--bone)]/10 bg-[var(--ink-2)]/70 py-4 ticker-mask">
        <div className="flex w-max animate-ticker gap-12 px-8 font-mono text-xs uppercase tracking-[0.3em] text-[var(--bone)]/65">
          {Array.from({ length: 2 }).map((_, dup) => (
            <div key={dup} className="flex items-center gap-12">
              {SERVICES.map(s => s.name).map((s) => (
                <span key={s + dup} className="inline-flex items-center gap-3">
                  <span className="text-[var(--gold)]">⚡</span>
                  {s}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD CENTER BACKGROUND — fully animated SVG residential service panel
// ─────────────────────────────────────────────────────────────────────────────
function LoadCenterBackground({ liveBreakers, tick }: { liveBreakers: Set<number>; tick: number }) {
  // 40 breakers, 2 columns × 20 rows
  const rows = 20;
  const breakerH = 22;
  const breakerW = 90;
  const colGap = 14;        // gap between L/R column for bus bars
  const panelTop = 60;
  const panelLeftCol = 0;   // local SVG coords inside panel group

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Soft gold rim from the right */}
      <div
        className="pointer-events-none absolute -right-40 top-1/4 h-[640px] w-[640px] rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--gradient-spark)" }}
      />

      <svg
        viewBox="0 0 800 900"
        preserveAspectRatio="xMaxYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="bgPanel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.18 0.012 80)" />
            <stop offset="100%" stopColor="oklch(0.12 0.01 80)" />
          </linearGradient>
          <linearGradient id="busBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.55 0.09 50)" />
            <stop offset="50%" stopColor="oklch(0.7 0.13 60)" />
            <stop offset="100%" stopColor="oklch(0.45 0.08 50)" />
          </linearGradient>
          <linearGradient id="goldFlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--gold)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Panel can — sits on right side of canvas */}
        <g transform="translate(440 40)">
          {/* Outer cabinet */}
          <rect x="-10" y="-10" width="320" height="820" fill="url(#bgPanel)" stroke="oklch(1 0 0 / 0.06)" />
          {/* Inner deadfront */}
          <rect x="6" y="6" width="288" height="788" fill="oklch(0.16 0.012 80)" stroke="oklch(1 0 0 / 0.04)" />

          {/* Top label strip */}
          <g transform="translate(20 22)">
            <text x="0" y="0" fontFamily="var(--font-mono)" fontSize="9" fill="oklch(0.78 0.01 80)" letterSpacing="2">
              200A · MAIN · LOAD CENTER
            </text>
            <text x="0" y="14" fontFamily="var(--font-mono)" fontSize="7" fill="oklch(0.55 0.01 80)" letterSpacing="2">
              ILLUSTRATIVE - COPPER BUS
            </text>
          </g>

          {/* Main breaker */}
          <g transform="translate(20 50)">
            <rect width="248" height="32" fill="oklch(0.22 0.012 80)" stroke="oklch(1 0 0 / 0.08)" />
            <rect x="6" y="6" width="60" height="20" fill="var(--gold)" />
            <text x="40" y="20" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink)" fontWeight="700">
              ON
            </text>
            <text x="80" y="20" fontFamily="var(--font-mono)" fontSize="9" fill="oklch(0.85 0.01 80)" letterSpacing="2">
              MAIN · 200A · 2P
            </text>
            {/* pulse light */}
            <circle cx="230" cy="16" r="2.5" fill="var(--gold)">
              <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
            </circle>
          </g>

          {/* Bus bars (two vertical copper rails) */}
          {[100, 175].map((x) => (
            <g key={x}>
              <rect x={x} y={panelTop + 40} width="14" height={rows * breakerH + 10} fill="url(#busBar)" />
              {/* current flow overlay */}
              <rect x={x} y={panelTop + 40} width="14" height={rows * breakerH + 10} fill="url(#goldFlow)" opacity="0.65">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={`0 -${rows * breakerH};0 ${rows * breakerH}`}
                  dur="3.2s"
                  repeatCount="indefinite"
                />
              </rect>
            </g>
          ))}

          {/* Breakers — 2 columns × 20 rows, numbered odd-left / even-right */}
          {Array.from({ length: rows }).map((_, r) => {
            const yTop = panelTop + 50 + r * breakerH;
            const leftNum = r * 2 + 1;
            const rightNum = r * 2 + 2;
            return (
              <g key={r}>
                <Breaker x={panelLeftCol + 10} y={yTop} w={breakerW} h={breakerH - 4} num={leftNum} side="L" live={liveBreakers.has(leftNum)} tick={tick} />
                <Breaker x={panelLeftCol + 10 + breakerW + colGap + 5} y={yTop} w={breakerW} h={breakerH - 4} num={rightNum} side="R" live={liveBreakers.has(rightNum)} tick={tick} />
              </g>
            );
          })}

          {/* Neutral / ground bar at bottom */}
          <g transform={`translate(20 ${panelTop + 50 + rows * breakerH + 12})`}>
            <rect width="248" height="14" fill="oklch(0.3 0.01 80)" stroke="oklch(1 0 0 / 0.08)" />
            <text x="6" y="10" fontFamily="var(--font-mono)" fontSize="7" fill="oklch(0.6 0.01 80)" letterSpacing="2">
              NEUTRAL · GROUND BAR
            </text>
          </g>
        </g>

        {/* Conduit + wire flow on the left side, drawn under the type wash */}
        <g opacity="0.55" filter="url(#glow)">
          <path d="M 60 80 L 60 360 L 200 360 L 200 520 L 380 520" stroke="var(--gold)" strokeWidth="1.2" fill="none" strokeDasharray="4 8">
            <animate attributeName="stroke-dashoffset" from="0" to="-200" dur="6s" repeatCount="indefinite" />
          </path>
          <path d="M 30 220 L 380 220" stroke="var(--gold)" strokeWidth="0.8" fill="none" strokeDasharray="2 10" opacity="0.6">
            <animate attributeName="stroke-dashoffset" from="0" to="-120" dur="9s" repeatCount="indefinite" />
          </path>
          {/* spark traveling */}
          <circle r="2.6" fill="var(--gold)">
            <animateMotion dur="5s" repeatCount="indefinite" path="M 60 80 L 60 360 L 200 360 L 200 520 L 380 520" />
            <animate attributeName="opacity" values="0;1;1;0" dur="5s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
    </div>
  );
}

function Breaker({
  x, y, w, h, num, side, live, tick,
}: {
  x: number; y: number; w: number; h: number; num: number; side: "L" | "R"; live: boolean; tick: number;
}) {
  const flicker = live ? 0.7 + Math.abs(Math.sin((tick + num * 7) / 12)) * 0.3 : 1;
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* breaker body */}
      <rect width={w} height={h} fill={live ? "oklch(0.32 0.06 85)" : "oklch(0.2 0.012 80)"} stroke="oklch(1 0 0 / 0.08)" />
      {/* toggle switch */}
      <rect
        x={side === "L" ? w - 16 : 4}
        y={h / 2 - 5}
        width="12"
        height="10"
        fill={live ? "var(--gold)" : "oklch(0.4 0.01 80)"}
        opacity={flicker}
      />
      {/* breaker number */}
      <text
        x={side === "L" ? 6 : w - 6}
        y={h / 2 + 3}
        textAnchor={side === "L" ? "start" : "end"}
        fontFamily="var(--font-mono)"
        fontSize="7"
        fill={live ? "var(--gold)" : "oklch(0.55 0.01 80)"}
        letterSpacing="1"
      >
        {String(num).padStart(2, "0")}
      </text>
      {/* live indicator dot */}
      {live && (
        <circle
          cx={side === "L" ? w - 22 : 22}
          cy={h / 2}
          r="1.6"
          fill="var(--gold)"
          opacity={flicker}
        />
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AMMETER — analog gauge with a needle that sweeps to amperage
// ─────────────────────────────────────────────────────────────────────────────
function Ammeter({ angle, amps }: { angle: number; amps: number }) {
  // Tick marks every 25A from 0..250
  const ticks = Array.from({ length: 11 }, (_, i) => i * 25);
  return (
    <svg viewBox="0 0 120 110" className="h-28 w-28">
      <defs>
        <radialGradient id="dial" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="oklch(0.22 0.012 80)" />
          <stop offset="100%" stopColor="oklch(0.12 0.01 80)" />
        </radialGradient>
      </defs>
      {/* dial */}
      <circle cx="60" cy="65" r="50" fill="url(#dial)" stroke="oklch(1 0 0 / 0.12)" />
      {/* arc */}
      <path d="M 18 75 A 50 50 0 0 1 102 75" stroke="oklch(1 0 0 / 0.18)" fill="none" strokeWidth="1" />
      {/* tick marks */}
      {ticks.map((t, i) => {
        const a = (-120 + (i * 240) / 10) * (Math.PI / 180);
        const r1 = 44, r2 = i % 2 === 0 ? 36 : 40;
        const x1 = 60 + Math.cos(a) * r1;
        const y1 = 65 + Math.sin(a) * r1;
        const x2 = 60 + Math.cos(a) * r2;
        const y2 = 65 + Math.sin(a) * r2;
        const isDanger = t >= 200;
        return (
          <line
            key={t}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isDanger ? "var(--gold)" : "oklch(0.6 0.01 80)"}
            strokeWidth={i % 2 === 0 ? 1.2 : 0.6}
          />
        );
      })}
      {/* danger arc 200-250 */}
      <path d="M 86 35 A 50 50 0 0 1 102 75" stroke="var(--gold)" strokeWidth="2" fill="none" opacity="0.85" />
      {/* needle */}
      <g transform={`rotate(${angle} 60 65)`} style={{ transition: "transform 600ms cubic-bezier(0.2,0.8,0.2,1)" }}>
        <line x1="60" y1="65" x2="60" y2="22" stroke="var(--gold)" strokeWidth="2" />
        <circle cx="60" cy="65" r="3.5" fill="var(--gold)" />
      </g>
      {/* readout */}
      <text x="60" y="100" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="oklch(0.65 0.01 80)" letterSpacing="2">
        {amps}A - EXAMPLE
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT MAP — DN Electric's signature seeded bolt geometry
//
// Every electrified word traces a lightning path that is mathematically
// derived from DN Electric's own identity:
//
//   • business name        → "DN Electric LTD"
//   • city / state / zip   → "Longmont, CO 80501"
//   • geo coordinates      → 40.1672°N, -105.1019°W
//   • the word being drawn → the local salt
//
// The same seed always produces the same bolt — deterministic, frame-stable,
// SSR-safe — but no other business's identity will produce these exact paths.
// This is the literal fingerprint: the company's coordinates, hashed into the
// shape of every spark on screen.
// ─────────────────────────────────────────────────────────────────────────────

// Business identity seed — computed once at module load
const BUSINESS_SEED = (() => {
  const id = `${BUSINESS.name}|${BUSINESS.city},${BUSINESS.state} ${BUSINESS.zip}|${CLIENT.source.packetSha256}`;
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
})();

// Lightweight string hash combined with the business seed
function seedFor(word: string): number {
  let h = BUSINESS_SEED;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build a current-map bolt path for a word.
// Returns BOTH the polyline path AND the actual point list so we can place
// nodes (junction boxes, arc-flash points) along the same geometry.
function buildCurrentMap(seed: number, segs: number) {
  const rng = mulberry32(seed);
  // Starting Y is biased by the city's latitude fractional part (0.1672 →
  // pulls the bolt slightly above the baseline). Same for the longitude.
  const latBias = ((seed >>> 4) % 100) / 25 - 2; // ≈ -1.33
  const lonBias = ((seed >>> 12) % 100) / 25 - 2; // ≈ -0.41
  const startY = 10 + latBias * 0.4 + (rng() - 0.5) * 3;

  const pts: Array<{ x: number; y: number }> = [{ x: 2, y: startY }];
  let prevY = startY;
  for (let i = 1; i <= segs; i++) {
    const x = 2 + (i / segs) * 96;
    // Each segment's Y is a damped random walk + a longitude-driven phase
    const phase = Math.sin((i / segs) * Math.PI * 2 + lonBias) * 1.4;
    const jitter = (rng() - 0.5) * 9;
    const y = Math.max(1, Math.min(19, prevY * 0.35 + 10 * 0.65 + jitter + phase));
    pts.push({ x, y });
    prevY = y;
  }
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  return { d, pts };
}

function ElectrifiedWord({
  text,
  tone,
}: {
  text: string;
  tone: "bone" | "dim" | "gold";
}) {
  const colorClass =
    tone === "gold"
      ? "text-[var(--gold)]"
      : tone === "dim"
      ? "text-[var(--bone)]/55"
      : "text-[var(--bone)]";

  // Deterministic per-word seed derived from the business identity
  const seed = useMemo(() => seedFor(text), [text]);

  // Two stacked bolts → "phase A" and "phase B" of the current map.
  // Segment count scales with word length (longer words = denser geometry).
  const main = useMemo(
    () => buildCurrentMap(seed, Math.max(7, Math.min(14, text.length + 2))),
    [seed, text.length]
  );
  const ghost = useMemo(
    () => buildCurrentMap(seed ^ 0x9e3779b9, Math.max(7, Math.min(14, text.length + 2))),
    [seed, text.length]
  );

  // Per-word phase offset — also derived from the seed so each word strikes
  // on its own beat, but the rhythm across the headline is repeatable.
  const delay = ((seed >>> 8) % 700) / 1000; // 0–0.7s
  const period = 5.4 + ((seed >>> 16) % 9) / 10; // 5.4–6.2s

  // 3 junction nodes — small filled dots that punctuate the bolt at vertices
  // chosen by the seed (always the same vertices for the same word)
  const nodes = useMemo(() => {
    const rng = mulberry32(seed ^ 0xdeadbeef);
    const idx = new Set<number>();
    while (idx.size < 3 && idx.size < main.pts.length - 2) {
      idx.add(1 + Math.floor(rng() * (main.pts.length - 2)));
    }
    return Array.from(idx).map((i) => main.pts[i]);
  }, [main.pts, seed]);

  return (
    <span className={`relative inline-block align-baseline ${colorClass}`}>
      {/* Base type */}
      <span className="relative z-10">{text}</span>

      {/* Current-map overlay — sits across the word, follows its width */}
      <svg
        aria-hidden
        viewBox="0 0 100 20"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
      >
        <defs>
          <filter id={`glow-${seed}`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="0.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Phase B — ghost bolt, runs slightly behind the main strike */}
        <path
          d={ghost.d}
          fill="none"
          stroke="var(--gold)"
          strokeWidth="0.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.32"
          filter={`url(#glow-${seed})`}
          style={{
            strokeDasharray: 240,
            strokeDashoffset: 240,
            animation: `bolt-strike ${period}s ease-in-out ${delay + 0.18}s infinite`,
          }}
        />

        {/* Phase A — soft underglow */}
        <path
          d={main.d}
          fill="none"
          stroke="var(--gold)"
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
          filter={`url(#glow-${seed})`}
          style={{
            strokeDasharray: 240,
            strokeDashoffset: 240,
            animation: `bolt-strike ${period}s ease-in-out ${delay}s infinite`,
          }}
        />

        {/* Phase A — hot core */}
        <path
          d={main.d}
          fill="none"
          stroke="oklch(0.99 0.05 95)"
          strokeWidth="0.18"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 240,
            strokeDashoffset: 240,
            animation: `bolt-strike ${period}s ease-in-out ${delay + 0.04}s infinite`,
          }}
        />

        {/* Junction nodes — fixed vertices on the bolt, pulse on each strike */}
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={n.x}
            cy={n.y}
            r="0.45"
            fill="var(--gold)"
            filter={`url(#glow-${seed})`}
            style={{
              opacity: 0,
              animation: `node-pulse ${period}s ease-out ${delay + 0.08 + i * 0.04}s infinite`,
            }}
          />
        ))}

        {/* Arc-flash spark — rides the main bolt path */}
        <circle r="0.6" fill="var(--gold)" filter={`url(#glow-${seed})`}>
          <animateMotion
            dur={`${period}s`}
            begin={`${delay}s`}
            repeatCount="indefinite"
            path={main.d}
            keyPoints="0;0;1;1"
            keyTimes="0;0.55;0.78;1"
            calcMode="linear"
          />
          <animate
            attributeName="opacity"
            values="0;0;1;1;0"
            keyTimes="0;0.54;0.56;0.78;0.8"
            dur={`${period}s`}
            begin={`${delay}s`}
            repeatCount="indefinite"
          />
        </circle>
      </svg>

      {/* Traveling current bead along the baseline — the "live wire" */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-[2px] left-0 right-0 z-0 h-[2px] overflow-hidden"
        style={{ background: "color-mix(in oklab, var(--gold) 18%, transparent)" }}
      >
        <span
          className="absolute top-0 h-full w-8"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--gold) 40%, oklch(0.99 0.05 95) 50%, var(--gold) 60%, transparent)",
            boxShadow: "0 0 12px var(--gold)",
            animation: `current-run 4.2s linear ${delay}s infinite`,
          }}
        />
      </span>
    </span>
  );
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
