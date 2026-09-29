import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Phone,
  Ruler,
  Hammer,
  Sparkles,
  CheckCircle2,
  Compass,
  Layers,
  Mountain,
  Sun,
  Wind,
  Snowflake,
  PlayCircle,
  MapPin,
} from "lucide-react";
import { CLIENT, PLAN, GALLERY, SPECIAL_MEDIA, media } from '@/lib/wss';
import { HeroMedia, useReducedMotion } from '@/components/site/HeroMedia';
const heroPlate=CLIENT.hero.poster;
const heroIso=SPECIAL_MEDIA.iso, heroBlueprint=SPECIAL_MEDIA.blueprint, heroDetailStone=SPECIAL_MEDIA.stone, heroDetailRail=SPECIAL_MEDIA.rail;
const craftHands=media('people') || media('about');
import { SITE, CITY_DETAILS, CITY_SLUGS } from "@/lib/site";
import { pageHead } from "@/lib/seo";


export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      title: SITE.name,
      description: SITE.shortDescription,
      path: "/",
    }),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <ServicesPreview />
      <ProcessSection />
      <FeaturedProjects />
      <CraftSection />
      <ServiceAreaSection />
      <ClosingCta />
    </>
  );
}

/* -------------------------------------------------------------- HERO */

// Stable seeded particles so SSR and CSR render identically.
const PARTICLES = Array.from({ length: 22 }, (_, i) => {
  // Deterministic pseudo-random so server === client output.
  const r = (n: number) => (Math.sin(i * 9.27 + n) + 1) / 2;
  return {
    left: `${(r(1) * 100).toFixed(2)}%`,
    bottom: `${(-10 + r(2) * 30).toFixed(2)}%`,
    size: 2 + Math.round(r(3) * 4),
    dx: `${(r(4) * 80 - 40).toFixed(0)}px`,
    dur: `${(14 + r(5) * 18).toFixed(1)}s`,
    delay: `${(-r(6) * 24).toFixed(1)}s`,
    opacity: 0.25 + r(7) * 0.55,
  };
});

