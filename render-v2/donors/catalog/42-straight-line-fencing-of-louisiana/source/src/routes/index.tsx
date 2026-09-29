import { site } from "@/wss/bridge";
import { HeroMedia } from "@/wss/HeroMedia";
import { useReducedMotion } from "motion/react";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { resolveRoute } from "@/wss/model";
import { CertifiedCopy } from "@/wss/CertifiedCopy";

import { CustomCursor } from "@/components/site/CustomCursor";
import { Curtain } from "@/components/site/Curtain";
import { SmoothScroll } from "@/components/site/SmoothScroll";
import { StickyNav } from "@/components/site/StickyNav";
import { Reveal, WordReveal, Hairline } from "@/components/site/Reveal";

export default function Index() {
  return (
    <div id="top" className="relative bg-background text-foreground">
      <Curtain />
      <SmoothScroll />
      <CustomCursor />
      <StickyNav />
      <FixedGrain />

      <Hero />
      <Intro />
      <Services />
      {site.content.values.length > 0 && <Philosophy />}
      {site.gallery.length > 0 && <Work />}
      {site.process.length > 0 && <Process />}
      {(site.areas.length > 0 || site.mapUrl || site.socials.length > 0 || site.localCopy) && <Local />}
      <Quote />
      {site.faqs.length > 0 && <Faq />}
      <Footer />
    </div>
  );
}

// Compiler-declared secondary pages reuse this donor's original section layouts.
export function DonorPage({ section }: { section: 'about' | 'contact' | 'services' | 'service-area' | 'gallery' }) {
  return <div id="top" className="relative bg-background text-foreground">
    <SmoothScroll /><CustomCursor /><FixedGrain />
    <header className="relative z-10 px-6 md:px-10 py-8"><a href="/" className="flex items-center gap-4"><span className="logo-mark"><img src={site.identity.logoOnLight} alt={site.identity.businessName} /></span><span className="eyebrow">{site.identity.businessName}</span></a></header>
    {section === 'about' && <Intro body={site.plan.content?.about || site.content.about} />}
    {section === 'contact' && <Quote body={site.plan.content?.contact || site.content.ctaBody} />}
    {section === 'services' && <Services />}
    {section === 'service-area' && <Local />}
    {section === 'gallery' && <Work />}
    <Footer />
  </div>;
}

/* ---------------- Grain ---------------- */

function FixedGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1]"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.92 0 0 0 0 0.86 0 0 0 0 0.74 0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>\")",
        opacity: "var(--grain-opacity)",
        mixBlendMode: "overlay",
      }}
    />
  );
}

/* ---------------- Hero ---------------- */

