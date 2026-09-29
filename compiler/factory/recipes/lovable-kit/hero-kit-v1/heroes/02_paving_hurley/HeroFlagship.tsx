import { Link } from "@tanstack/react-router";
import { Phone, ArrowUpRight, Snowflake, Sun, Leaf, CloudSun, MapPin, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ASSETS — replace with your CDN URLs (see ASSETS.md)
const heroPikes = "/img/hero-pikes.jpg";        // main cinematic photo (1600×1920, portrait)
const asphaltMacro = "/img/asphalt-macro.jpg";  // aggregate texture for atlas floor

// BUSINESS DATA — replace with new client's data
const BUSINESS = {
  founded: 1976,
  phone: "(555) 555-5555",
  phoneHref: "tel:+15555555555",
  trust: { bbb: { accreditedSince: "2019" } },
};

/* -----------------------------------------------------------
 * Hurley Asphalt — Flagship Hero
 *
 * Unique signature:
 *  1. Pikes Peak topographic SVG with animated contour lines
 *  2. Live seasonal-logic intelligence widget (Front Range paving window)
 *  3. Animated service-area constellation with REAL client locations
 *  4. Parallax Ken-Burns hero photo + macro accent
 *  5. Continuously animated lane-stripe motion (brand motif)
 *  6. Kinetic counter strip
 *  7. Mouse-reactive ember spotlight
 * ----------------------------------------------------------- */

function getSeason(month: number) {
  if (month >= 4 && month <= 9)
    return { key: "prime", icon: Sun, label: "Prime paving window", window: "May → September", detail: "Surface temps and overnight lows favor proper compaction and cure. Schedule new pours and full reclaims now.", next: "Best window — book this week", tone: "ember" as const };
  if (month === 10 || month === 3)
    return { key: "shoulder", icon: CloudSun, label: "Shoulder season", window: "March & October", detail: "Daytime warmth still allows sealcoating and most repair work. Pour scheduling tightens — call to lock a slot.", next: "Sealcoat & repair window", tone: "ember" as const };
  if (month === 11 || month === 2)
    return { key: "transition", icon: Leaf, label: "Cold-edge season", window: "November & February", detail: "Crack-fill and emergency repair only. New paving paused until ground temps recover. Reserve your spring slot now.", next: "Reserve your spring slot", tone: "asphalt" as const };
  return { key: "freeze", icon: Snowflake, label: "Freeze-thaw season", window: "December & January", detail: "Active freeze-thaw can damage unsealed asphalt. Booking the early-season calendar for crack-fill in March and pours starting May.", next: "Get on the spring list", tone: "asphalt" as const };
}

// Real client locations on a stylized regional map — REPLACE per new client
const SERVICE_PINS = [
  { x: 52, y: 22, name: "Town of Monument", note: "Triview Metro District" },
  { x: 78, y: 55, name: "Hurley Shop · Peyton", note: "14200 Judge Orr Rd", anchor: true },
  { x: 38, y: 48, name: "Centura / Penrose", note: "Colorado Springs" },
  { x: 44, y: 60, name: "Kissing Camels", note: "Colorado Springs" },
  { x: 58, y: 38, name: "Black Forest", note: "Residential acreage" },
  { x: 18, y: 68, name: "City of Woodland Park", note: "Majestic Park" },
  { x: 62, y: 78, name: "McDonald's Pueblo", note: "Commercial lot" },
  { x: 70, y: 30, name: "Falcon", note: "Residential corridor" },
];

export function HeroFlagship() {
  const month = new Date().getMonth() + 1;
  const season = getSeason(month);
  const SeasonIcon = season.icon;
  const heroRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [activePin, setActivePin] = useState<number | null>(1);
  const [mouse, setMouse] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActivePin((p) => (((p ?? 0) + 1) % SERVICE_PINS.length)), 2600);
    return () => clearInterval(t);
  }, [paused]);

  const active = activePin !== null ? SERVICE_PINS[activePin] : null;
  const yearsServing = new Date().getFullYear() - BUSINESS.founded;

  return (
    <section
      ref={heroRef}
      className="relative isolate overflow-hidden bg-asphalt"
      onMouseMove={(e) => {
        const r = heroRef.current?.getBoundingClientRect();
        if (!r) return;
        setMouse({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
    >
      {/* LAYER 1: Cinematic photo w/ Ken Burns + parallax */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 will-change-transform"
             style={{ transform: `translate3d(0, ${scrollY * 0.25}px, 0) scale(1.08)` }}>
          <img src={heroPikes} alt="Asphalt road toward Pikes Peak at golden hour"
               className="h-full w-full object-cover ken-burns" width={1600} height={1920} fetchPriority="high" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-asphalt/80 via-asphalt/55 to-asphalt/95" />
        <div className="absolute inset-0 bg-gradient-to-r from-asphalt/85 via-transparent to-asphalt/40" />
        <div className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-500"
             style={{ background: `radial-gradient(600px circle at ${mouse.x}% ${mouse.y}%, oklch(0.55 0.21 28 / 0.18), transparent 60%)` }} />
        <div className="grain absolute inset-0 opacity-40" />
      </div>

      {/* LAYER 2: Animated topographic contour SVG — replace with regional silhouette for new client */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
           viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="topoGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.97 0.008 75)" stopOpacity="0.0" />
            <stop offset="50%" stopColor="oklch(0.97 0.008 75)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.55 0.21 28)" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {Array.from({ length: 14 }).map((_, i) => {
          const y = 200 + i * 36; const amp = 60 + i * 6; const freq = 0.006 + i * 0.0004;
          const path = Array.from({ length: 73 }, (_, j) => {
            const x = j * 20; const yy = y + Math.sin(x * freq + i) * amp - i * 4;
            return `${j === 0 ? "M" : "L"}${x} ${yy}`;
          }).join(" ");
          return (
            <path key={i} d={path} fill="none" stroke="url(#topoGrad)"
                  strokeWidth={i === 6 ? 1.2 : 0.6} strokeDasharray={i === 6 ? "0" : "3 6"}
                  className="topo-line" style={{ animationDelay: `${i * 0.15}s` }} />
          );
        })}
      </svg>

      {/* LAYER 3: Lane-stripe sweep — vertical-specific motif */}
      <div className="pointer-events-none absolute inset-x-0 top-[58%] h-[10px] overflow-hidden opacity-50">
        <div className="lane-sweep h-full w-[200%]" />
      </div>

      {/* MAIN GRID */}
      <div className="relative mx-auto grid min-h-[760px] max-w-[1360px] grid-cols-12 gap-6 px-5 pt-20 pb-32 md:min-h-[880px] md:gap-10 md:px-10 md:pt-28 md:pb-40">
        {/* LEFT: editorial copy */}
        <div className="col-span-12 lg:col-span-7 xl:col-span-7">
          <div className="reveal flex items-center gap-3 text-bone/70">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-ember" />
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase">COLORADO SPRINGS · PEYTON · PIKES PEAK</span>
            <span className="h-px flex-1 bg-bone/15" />
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-bone/50">50+ YEARS · SINCE {BUSINESS.founded}</span>
          </div>

          <h1 className="reveal reveal-delay-1 mt-8 text-bone">
            <span className="block font-display text-[44px] font-normal leading-[0.95] tracking-tight md:text-[88px] lg:text-[112px]">Asphalt</span>
            <span className="block font-display text-[44px] font-normal italic leading-[0.95] tracking-tight text-ember md:text-[88px] lg:text-[112px]">built to outlast</span>
            <span className="block font-display text-[44px] font-normal leading-[0.95] tracking-tight md:text-[88px] lg:text-[112px]">a Colorado winter.</span>
          </h1>

          <p className="reveal reveal-delay-2 mt-8 max-w-xl text-[17px] leading-relaxed text-bone/80">
            <span className="text-bone">The oldest surviving asphalt company in Colorado Springs</span> — three generations of driveways, parking lots, sealcoating, and rubberized crack-fill. <span className="text-bone">No money up front. Payment on completion.</span>
          </p>

          <div className="reveal reveal-delay-3 mt-9 flex flex-wrap items-center gap-3">
            <a href={BUSINESS.phoneHref}
               className="ember-cta group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-ember px-7 py-4 text-[15px] font-semibold text-bone shadow-[var(--shadow-ember)] transition hover:brightness-110">
              <span className="ember-shine absolute inset-0 -translate-x-full" />
              <Phone className="relative h-4 w-4" />
              <span className="relative">Call {BUSINESS.phone}</span>
            </a>
            <Link to="/contact"
                  className="group inline-flex items-center gap-2 rounded-full border border-bone/25 bg-bone/[0.04] px-7 py-4 text-[15px] font-semibold text-bone backdrop-blur-md transition hover:border-bone/60 hover:bg-bone/[0.08]">
              Get a free estimate
              <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <span className="ml-2 inline-flex items-center gap-2 rounded-full border border-bone/15 bg-bone/[0.03] px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-bone/60">
              <Sparkles className="h-3 w-3 text-ember" /> BBB A+ · Accredited since {BUSINESS.trust.bbb.accreditedSince}
            </span>
          </div>

          <div className="reveal reveal-delay-4 mt-14 grid max-w-2xl grid-cols-3 gap-6 border-t border-bone/15 pt-8">
            <Counter value={yearsServing} suffix="+" label="Years on Front Range asphalt" />
            <Counter value={3} label="Generations, family-run" />
            <Counter value={12} suffix="+" label="Verified institutional clients" />
          </div>
        </div>

        {/* RIGHT: Service-Area Atlas (the signature device) */}
        <div className="reveal reveal-delay-3 col-span-12 lg:col-span-5">
          <div className="atlas-card relative overflow-hidden rounded-[28px] border border-bone/15 bg-asphalt/60 p-5 backdrop-blur-2xl md:p-6"
               onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-bone/55">Service Atlas</span>
                <p className="mt-1 font-display text-[19px] text-bone">Real jobs across the region</p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-bone/[0.06] px-2.5 py-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
                <span className="font-mono text-[10px] tracking-wider uppercase text-bone/70">Live verified</span>
              </div>
            </div>

            {/* Stylized regional map with pins */}
            <div className="relative mt-4 aspect-[5/4] w-full overflow-hidden rounded-2xl border border-bone/10 bg-[oklch(0.10_0.012_250)]">
              <img src={asphaltMacro} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-luminosity" loading="lazy" aria-hidden="true" />
              <svg viewBox="0 0 500 400" className="absolute inset-0 h-full w-full">
                <defs>
                  <linearGradient id="ridgeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.97 0.008 75)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="oklch(0.97 0.008 75)" stopOpacity="0" />
                  </linearGradient>
                  <radialGradient id="peakGlow" cx="0.3" cy="0.2" r="0.5">
                    <stop offset="0%" stopColor="oklch(0.55 0.21 28)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="oklch(0.55 0.21 28)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <rect width="500" height="400" fill="url(#peakGlow)" />
                {/* Ridgeline — replace path for new region silhouette */}
                <path d="M0,260 L40,250 L80,235 L120,220 L150,195 L180,160 L210,120 L240,90 L260,75 L285,95 L320,140 L355,180 L390,210 L430,235 L470,250 L500,260 L500,400 L0,400 Z"
                      fill="url(#ridgeGrad)" stroke="oklch(0.97 0.008 75 / 0.4)" strokeWidth="1" />
                <path d="M0,300 L60,290 L110,280 L160,265 L210,245 L260,250 L310,240 L360,255 L410,270 L460,285 L500,295 L500,400 L0,400 Z"
                      fill="oklch(0.97 0.008 75 / 0.06)" stroke="oklch(0.97 0.008 75 / 0.18)" strokeWidth="0.8" />
                {/* Route lines from anchor to each pin */}
                <g stroke="oklch(0.55 0.21 28 / 0.5)" strokeWidth="1.2" strokeDasharray="4 4" fill="none">
                  {SERVICE_PINS.filter((p) => !p.anchor).map((p, i) => {
                    const shop = SERVICE_PINS.find((s) => s.anchor)!;
                    return <line key={i} x1={shop.x * 5} y1={shop.y * 4} x2={p.x * 5} y2={p.y * 4}
                                 className="atlas-route" style={{ animationDelay: `${i * 0.15}s` }} />;
                  })}
                </g>
              </svg>

              {SERVICE_PINS.map((pin, i) => {
                const isActive = activePin === i;
                return (
                  <button key={i} type="button" onMouseEnter={() => setActivePin(i)} onClick={() => setActivePin(i)}
                          aria-label={pin.name} className="group absolute -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
                    {pin.anchor ? (
                      <span className="relative flex h-6 w-6 items-center justify-center">
                        <span className="absolute inset-0 animate-ping rounded-full bg-ember/40" />
                        <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ember ring-2 ring-bone shadow-[var(--shadow-ember)]">
                          <MapPin className="h-2.5 w-2.5 text-bone" />
                        </span>
                      </span>
                    ) : (
                      <span className={`block h-2.5 w-2.5 rounded-full transition-all duration-300 ${isActive ? "scale-150 bg-ember ring-4 ring-ember/30" : "bg-bone/70 ring-2 ring-asphalt"}`} />
                    )}
                  </button>
                );
              })}

              {active && (
                <div className="atlas-tooltip pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-bone/15 bg-asphalt/95 px-3 py-2 text-bone backdrop-blur"
                     style={{ left: `${active.x}%`, top: `${active.y}%` }}>
                  <div className="text-[12px] font-semibold">{active.name}</div>
                  <div className="font-mono text-[10px] tracking-wider uppercase text-bone/60">{active.note}</div>
                </div>
              )}

              <div className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-bone/20 bg-asphalt/60 font-mono text-[10px] text-bone/70 backdrop-blur">N↑</div>
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 font-mono text-[9px] tracking-wider uppercase text-bone/50">
                <span className="block h-px w-10 bg-bone/40" /><span>~25 mi</span>
              </div>
            </div>

            {/* Seasonal intelligence widget */}
            <div className="mt-4 grid grid-cols-5 items-center gap-4 rounded-xl border border-bone/10 bg-bone/[0.03] p-4">
              <div className={`col-span-1 flex h-12 w-12 items-center justify-center rounded-xl ${season.tone === "ember" ? "bg-ember text-bone shadow-[var(--shadow-ember)]" : "bg-bone/10 text-bone"}`}>
                <SeasonIcon className="h-5 w-5" />
              </div>
              <div className="col-span-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-semibold text-bone">{season.label}</p>
                  <span className="font-mono text-[10px] tracking-wider uppercase text-bone/50">{season.window}</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-bone/65">{season.detail}</p>
              </div>
            </div>

            {/* 12-month timeline strip */}
            <div className="mt-3">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-bone/[0.06]">
                {Array.from({ length: 12 }).map((_, i) => {
                  const m = i + 1;
                  const isCurrent = m === month;
                  const isPrime = m >= 5 && m <= 9;
                  const isShoulder = m === 3 || m === 4 || m === 10;
                  return (
                    <div key={m}
                         className={`flex-1 transition-all ${isCurrent ? "bg-ember scale-y-150" : isPrime ? "bg-bone/40" : isShoulder ? "bg-bone/25" : "bg-bone/10"}`}
                         title={new Date(2000, i, 1).toLocaleString("en", { month: "short" })} />
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[9px] tracking-wider text-bone/40">
                <span>JAN</span><span>APR</span><span>JUL</span><span>OCT</span><span>DEC</span>
              </div>
            </div>

            <Link to="/service-area"
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-bone/20 px-4 py-3 text-[13px] font-semibold text-bone transition hover:border-ember hover:bg-ember/10">
              Explore the full service area
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-ember/60 to-transparent" />
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] uppercase text-bone/40">
        Scroll · the work
      </div>
    </section>
  );
}

function Counter({ value, suffix = "", label }: { value: number; suffix?: string; label: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1400;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div>
      <div className="font-display text-[36px] leading-none text-bone md:text-[48px]">{n}<span className="text-ember">{suffix}</span></div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.2em] uppercase text-bone/55">{label}</p>
    </div>
  );
}