function Hero() {
  const reduced = useReducedMotion();
  // All time-dependent / mouse / scroll state is mounted client-side ONLY,
  // gated by `mounted` so SSR markup matches first client paint.
  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState<string>("");
  const [scrollY, setScrollY] = useState(0);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    setMounted(!reduced);
    if (reduced) return;
    const updateTime = () => {
      const now = new Date();
      setToday(
        now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      );
    };
    updateTime();
    const t = window.setInterval(updateTime, 30_000);
    const onScroll = () => setScrollY(window.scrollY);
    const onMove = (e: MouseEvent) => {
      setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.clearInterval(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onMove);
    };
  }, [reduced]);

  const py = mounted ? scrollY * 0.25 : 0;
  const py2 = mounted ? scrollY * 0.12 : 0;
  const mx = mounted ? (mouse.x - 0.5) * 16 : 0;
  const my = mounted ? (mouse.y - 0.5) * 16 : 0;
  // 3D parallax tilt for the iso render plate
  const tiltX = mounted ? 8 + (mouse.y - 0.5) * -6 : 8;
  const tiltY = mounted ? -12 + (mouse.x - 0.5) * 10 : -12;

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-ink text-cream">
      {/* === LAYER 1 :: Cinematic dusk plate, slow pan + parallax === */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ transform: `translate3d(0, ${py * 0.4}px, 0)` }}
      >
        <HeroMedia />
        {/* Cinematic gradient stack */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_30%,transparent_0%,oklch(0.18_0.015_60/.55)_55%,oklch(0.12_0.012_55/.95)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-transparent to-ink/40" />
      </div>

      {/* === LAYER 1b :: Animated topographic contour lines (living background) === */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-[8] h-full w-full opacity-[0.18] mix-blend-screen"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="topoGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="oklch(0.7 0.16 50)" stopOpacity="0" />
            <stop offset="50%" stopColor="oklch(0.7 0.16 50)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.7 0.16 50)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="topo-pan" stroke="url(#topoGrad)" fill="none" strokeWidth="1">
          {Array.from({ length: 14 }).map((_, i) => {
            const y = 80 + i * 55;
            return (
              <path
                key={i}
                d={`M0 ${y} Q 200 ${y - 18} 400 ${y} T 800 ${y - 6} T 1200 ${y + 8} T 1600 ${y} L 3200 ${y} Q 3400 ${y - 18} 3600 ${y} T 4000 ${y - 6} T 4400 ${y + 8} T 4800 ${y}`}
              />
            );
          })}
        </g>
      </svg>

      {/* === LAYER 1c :: Floating ember particles (living air) === */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[7] overflow-hidden">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="drift absolute rounded-full bg-cedar"
            style={{
              left: p.left,
              bottom: p.bottom,
              width: p.size,
              height: p.size,
              opacity: mounted ? p.opacity : 0,
              filter: "blur(0.5px)",
              boxShadow: "0 0 12px oklch(0.7 0.16 50 / 0.65)",
              ["--dx" as string]: p.dx,
              ["--dur" as string]: p.dur,
              animationDelay: p.delay,
            }}
          />
        ))}
      </div>

      {/* === LAYER 2 :: Cursor-follow spotlight === */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 mix-blend-screen opacity-60"
        style={{
          background: `radial-gradient(460px 460px at ${(mounted ? mouse.x : 0.7) * 100}% ${(mounted ? mouse.y : 0.4) * 100}%, oklch(0.7 0.16 50 / 0.38), transparent 70%)`,
        }}
      />

      {/* === LAYER 3 :: Massive editorial wordmark bleeding off-canvas === */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[6vw] -left-[2vw] right-0 -z-[5] select-none"
        style={{ transform: `translate3d(${mx * 0.4}px, ${py2 * -0.3}px, 0)` }}
      >
        <div className="font-display text-[22vw] leading-[0.78] tracking-[-0.04em] text-cream/[0.06] whitespace-nowrap">
          {SITE.name}
        </div>
      </div>

      {/* === LAYER 4 :: Compass dial + co-ordinates rule (left edge) === */}
      <div className="pointer-events-none absolute left-4 top-0 hidden h-full flex-col items-center justify-between py-28 2xl:flex">
        <div className="flex flex-col items-center gap-3">
          {/* Animated compass dial */}
          <svg viewBox="0 0 80 80" className="h-14 w-14 text-cedar/70">
            <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="0.6" />
            <circle cx="40" cy="40" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="2 4" />
            <g className="slow-spin" style={{ transformOrigin: "40px 40px" }}>
              {Array.from({ length: 24 }).map((_, i) => (
                <line
                  key={i}
                  x1="40" y1="6" x2="40" y2={i % 6 === 0 ? 14 : 10}
                  stroke="currentColor"
                  strokeWidth={i % 6 === 0 ? 1.2 : 0.5}
                  transform={`rotate(${i * 15} 40 40)`}
                />
              ))}
              <polygon points="40,10 42.5,40 40,44 37.5,40" fill="oklch(0.7 0.16 50)" />
              <polygon points="40,70 42.5,40 40,36 37.5,40" fill="oklch(0.965 0.018 80 / 0.7)" />
            </g>
            <text x="40" y="42" textAnchor="middle" fontSize="6" fill="currentColor" letterSpacing="1">N</text>
          </svg>
          <span className="rotate-180 text-[10px] uppercase tracking-[0.4em] text-cream/45 [writing-mode:vertical-rl]">
            {SITE.city}
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.32em] text-cream/45">{SITE.city}</span>
          <span className="h-10 w-px bg-cream/30" />
        </div>
      </div>

      {/* === LAYER 5 :: Top tag rail === */}
      <div className="relative z-10 pt-24 md:pt-28">
        <div className="mx-auto max-w-[88rem] px-5 md:px-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10.5px] uppercase tracking-[0.32em] text-cream/65">
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-cedar/70" />
                <span className="relative h-2 w-2 rounded-full bg-cedar" />
              </span>
              {CLIENT.hero.eyebrow}
            </span>
            <span className="h-px w-8 bg-cedar/60" />
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3 w-3 text-cedar" />
              {SITE.city} · {SITE.region}
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Vol. 01 — The Outdoor Issue</span>
            <span className="hidden md:inline">·</span>
            {/* Render the date span only after mount to avoid hydration mismatch */}
            {mounted && today && (
              <span className="hidden md:inline">{today}</span>
            )}
          </div>
        </div>
      </div>

      {/* === LAYER 6 :: Headline — broken across a 12-col canvas === */}
      <div className="relative z-10 mx-auto max-w-[88rem] px-5 md:px-8 pt-10 md:pt-14 pb-10">
        <div className="grid grid-cols-12 gap-x-4 md:gap-x-6">
          <div className="col-span-12 md:col-span-2 mb-6 md:mb-0 md:pt-3 rise-in">
            <div className="text-[10px] uppercase tracking-[0.32em] text-cedar">№ 01</div>
            <div className="mt-2 text-[11px] leading-relaxed text-cream/55 max-w-[14ch]">
              {CLIENT.hero.eyebrow}
            </div>
          </div>

          <h1 className="col-span-12 md:col-span-10 xl:col-span-7 font-display text-cream tracking-[0.005em] leading-[0.94] text-[clamp(2.4rem,9vw,9.5rem)] rise-in" style={{ textShadow: "0 2px 24px oklch(0 0 0 / 0.55)" }}>
            {CLIENT.hero.line1}<br />
            <span className="inline-flex items-center gap-[0.18em]">
              <span className="italic font-normal text-cedar relative">
                {CLIENT.hero.emphasis}
                <svg
                  aria-hidden
                  className="absolute -bottom-[0.12em] left-0 w-full"
                  viewBox="0 0 300 12"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 8 Q 80 1 150 6 T 298 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-cedar/80 draft-stroke"
                    style={{ strokeDasharray: 320 }}
                  />
                </svg>
              </span>
              <span className="text-cream">,</span>
            </span>
            <br />
            <span className="block text-cream/85">{CLIENT.hero.line3}</span>
          </h1>
        </div>
      </div>

      {/* === LAYER 7 :: 3D ISO RENDER WIDGET — the showpiece === */}
      {heroIso && <div
        aria-hidden
        className="pointer-events-none absolute right-[1.5%] top-[18%] hidden xl:block w-[26rem] 2xl:w-[30rem] 2xl:right-[3%]"
        style={{ perspective: "1400px" }}
      >
        <div
          className="relative iso-float"
          style={{
            transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
            transformStyle: "preserve-3d",
            transition: "transform 280ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          {/* Holographic projection floor */}
          <div
            className="absolute left-1/2 top-[68%] h-40 w-[120%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,oklch(0.7_0.16_50/.35),transparent_70%)] blur-2xl"
            style={{ transform: "translateX(-50%) translateZ(-40px)" }}
          />
          {/* Wireframe SVG behind iso */}
          <svg
            viewBox="0 0 480 480"
            className="absolute inset-0 h-full w-full opacity-70"
            style={{ transform: "translateZ(-20px)" }}
          >
            <g fill="none" stroke="oklch(0.7 0.16 50)" strokeWidth="1">
              <path className="draft-stroke"   d="M60 320 L240 240 L420 320 L240 400 Z" />
              <path className="draft-stroke-2" d="M60 320 L60 260 L240 180 L420 260 L420 320" />
              <path className="draft-stroke-3" d="M240 240 L240 180" />
              <path className="draft-stroke-4" d="M120 290 L120 230 M180 265 L180 205 M300 265 L300 205 M360 290 L360 230" />
            </g>
            {/* Dimension marker */}
            <g stroke="oklch(0.965 0.018 80 / 0.5)" strokeWidth="0.6" fill="none">
              <line x1="60" y1="430" x2="420" y2="430" />
              <line x1="60" y1="425" x2="60" y2="435" />
              <line x1="420" y1="425" x2="420" y2="435" />
            </g>
            <text x="240" y="448" textAnchor="middle" fill="oklch(0.965 0.018 80 / 0.7)" fontSize="11" letterSpacing="2" fontFamily="Inter,sans-serif">
              
            </text>
          </svg>

          {/* Iso render image */}
          <img
            src={heroIso}
            alt="Isometric 3D rendering of a custom timber-roofed deck with stone columns and infinity glass railing"
            className="relative h-auto w-full"
            width={480}
            height={480}
            loading="eager"
            style={{ transform: "translateZ(40px)", filter: "drop-shadow(0 30px 50px oklch(0 0 0 / 0.7))" }}
          />

          {/* Floating annotation chip — top-right */}
          <div
            className="absolute right-[-4%] top-[8%] flex items-center gap-2 rounded-md border border-cream/15 bg-ink/85 px-3 py-1.5 text-[9.5px] uppercase tracking-[0.22em] text-cream/85 backdrop-blur"
            style={{ transform: "translateZ(80px)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cedar blink-soft" />
            3D model
          </div>

          {/* Floating annotation chip — bottom-left */}
          <div
            className="absolute left-[-3%] bottom-[14%] rounded-md border border-cream/15 bg-cream px-3 py-1.5 text-[9.5px] uppercase tracking-[0.22em] text-ink"
            style={{ transform: "translateZ(70px)" }}
          >
            Plate I
          </div>

          {/* Pulse marker on column */}
          <span
            className="absolute left-[28%] top-[42%] block h-3 w-3 rounded-full bg-cedar"
            style={{ transform: "translateZ(60px)" }}
          >
            <span className="pulse-ring absolute inset-0 rounded-full ring-2 ring-cedar" />
          </span>
        </div>
      </div>}

      {/* === LAYER 8 :: Floating tilted blueprint card (lg only, hidden xl+) === */}
      {heroBlueprint && <div
        className="pointer-events-none absolute right-[3%] top-[16%] hidden w-[14rem] -rotate-[7deg] rise-in-2 lg:block xl:hidden"
        style={{ transform: `rotate(-7deg) translate3d(${mx * -0.6}px, ${my * -0.4 + py2 * -0.3}px, 0)` }}
      >
        <div className="rounded-md border border-cream/15 bg-cream/95 p-2 shadow-[0_30px_60px_-20px_oklch(0_0_0/.7)] ring-1 ring-black/5">
          <img src={heroBlueprint} alt="Hand-drafted deck blueprint" className="aspect-[4/5] w-full object-cover" loading="lazy" width={420} height={520} />
          <div className="mt-2 flex items-center justify-between px-1 pb-1 text-[9px] uppercase tracking-[0.28em] text-ink/70">
            <span>Plate I</span>
            <span>Blueprint</span>
          </div>
        </div>
      </div>}

      {/* === LAYER 9 :: Stone+timber detail card, lower-left, organic clip-cut === */}
      {heroDetailStone && <div
        className="pointer-events-none absolute left-[2%] bottom-[20%] hidden w-[15rem] -rotate-[3deg] rise-in-4 lg:block"
        style={{ transform: `rotate(-3deg) translate3d(${mx * 0.5}px, ${my * 0.3 + py2 * 0.6}px, 0)` }}
      >
        <div className="clip-cut overflow-hidden border border-cream/15 shadow-[0_30px_60px_-20px_oklch(0_0_0/.8)]">
          <img src={heroDetailStone} alt="Stone column meeting timber framing" className="aspect-square w-full object-cover" loading="lazy" width={480} height={480} />
        </div>
        <div className="mt-2 px-0.5 text-[9px] uppercase tracking-[0.28em] text-cream/70">
          № 03 · Stone &amp; timber
        </div>
      </div>}

      {/* (LAYER 10 vertical tape removed — was overlapping headline at desktop widths) */}

      {/* === LAYER 11 :: CTA cluster + side editorial column === */}
      <div className="relative z-10 mx-auto max-w-[88rem] px-5 md:px-8 pb-10">
        <div className="grid grid-cols-12 gap-6 md:gap-8 items-end">
          <div className="col-span-12 md:col-span-7 lg:col-span-6 rise-in-3">
            <p className="max-w-xl text-base md:text-lg text-cream/80 leading-relaxed">
              {CLIENT.hero.support}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/contact"
                className="group inline-flex items-center gap-3 rounded-full bg-cedar pl-7 pr-2 py-2 text-sm font-semibold text-cream btn-magnetic shadow-cedar"
              >
                Contact
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-cream text-ink transition-transform group-hover:translate-x-0.5">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <a
                href={SITE.phoneHref}
                className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-6 py-3.5 text-sm font-medium text-cream hover:border-cedar hover:bg-cream/5 transition-colors"
              >
                <Phone className="h-4 w-4" />
                {SITE.phone}
              </a>
              <Link
                to="/projects"
                className="inline-flex items-center gap-2 px-2 py-2 text-sm font-medium text-cream/75 hover:text-cedar transition-colors"
              >
                <PlayCircle className="h-4 w-4" />
                View gallery
              </Link>
            </div>
          </div>

          {/* Live status widget — clip-arrow shape */}
          {(CLIENT.trust.badges.length > 0 || SITE.hoursNote) && <div className="col-span-12 md:col-span-5 lg:col-span-4 lg:col-start-9 rise-in-4">
            <div className="clip-arrow relative border border-cream/15 bg-ink/70 backdrop-blur p-5 pr-9">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.32em] text-cedar">Details</span>
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-cream/65">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 blink-soft" />
                  {SITE.hoursNote}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                {CLIENT.trust.badges.map(b=>({k:b.label,v:b.sublabel})).map((s) => (
                  <div key={s.k}>
                    <div className="font-display text-[1.7rem] text-cream leading-none">{s.k}</div>
                    <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-cream/55 leading-snug">
                      {s.v}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>}
        </div>
      </div>

      {/* === LAYER 12 :: Materials ticker (infinite, blade-clipped) === */}
      <div className="relative z-10 border-y border-white/10 bg-ink/70 backdrop-blur clip-blade">
        <div className="relative overflow-hidden">
          <div className="ticker flex w-max items-center gap-12 py-4 text-[11px] uppercase tracking-[0.32em] text-cream/55">
            {Array.from({ length: 2 }).map((_, dup) => (
              <div key={dup} className="flex items-center gap-12 pr-12">
                {SITE.services.map(s=>s.title).map((t) => (
                  <span key={t + dup} className="flex items-center gap-12">
                    <span className="text-cedar">✦</span>
                    <span>{t}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === LAYER 13 :: Bottom scroll cue === */}
      <div className="pointer-events-none absolute bottom-24 right-6 hidden flex-col items-center gap-2 lg:flex">
        <span className="text-[10px] uppercase tracking-[0.32em] text-cream/45">Scroll</span>
        <span className="relative h-12 w-px overflow-hidden bg-cream/15">
          <span className="absolute inset-x-0 top-0 h-1/2 bg-cedar shimmer-line" />
        </span>
      </div>

      {/* Hide the railing card from earlier — replaced by 3D widget on xl */}
      {heroDetailRail && <div
        className="pointer-events-none absolute right-[8%] top-[58%] hidden w-[10rem] rotate-[4deg] rise-in-3 lg:block xl:hidden"
        style={{ transform: `rotate(4deg) translate3d(${mx * 0.8}px, ${my * 0.5 + py2 * 0.4}px, 0)` }}
      >
        <div className="overflow-hidden rounded-md border border-cream/15 shadow-[0_30px_60px_-20px_oklch(0_0_0/.7)]">
          <img src={heroDetailRail} alt="Black powder-coated steel railing macro" className="aspect-[3/4] w-full object-cover" loading="lazy" width={336} height={448} />
        </div>
        <div className="mt-2 px-0.5 text-[9px] uppercase tracking-[0.28em] text-cream/70">
          № 02 · Powder-coated steel
        </div>
      </div>}
    </section>
  );
}

/* -------------------------------------------------- TRUST STRIP */

function TrustStrip() {
  const items = CLIENT.content.values.map(v=>({icon:CheckCircle2,title:v.title,copy:v.body}));
  if (!items.length) return null;

  return (
    <section className="bg-cream relative">
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-14 md:py-20 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <div key={it.title} className="group">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-ink text-cedar">
              <it.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-5 font-display text-xl text-ink">{it.title}</h3>
            <p className="mt-2 text-sm text-ink/70 leading-relaxed">{it.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------- SERVICES */

function ServicesPreview() {
  const featured = SITE.services.slice(0, 8);
  return (
    <section className="section bg-background">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="grid gap-10 md:grid-cols-12 items-end">
          <div className="md:col-span-7">
            <p className="eyebrow text-cedar">What we build</p>
            <h2 className="mt-3 font-display text-4xl md:text-6xl text-ink leading-[1.02] tracking-tight">
              Our <em className="text-cedar not-italic">services</em>.
            </h2>
          </div>
          <div className="md:col-span-5 md:pl-8">
            <p className="text-ink/70 leading-relaxed">
              {CLIENT.content.serviceIntro}
            </p>
            <Link
              to="/services"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-cedar"
            >
              Browse all services <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((svc) => (
            <Link
              key={svc.slug}
              to="/services/$slug"
              params={{ slug: svc.slug }}
              className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 hover:border-cedar/60 transition-colors"
            >
              <div className="font-display text-xl text-ink group-hover:text-cedar transition-colors">
                {svc.title}
              </div>
              <p className="mt-2 text-sm text-ink/70 flex-1">{svc.summary}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-cedar">
                Learn more <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- PROCESS */

function ProcessSection() {
  // No typed certified process steps in the copied contract.
  const steps: {n:string;title:string;copy:string}[] = [];
  if (!steps.length) return null;
  return (
    <section className="section relative bg-ink text-cream overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-30 bg-grad-glow" aria-hidden />
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="eyebrow text-cedar">The process</p>
          <h2 className="mt-3 font-display text-4xl md:text-6xl leading-[1.02] tracking-tight">
            The process
          </h2>
        </div>

        <ol className="mt-16 grid gap-px md:grid-cols-4 bg-white/10 rounded-2xl overflow-hidden">
          {steps.map((s) => (
            <li key={s.n} className="bg-ink p-7">
              <div className="flex items-center justify-between">
                <span className="font-display text-cedar text-2xl">{s.n}</span>
                <span className="h-px w-10 bg-cedar/50" />
              </div>
              <h3 className="mt-6 font-display text-2xl text-cream">{s.title}</h3>
              <p className="mt-3 text-sm text-cream/65 leading-relaxed">{s.copy}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------- FEATURED PROJECTS */

function FeaturedProjects() {
  if (!GALLERY.length) return null;
  return (
    <section className="section bg-background">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="eyebrow text-cedar">Gallery</p>
            <h2 className="mt-3 font-display text-4xl md:text-6xl text-ink leading-[1.02] tracking-tight">
              Project gallery
            </h2>
          </div>
          <Link to="/projects" className="text-sm font-semibold text-ink hover:text-cedar inline-flex items-center gap-2">
            See all projects <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-12 md:auto-rows-[14rem] lg:auto-rows-[16rem]">
          {GALLERY.slice(0,3).map((item,i)=><ProjectTile key={item.path}
            className={['md:col-span-7 md:row-span-2','md:col-span-5','md:col-span-5','md:col-span-4 md:row-span-1','md:col-span-8'][i]}
            src={item.path} title={'Gallery image '+(i+1)} tag="Gallery" description="" />)}
        </div>
      </div>
    </section>
  );
}

function ProjectTile({
  src, title, description, tag, className = "",
}: { src: string; title: string; description: string; tag: string; className?: string; }) {
  return (
    <article className={`group relative overflow-hidden rounded-2xl bg-ink min-h-[20rem] md:min-h-0 ${className}`}>
      <img
        src={src}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04] img-cinematic"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/65 to-ink/10" />
      <div className="relative h-full flex flex-col justify-end p-5 md:p-6 text-cream">
        <span className="self-start inline-flex items-center rounded-full bg-cedar px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-cedar">{tag}</span>
        <h3 className="mt-2 font-display text-xl md:text-2xl text-cream" style={{ textShadow: "0 2px 16px oklch(0 0 0 / 0.6)" }}>{title}</h3>
        <p className="mt-1.5 text-sm text-cream/90 max-w-md" style={{ textShadow: "0 1px 8px oklch(0 0 0 / 0.5)" }}>{description}</p>
      </div>
    </article>
  );
}

/* -------------------------------------------------- CRAFT */

function CraftSection() {
  return (
    <section className="section relative bg-cream">
      <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-12 md:grid-cols-12 items-center">
        {craftHands && <div className="md:col-span-6 relative">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
            {craftHands && <img src={craftHands} alt={SITE.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover img-cinematic" />}
          </div>
          {CLIENT.trust.reviews[0] && <div className="absolute -right-4 -bottom-6 md:right-10 md:-bottom-10 hidden md:block w-56 rounded-2xl bg-ink p-5 text-cream shadow-cedar">
            <div className="eyebrow text-cedar">Client feedback</div>
            <p className="mt-3 text-sm text-cream/80 leading-relaxed">
              {CLIENT.trust.reviews[0]?.text}
            </p>
            <a href={CLIENT.trust.reviews[0].sourceUrl} className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-cream/50">{CLIENT.trust.reviews[0].author}</a>
          </div>}
        </div>}

        <div className={craftHands ? "md:col-span-6 md:pl-6" : "md:col-span-12"}>
          <p className="eyebrow text-cedar">Craft &amp; care</p>
          <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05] tracking-tight">
            {CLIENT.content.whyHeadline || "About us"}
          </h2>
          <p className="mt-6 text-ink/75 leading-relaxed">
            {CLIENT.content.about}
          </p>
          <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm text-ink/85">
            {SITE.services.map(s=>s.title).map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-cedar mt-0.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          <Link to="/about" className="mt-10 inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink hover:bg-ink hover:text-cream transition-colors">
            About {SITE.name} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- SPOKANE */

function ServiceAreaSection() {
  const seasons = CLIENT.content.seasonalNote ? [{icon:Sun,title:'Seasonal note',copy:CLIENT.content.seasonalNote}] : [];
  if (!CITY_SLUGS.length && !seasons.length) return null;
  return (
    <section className="section bg-background">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="grid gap-10 md:grid-cols-12 items-end">
          <div className="md:col-span-6">
            <p className="eyebrow text-cedar">Service area</p>
            <h2 className="mt-3 font-display text-4xl md:text-6xl text-ink leading-[1.02] tracking-tight">
              {SITE.city}, {SITE.region}
            </h2>
          </div>
          <div className="md:col-span-6 md:pl-8">
            <p className="text-ink/75 leading-relaxed">
              {PLAN.content?.['service-area'] || ''}
            </p>
            <Link to="/service-area" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-cedar">
              Where we work <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {seasons.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-7">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-ink text-cedar">
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-display text-2xl text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-ink/70 leading-relaxed">{s.copy}</p>
            </div>
          ))}
        </div>

        <div className="mt-14">
          <p className="eyebrow text-cedar">Cities we build in</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {CITY_SLUGS.map((slug) => (
              <li key={slug}>
                <Link
                  to="/service-area/$city"
                  params={{ city: slug }}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-ink/80 hover:border-cedar/60 hover:text-cedar transition-colors"
                >
                  <MapPin className="h-3 w-3 text-cedar" /> {CITY_DETAILS[slug].city}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- CLOSING CTA */

function ClosingCta() {
  return (
    <section className="relative bg-ink text-cream overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-20 bg-grad-cedar" aria-hidden />
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-28 grid gap-10 md:grid-cols-12 items-end">
        <div className="md:col-span-8">
          <h2 className="font-display text-4xl md:text-6xl leading-[1.02] tracking-tight">
            {CLIENT.content.ctaHeadline || "Contact"}
          </h2>
          <p className="mt-5 max-w-xl text-cream/75">
            {CLIENT.content.ctaBody}
          </p>
        </div>
        <div className="md:col-span-4 flex flex-col gap-3">
          <Link to="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-cedar px-6 py-4 text-sm font-semibold text-cream btn-magnetic shadow-cedar">
            Contact <ArrowRight className="h-4 w-4" />
          </Link>
          <a href={SITE.phoneHref} className="inline-flex items-center justify-center gap-2 rounded-full border border-cream/25 px-6 py-4 text-sm font-medium text-cream">
            <Phone className="h-4 w-4" /> {SITE.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