function Hero() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yBg = useTransform(scrollYProgress, [0, 1], ["0%", "35%"]);
  const yMid = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const yFg = useTransform(scrollYProgress, [0, 1], ["0%", "-8%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  // mouse parallax
  const [mp, setMp] = useState({ x: 0, y: 0 });
  const onMove = (e: React.MouseEvent) => {
    if (reduced) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMp({
      x: ((e.clientX - r.left) / r.width - 0.5) * 12,
      y: ((e.clientY - r.top) / r.height - 0.5) * 12,
    });
  };

  const chips = site.chips;

  return (
    <section
      ref={ref}
      onMouseMove={onMove}
      className="relative h-[100svh] w-full overflow-hidden"
      style={{ background: "var(--hero-ink)", color: "var(--hero-bone)" }}
    >
      {/* Layer 1: image with mouse parallax + scroll parallax + slow zoom */}
      <motion.div className="absolute inset-0" style={{ y: reduced ? 0 : yBg }}>
        <motion.div
          className="absolute -inset-8"
          animate={{ x: mp.x, y: mp.y }}
          transition={{ type: "spring", stiffness: 40, damping: 18 }}
        >
          <HeroMedia />
        </motion.div>
        {/* multi-layer scrim — keeps photo readable while text stays crisp */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, oklch(0.08 0.01 60 / 0.55) 0%, oklch(0.08 0.01 60 / 0.20) 35%, oklch(0.08 0.01 60 / 0.45) 70%, oklch(0.06 0.01 60 / 0.92) 100%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 18% 60%, oklch(0.06 0.01 60 / 0.55) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 30%, transparent 0%, oklch(0.08 0.01 60 / 0.25) 60%, oklch(0.06 0.01 60 / 0.88) 100%)",
          }}
        />
      </motion.div>

      {/* Layer 2: drifting horizon glow */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          y: reduced ? 0 : yMid,
          background:
            "radial-gradient(60% 30% at 50% 70%, oklch(0.78 0.10 75 / 0.18), transparent 70%)",
        }}
      />

      {/* hairline frame */}
      <div
        className="pointer-events-none absolute inset-6 md:inset-10 border z-[3]"
        style={{ borderColor: "oklch(0.96 0.012 80 / 0.22)" }}
      />

      {/* Animated SVG corner brackets */}
      <svg className="pointer-events-none absolute inset-6 md:inset-10 z-[4] w-[calc(100%-3rem)] md:w-[calc(100%-5rem)] h-[calc(100%-3rem)] md:h-[calc(100%-5rem)]" aria-hidden>
        <g stroke="var(--hero-brass)" strokeWidth="1.2" fill="none" style={{ strokeDasharray: 60, strokeDashoffset: 60, animation: "draw-line 1.6s 0.6s ease-out forwards" }}>
          <path d="M0,30 L0,0 L30,0" />
        </g>
        <g stroke="var(--hero-brass)" strokeWidth="1.2" fill="none" style={{ strokeDasharray: 60, strokeDashoffset: 60, animation: "draw-line 1.6s 0.8s ease-out forwards" }}>
          <svg x="100%" overflow="visible"><path d="M0,30 L0,0 L-30,0" /></svg>
        </g>
      </svg>

      <motion.div
        className="relative z-10 flex h-full flex-col justify-between px-6 md:px-10 py-12 md:py-16"
        style={{ opacity: reduced ? 1 : opacity, y: reduced ? 0 : yFg }}
      >
        <div className="flex items-start justify-between">
          <a href="#top" className="flex items-center gap-4 group" data-cursor="link" aria-label={site.identity.businessName}>
            <span className="logo-mark logo-mark--hero">
              <img src={site.identity.logoOnDark} width={52} height={52} alt={site.identity.businessName} loading="eager" decoding="async" />
            </span>
            <span className="eyebrow hero-text-shadow hidden sm:inline" style={{ color: "oklch(0.94 0.06 75 / 0.95)" }}>{site.hero.eyebrow}</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm" style={{ color: "var(--hero-bone)" }}>
            <a href="#services" data-cursor="link" className="underline-sweep">Services</a>
            {site.gallery.length > 0 && <a href="#work" data-cursor="link" className="underline-sweep">Work</a>}
            {site.process.length > 0 && <a href="#process" data-cursor="link" className="underline-sweep">Process</a>}
            <a href="#quote" data-cursor="link" className="underline-sweep">Quote</a>
            <a href={site.identity.phoneTel} data-cursor="link" className="link-arrow" style={{ color: "var(--hero-brass)" }}>
              {site.identity.phoneDisplay}
            </a>
          </div>
        </div>

        <div className="max-w-[80rem]">
          <div className="mb-8 flex items-center gap-4">
            <span className="block h-px w-16" style={{ background: "var(--hero-brass)" }} />
            <span className="eyebrow hero-text-shadow" style={{ color: "var(--hero-brass)" }}>§ 01 · {site.identity.businessName}</span>
          </div>
          <h1 className="font-serif hero-text-shadow text-[clamp(2.6rem,7.8vw,7.8rem)] leading-[0.94] tracking-[-0.03em] text-balance">
            <WordReveal text={site.hero.line1} />
            <br />
            <span
              className="hero-text-shadow"
              style={{
                fontStyle: "italic",
                color: "oklch(1 0 0)",
                filter: "drop-shadow(0 2px 6px oklch(0 0 0 / 0.9)) drop-shadow(0 0 16px oklch(0 0 0 / 0.5))",
              }}
            >
              <WordReveal text={site.hero.emphasis} delay={0.25} />
            </span>{" "}
            
            <br />
            <WordReveal text={site.hero.line3} delay={0.55} />
          </h1>

          {/* animated underline draw */}
          <svg width="180" height="10" viewBox="0 0 180 10" className="mt-6" aria-hidden>
            <path
              d="M0 5 Q 45 0, 90 5 T 180 5"
              stroke="var(--hero-brass)"
              strokeWidth="1.2"
              fill="none"
              style={{ strokeDasharray: 220, strokeDashoffset: 220, animation: "draw-line 1.8s 1.2s ease-out forwards" }}
            />
          </svg>

          <Reveal delay={0.9}>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed hero-text-shadow" style={{ color: "oklch(0.97 0.01 80 / 0.92)" }}>
              {site.hero.support}
            </p>
          </Reveal>

          {/* floating chips */}
          {chips.length > 0 && <Reveal delay={1.0} className="mt-8 flex flex-wrap gap-2">
            <>
              {chips.map((c, i) => (
                <span
                  key={c}
                  className="float-y eyebrow inline-flex items-center gap-2 border px-3 py-1.5"
                  style={{
                    borderColor: "oklch(0.96 0.01 80 / 0.45)",
                    color: "oklch(0.97 0.01 80 / 0.98)",
                    background: "oklch(0.06 0.01 60 / 0.35)",
                    backdropFilter: "blur(4px)",
                    animationDelay: `${i * 0.4}s`,
                  }}
                >
                  <span className="inline-block w-1 h-1 rounded-full" style={{ background: "var(--hero-brass)" }} />
                  {c}
                </span>
              ))}
            </>
          </Reveal>}

          <Reveal delay={1.15} className="mt-10 flex flex-wrap items-center gap-6">
            <a
              href={site.identity.phoneTel}
              data-cursor="link"
              className="group inline-flex items-center gap-3 border px-6 py-4 text-sm tracking-wide uppercase transition-colors"
              style={{
                letterSpacing: "0.18em",
                borderColor: "oklch(0.96 0.01 80 / 0.5)",
                color: "var(--hero-bone)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--hero-bone)"; (e.currentTarget as HTMLElement).style.color = "var(--hero-ink)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--hero-bone)"; }}
            >
              Request Estimate <span className="transition-transform group-hover:translate-x-1">→</span>
            </a>
            <a href="#quote" data-cursor="link" className="link-arrow text-sm uppercase tracking-[0.18em]" style={{ color: "var(--hero-brass)" }}>
              Send Project Details
            </a>
          </Reveal>
        </div>

        <div className="flex items-end justify-between text-xs uppercase tracking-[0.2em] hero-text-shadow" style={{ color: "oklch(0.96 0.01 80 / 0.85)" }}>
          <div className="flex items-center gap-2">
            <span className="inline-block h-px w-6" style={{ background: "var(--hero-brass)" }} />
            {site.identity.city}, {site.identity.state}
          </div>
          <div className="hidden md:block">{site.hours}</div>
          <a href="#intro" data-cursor="link" className="flex items-center gap-3">
            Scroll
            <span className="relative block h-8 w-px overflow-hidden" style={{ background: "oklch(0.96 0.01 80 / 0.3)" }}>
              <span className="absolute inset-x-0 top-0 h-2 w-px" style={{ background: "var(--hero-brass)", animation: "travel-dot 2.4s ease-in-out infinite" }} />
            </span>
          </a>
        </div>
      </motion.div>

      {/* slow marquee strip across bottom */}
      <div className="absolute bottom-0 inset-x-0 z-[5] overflow-hidden py-3 border-t" style={{ borderColor: "oklch(0.96 0.01 80 / 0.12)", background: "oklch(0.08 0.01 60 / 0.55)", backdropFilter: "blur(8px)" }}>
        <div className="marquee-track gap-10 text-xs uppercase tracking-[0.3em]" style={{ width: "max-content", color: "oklch(0.97 0.01 80 / 0.92)" }}>
          {Array.from({ length: 3 }).flatMap((_, k) =>
            site.services.map(s => s.name).map((w, i) => (
              <span key={`${k}-${i}`} className="inline-flex items-center gap-10">
                <span>{w}</span>
                <span style={{ color: "var(--hero-brass)" }}>✦</span>
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Intro ---------------- */

function Intro({ body = site.content.about }: { body?: string } = {}) {
  const stats = site.stats;
  return (
    <section id="intro" className="relative z-10 px-6 md:px-10 py-32 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-3">
            <div className="flex items-center gap-4">
              <span className="hairline w-10" style={{ background: "var(--brass)" }} />
              <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 02 · Approach</span>
            </div>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="font-serif text-[clamp(1.8rem,3.8vw,3.6rem)] leading-[1.08] tracking-tight">
              <WordReveal text={site.content.whyHeadline || site.identity.businessName} />{" "}
              <span style={{ fontStyle: "italic", color: "var(--brass)" }}>
                
              </span>
            </h2>
            <Reveal delay={0.6}>
              <CertifiedCopy text={body} className="mt-10 max-w-3xl text-base md:text-lg leading-relaxed text-foreground/75" />
            </Reveal>
          </div>
        </div>

        {stats.length > 0 && <>
        <Hairline className="mt-24" />

        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-y-10 gap-x-8">
          {stats.map((s, i) => (
            <Reveal key={s.l} delay={0.1 * i}>
              <div>
                <div className="num font-serif text-4xl md:text-5xl tracking-tight" style={{ color: "var(--brass)" }}>{s.n}</div>
                <div className="mt-3 eyebrow">{s.l}</div>
              </div>
            </Reveal>
          ))}
        </div>
        </>}
      </div>
    </section>
  );
}

/* ---------------- Services ---------------- */

function Services() {
  const services = site.services;
  return (
    <section id="services" className="relative z-10 px-6 md:px-10 pt-20 pb-32">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-4 mb-6">
              <span className="hairline w-10" style={{ background: "var(--brass)" }} />
              <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 03 · Services</span>
            </div>
            <h2 className="font-serif text-[clamp(1.8rem,3.4vw,3rem)] leading-[1.1] tracking-tight max-w-2xl">
              <WordReveal text="Services" /> <span style={{ fontStyle: "italic", color: "var(--brass)" }}></span>
            </h2>
          </div>
          <div className="hidden md:block num text-sm text-soft">
            {site.services.length} — Disciplines
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-muted-foreground">{site.content.serviceIntro}</p>
        <Hairline className="mt-16" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px mt-px" style={{ background: "var(--hairline)" }}>
          {services.map((s, i) => (
            <ServiceCard key={s.idx} s={s} i={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ s, i }: { s: typeof site.services[number]; i: number }) {
  return (
    <Reveal delay={i * 0.05}>
      <article
        data-cursor="view"
        className="relative group frame edge-card overflow-hidden h-full flex flex-col"
      >
        {/* image top */}
        <div className="relative aspect-[4/3] overflow-hidden">
          {s.img && <img
            src={s.img.url}
            alt={s.name}
            loading="lazy"
            className="h-full w-full object-cover photo-lift transition-transform duration-1000 group-hover:scale-[1.05]"
          />}
          <div className="absolute top-4 left-4 flex items-center gap-2 px-2 py-1" style={{ background: "color-mix(in oklch, var(--background) 80%, transparent)", backdropFilter: "blur(6px)" }}>
            <span className="num eyebrow" style={{ color: "var(--brass)" }}>{s.idx}</span>
          </div>
          <span className="absolute top-4 right-4 transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1" style={{ color: "var(--brass)" }}>↗</span>
        </div>

        {/* text on solid surface */}
        <div className="p-7 md:p-8 flex-1 flex flex-col">
          <h3 className="font-serif text-2xl md:text-[1.7rem] leading-tight tracking-tight">{s.name}</h3>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
          <div className="mt-6 pt-5 border-t flex items-center justify-between text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--hairline)" }}>
            <span className="text-soft">Discipline</span>
            <a href={s.href || "/#quote"} style={{ color: "var(--brass)" }} className="link-arrow">Details</a>
          </div>
        </div>
      </article>
    </Reveal>
  );
}

/* ---------------- Philosophy / pull quote ---------------- */

function Philosophy() {
  return (
    <section className="relative z-10 px-6 md:px-10 py-32 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid grid-cols-12 gap-8 items-start">
          <div className="col-span-12 md:col-span-5">
            <div className="frame relative aspect-[4/5] overflow-hidden">
              {site.craftImage && <img src={site.craftImage} alt="About the business" className="h-full w-full object-cover photo-lift" />}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-foreground/50">
              <span className="num">PL · 010</span>
              <span>{site.identity.businessName}</span>
            </div>
          </div>

          <div className="col-span-12 md:col-span-7 md:pl-8 lg:pl-16">
            <div className="flex items-center gap-4 mb-8">
              <span className="hairline w-10" style={{ background: "var(--brass)" }} />
              <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 04 · Craft</span>
            </div>
            <h2 className="font-serif text-[clamp(1.9rem,4.2vw,3.6rem)] leading-[1.05] tracking-tight">
              <WordReveal text="Our approach" /> <span style={{ fontStyle: "italic", color: "var(--brass)" }}></span>
            </h2>
            <Reveal delay={0.5}>
              <p className="mt-10 text-base md:text-lg leading-relaxed text-foreground/75 max-w-2xl">
                {site.content.values[0]?.body}
              </p>
            </Reveal>

            <div className="mt-14 space-y-px" style={{ background: "var(--hairline)" }}>
              {site.content.values.map((value, i) => (
                <Reveal key={value.title} delay={0.1 * i}>
                  <div className="flex items-center justify-between bg-background py-5">
                    <span className="num eyebrow w-12" style={{ color: "var(--brass)" }}>{String(i + 1).padStart(2, "0")}</span>
                    <div className="flex-1"><span className="text-base md:text-lg">{value.title}</span>{i > 0 && <p className="text-sm text-muted-foreground mt-2">{value.body}</p>}</div>
                    <span className="text-foreground/30">—</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Work / Gallery ---------------- */

function Work() {
  const gallery = site.gallery;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="work" className="relative z-10 px-6 md:px-10 py-24">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-end justify-between gap-6 mb-12">
          <div>
            <div className="flex items-center gap-4 mb-6">
              <span className="hairline w-10" style={{ background: "var(--brass)" }} />
              <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 05 · Project Index</span>
            </div>
            <h2 className="font-serif text-[clamp(1.8rem,3.4vw,3rem)] leading-[1.1] tracking-tight max-w-2xl">
              <WordReveal text="Project photos organized for" /> <span style={{ fontStyle: "italic", color: "var(--brass)" }}><WordReveal text="a closer look." delay={0.3} /></span>
            </h2>
          </div>
          <span className="hidden md:block num text-sm text-soft">{gallery.length} · selects</span>
        </div>

        <Hairline className="mb-10" />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {gallery.map((g, i) => (
            <Reveal key={i} delay={(i % 4) * 0.05}>
              <button
                type="button"
                data-cursor="view"
                onClick={() => setOpen(i)}
                className={"group relative w-full overflow-hidden frame " + (g.tall ? "aspect-[3/4] md:row-span-2" : "aspect-[4/3]")}
              >
                <img
                  src={g.src.url}
                  alt={g.caption}
                  loading="lazy"
                  className="h-full w-full object-cover photo-lift transition-transform duration-1000 group-hover:scale-[1.06]"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-4 translate-y-2 opacity-0 transition-all duration-500 group-hover:opacity-100 group-hover:translate-y-0" style={{ background: "linear-gradient(180deg, transparent 0%, oklch(0.06 0.008 60 / 0.55) 40%, oklch(0.04 0.008 60 / 0.94) 100%)", color: "oklch(0.96 0.012 80)" }}>
                  <span className="text-xs uppercase tracking-[0.16em]">{g.caption}</span>
                  <span className="num text-xs opacity-90">{String(i + 1).padStart(2, "0")}</span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      <Lightbox open={open} setOpen={setOpen} />
    </section>
  );
}

function Lightbox({ open, setOpen }: { open: number | null; setOpen: (n: number | null) => void }) {
  const gallery = site.gallery;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [open === null]);
  if (open === null) return null;
  const item = gallery[open];
  const close = () => setOpen(null);
  const prev = () => setOpen(open === 0 ? gallery.length - 1 : open - 1);
  const next = () => setOpen(open === gallery.length - 1 ? 0 : open + 1);
  return (
    <div
      ref={dialog}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-10"
      style={{ background: "color-mix(in oklch, var(--background) 92%, transparent)", backdropFilter: "blur(10px)" }}
      onClick={close}
      onKeyDown={(e) => {
        if (["Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
        if (e.key === "Escape") close();
        if (e.key === "ArrowLeft") prev();
        if (e.key === "ArrowRight") next();
        if (e.key === "Tab") {
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
          if (!buttons?.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Project photos"
      tabIndex={-1}
    >
      <button onClick={(e) => { e.stopPropagation(); prev(); }} data-cursor="link" className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl text-foreground hover:text-brass" aria-label="Previous">←</button>
      <button onClick={(e) => { e.stopPropagation(); next(); }} data-cursor="link" className="absolute right-6 top-1/2 -translate-y-1/2 text-2xl text-foreground hover:text-brass" aria-label="Next">→</button>
      <button onClick={close} data-cursor="link" className="absolute right-6 top-6 eyebrow" aria-label="Close">Close ✕</button>
      <motion.figure
        key={open}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        className="max-h-[80vh] max-w-[1100px]"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.src.url} alt={item.caption} className="max-h-[80vh] w-auto object-contain" />
        <figcaption className="mt-4 flex justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <span>{item.caption}</span>
          <span className="num">{String(open + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}</span>
        </figcaption>
      </motion.figure>
    </div>
  );
}

/* ---------------- Process ---------------- */

function Process() {
  const process = site.process;
  return (
    <section id="process" className="relative z-10 px-6 md:px-10 py-32">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-center gap-4 mb-6">
          <span className="hairline w-10" style={{ background: "var(--brass)" }} />
          <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 06 · Process</span>
        </div>
        <h2 className="font-serif text-[clamp(1.8rem,3.4vw,3rem)] leading-[1.1] tracking-tight max-w-3xl">
          <WordReveal text="Process" /> <span style={{ fontStyle: "italic", color: "var(--brass)" }}></span>
        </h2>

        <div className="mt-20 relative">
          <div className="absolute left-0 right-0 top-0 h-px" style={{ background: "var(--hairline)" }} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-px" style={{ background: "var(--hairline)" }}>
            {process.map((p, i) => (
              <Reveal key={p.n} delay={i * 0.08}>
                <div className="bg-background p-8 min-h-[280px] flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="num font-serif text-4xl" style={{ color: "var(--brass)" }}>{p.n}</span>
                    <span className="text-soft">·</span>
                  </div>
                  <h3 className="mt-10 font-serif text-xl tracking-tight">{p.t}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{p.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Local ---------------- */

function Local() {
  const places = site.areas;
  return (
    <section className="relative z-10 py-24 overflow-hidden">
      <div className="px-6 md:px-10 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <span className="hairline w-10" style={{ background: "var(--brass)" }} />
          <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 07 · Service Area</span>
        </div>
        <h2 className="font-serif text-[clamp(1.6rem,3vw,2.6rem)] leading-tight tracking-tight max-w-2xl">
          <WordReveal text="Service area" />
        </h2>
        <Reveal delay={0.4}>
          <CertifiedCopy text={site.localCopy} className="mt-8 max-w-2xl text-muted-foreground leading-relaxed" />
        </Reveal>
      </div>

      <div className="mt-16 overflow-hidden py-8 border-y" style={{ borderColor: "var(--hairline)" }}>
        <div className="marquee-track gap-12 font-serif text-3xl md:text-5xl tracking-tight" style={{ width: "max-content" }}>
          {[...places, ...places, ...places].map((p, i) => (
            <span key={i} className="inline-flex items-center gap-12 text-soft">
              <span>{p}</span>
              <span style={{ color: "var(--brass)" }}>✦</span>
            </span>
          ))}
        </div>
      </div>

      <div className="px-6 md:px-10 max-w-[1400px] mx-auto mt-12 flex flex-wrap gap-6 text-sm">
        {site.mapUrl && <a href={site.mapUrl} target="_blank" rel="noreferrer" data-cursor="link" className="link-arrow uppercase tracking-[0.18em]" style={{ color: "var(--brass)" }}>Map & Directions</a>}
        {site.socials.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer" data-cursor="link" className="link-arrow uppercase tracking-[0.18em]" style={{ color: "var(--brass)" }}>Social profile {i + 1}</a>)}
      </div>
    </section>
  );
}

/* ---------------- Quote / Contact ---------------- */

function Quote({ body = site.content.ctaBody }: { body?: string } = {}) {
  return (
    <section id="quote" className="relative z-10 px-6 md:px-10 py-32 md:py-48">
      <div className="mx-auto max-w-[1400px] grid grid-cols-12 gap-10">
        <div className="col-span-12 md:col-span-5">
          <div className="flex items-center gap-4 mb-6">
            <span className="hairline w-10" style={{ background: "var(--brass)" }} />
            <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 08 · Estimate</span>
          </div>
          <h2 className="font-serif text-[clamp(2.2rem,5vw,4.4rem)] leading-[1] tracking-tight">
            <WordReveal text={site.content.ctaHeadline || "Contact"} />
          </h2>

          <Reveal delay={0.6}>
            <CertifiedCopy text={body} className="mt-8 max-w-md text-muted-foreground leading-relaxed" />
          </Reveal>

          <Hairline className="mt-12" />

          <div className="mt-10 space-y-6">
            <a href={site.identity.phoneTel} data-cursor="link" className="block group">
              <div className="eyebrow mb-2">Phone</div>
              <div className="font-serif text-2xl md:text-3xl tracking-tight underline-sweep inline-block" style={{ color: "var(--brass)" }}>{site.identity.phoneDisplay}</div>
            </a>
            {site.identity.email && <a href={"mailto:" + site.identity.email} data-cursor="link" className="block group">
              <div className="eyebrow mb-2">Email</div>
              <div className="font-serif text-xl md:text-2xl tracking-tight underline-sweep inline-block break-all">{site.identity.email}</div>
            </a>}
            {site.hours && <div>
              <div className="eyebrow mb-2">Hours</div>
              <div className="font-serif text-xl tracking-tight">{site.hours}</div>
            </div>}
          </div>
        </div>

        <div className="col-span-12 md:col-span-7 md:pl-10">
          <form
            onSubmit={(e) => { e.preventDefault(); }}
            className="edge-card p-8 md:p-10"
          >
            <div className="eyebrow mb-8 flex items-center justify-between">
              <span>Project Brief</span>
              <span className="num">FORM · 01</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Field label="Name" name="name" />
              <Field label="Phone" name="phone" type="tel" />
              <Field label="Email" name="email" type="email" />
              <Field label="Project Location" name="loc" />
              <div className="md:col-span-2">
                <Field label="Fence work needed" name="work" as="select"
                  options={site.services.map(s => s.name)} />
              </div>
              <div className="md:col-span-2">
                <Field label="Project Notes" name="notes" as="textarea" />
              </div>
            </div>

            <div className="mt-10 flex items-center justify-between">
              <span className="text-xs text-soft">Online delivery unavailable. Please use the contact links.</span>
              <button disabled type="submit" data-cursor="link" className="group inline-flex items-center gap-3 border border-foreground/45 px-7 py-4 text-sm tracking-[0.18em] uppercase transition-colors hover:bg-foreground hover:text-background">
                Online form unavailable
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function Field({
  label, name, type = "text", as = "input", options,
}: {
  label: string; name: string; type?: string;
  as?: "input" | "textarea" | "select"; options?: string[];
}) {
  const [val, setVal] = useState("");
  const focused = val.length > 0;
  return (
    <label className="block relative">
      <span
        className="absolute left-0 transition-all duration-300 pointer-events-none"
        style={{
          top: focused ? -2 : 18,
          fontSize: focused ? 10 : 13,
          letterSpacing: focused ? "0.2em" : "0.04em",
          textTransform: focused ? "uppercase" : "none",
          color: focused ? "var(--brass)" : "var(--muted-foreground)",
        }}
      >
        {label}
      </span>
      {as === "textarea" ? (
        <textarea
          name={name}
          rows={4}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full bg-transparent border-0 border-b border-foreground/35 pt-6 pb-2 focus:outline-none focus:border-[color:var(--brass)] resize-none"
        />
      ) : as === "select" ? (
        <select
          name={name}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full bg-transparent border-0 border-b border-foreground/35 pt-6 pb-2 focus:outline-none focus:border-[color:var(--brass)]"
          style={{ color: val ? "var(--bone)" : "transparent" }}
        >
          <option value="" />
          {options?.map((o) => <option key={o} value={o} className="bg-background">{o}</option>)}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full bg-transparent border-0 border-b border-foreground/35 pt-6 pb-2 focus:outline-none focus:border-[color:var(--brass)]"
        />
      )}
    </label>
  );
}

/* ---------------- FAQ ---------------- */

function Faq() {
  const faqs = site.faqs;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="relative z-10 px-6 md:px-10 py-32">
      <div className="mx-auto max-w-[1400px] grid grid-cols-12 gap-8">
        <div className="col-span-12 md:col-span-4">
          <div className="flex items-center gap-4 mb-6">
            <span className="hairline w-10" style={{ background: "var(--brass)" }} />
            <span className="eyebrow" style={{ color: "var(--brass)" }}>§ 09 · FAQ</span>
          </div>
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.6rem)] leading-tight tracking-tight">
            <WordReveal text="Quick answers before" /> <span style={{ fontStyle: "italic", color: "var(--brass)" }}><WordReveal text="the quote." delay={0.2} /></span>
          </h2>
        </div>
        <div className="col-span-12 md:col-span-8">
          <div className="border-t" style={{ borderColor: "var(--hairline)" }}>
            {faqs.map((f, i) => (
              <div key={i} className="border-b" style={{ borderColor: "var(--hairline)" }}>
                <button
                  type="button"
                  data-cursor="link"
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full flex items-start justify-between gap-6 py-7 text-left group"
                >
                  <span className="flex items-start gap-6">
                    <span className="num eyebrow pt-2" style={{ color: "var(--brass)" }}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-serif text-lg md:text-xl tracking-tight">{f.q}</span>
                  </span>
                  <span className="font-serif text-2xl pt-1 transition-transform duration-500" style={{ transform: open === i ? "rotate(45deg)" : "rotate(0)", color: "var(--brass)" }}>+</span>
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }}
                  transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <p className="pb-7 pl-[3.6rem] pr-10 text-muted-foreground leading-relaxed max-w-2xl">{f.a}</p>
                </motion.div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Footer ---------------- */

function Footer() {
  const pageLinks = [...new Set((site.plan.pages || []).map(page => '/' + page.slug.replace(/^\/+|\/+$/g, '')))]
    .filter(href => resolveRoute(site, href).kind === 'section');
  return (
    <footer className="relative z-10 px-6 md:px-10 pt-20 pb-10 border-t" style={{ borderColor: "var(--hairline)" }}>
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-10">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span style={{ width: 8, height: 8, background: "var(--brass)", transform: "rotate(45deg)", display: "block" }} />
              <span className="font-serif text-2xl tracking-tight">{site.identity.businessName}</span>
            </div>
            <p className="max-w-md text-muted-foreground leading-relaxed">
              {site.identity.city}, {site.identity.state}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm">
            {pageLinks.map(href => <a key={href} href={href} data-cursor="link" className="underline-sweep">{{ '/about': 'About', '/contact': 'Contact', '/services': 'Services overview', '/service-area': 'Service area', '/gallery': 'Project gallery' }[href]}</a>)}
            <a href="/#services" data-cursor="link" className="underline-sweep">Services</a>
            {site.gallery.length > 0 && <a href="/#work" data-cursor="link" className="underline-sweep">Gallery</a>}
            {site.process.length > 0 && <a href="/#process" data-cursor="link" className="underline-sweep">Process</a>}
            <a href="/#quote" data-cursor="link" className="underline-sweep">Quote</a>
            <a href={site.identity.phoneTel} data-cursor="link" className="underline-sweep" style={{ color: "var(--brass)" }}>{site.identity.phoneDisplay}</a>
            {site.identity.email && <a href={"mailto:" + site.identity.email} data-cursor="link" className="underline-sweep">Email</a>}
          </div>
        </div>

        <Hairline className="my-12" />

        <div className="flex flex-wrap justify-between gap-4 text-xs uppercase tracking-[0.2em] text-soft">
          <span>© {new Date().getFullYear()} {site.identity.businessName}</span>
          <span>{site.identity.city}, {site.identity.state}</span>
          <span className="num">Layout · 001</span>
        </div>
      </div>
    </footer>
  );
}
