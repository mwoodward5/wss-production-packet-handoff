import { useEffect, useRef, useState } from "react";
import { Phone, ArrowRight, MapPin } from "lucide-react";
import heroPoster from "@/assets/hero-excavator.jpg";
import heroVideo from "@/assets/hero-loop.mp4.asset.json";
import { SchematicOverlay } from "./SchematicOverlay";
import { YardageEstimator } from "./YardageEstimator";
import { CountUp } from "./CountUp";
import { Marquee } from "./Marquee";

const HEADLINE = ["Move", "Earth.", "Move", "Forward."];

export function Hero() {
  const [revealed, setRevealed] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setRevealed(true);
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const py = reduced ? 0 : scrollY * 0.3;
  const sy = reduced ? 0 : scrollY * -0.6;

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-[var(--knk-ink)] text-[var(--knk-bone)]">
      {/* 1. Video background */}
      <div className="absolute inset-0 -z-10" style={{ transform: `translate3d(0, ${py}px, 0)` }}>
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          src={heroVideo.url}
          poster={heroPoster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          style={{ filter: "grayscale(0.45) contrast(1.15) brightness(0.55) sepia(0.25) hue-rotate(-10deg)" }}
        />
      </div>

      {/* 2. Gradient veil */}
      <div
        className="absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(120% 80% at 20% 30%, oklch(0.18 0.02 60 / 0.55) 0%, oklch(0.1 0.01 60 / 0.85) 60%, oklch(0.08 0.005 60 / 0.95) 100%), linear-gradient(180deg, transparent 40%, var(--knk-ink) 100%)",
        }}
      />

      {/* 3. Grain */}
      <svg className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.28] mix-blend-overlay" aria-hidden="true">
        <filter id="knkNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.7 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#knkNoise)" />
      </svg>

      {/* 4. Schematic */}
      <div className="absolute inset-0 -z-10" style={{ transform: `translate3d(0, ${sy}px, 0)` }}>
        <SchematicOverlay />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-5 pb-32 pt-28 sm:px-8 lg:px-12 lg:pt-36 lg:pb-44">
        {/* 5. Eyebrow */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--knk-bone)]/70">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--knk-amber)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--knk-amber)]" />
            </span>
            On the Iron · Mon–Sat
          </span>
          <span className="hidden h-3 w-px bg-[var(--knk-line)] sm:block" />
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> Alexandria, KY
          </span>
          <span className="hidden h-3 w-px bg-[var(--knk-line)] sm:block" />
          <span>Est. Locally · Licensed &amp; Insured</span>
        </div>

        <div className="mt-8 grid gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Headline + CTA */}
          <div className="lg:col-span-7 xl:col-span-8">
            {/* 6. Headline — asymmetric, oversized first word */}
            <h1
              className="font-black uppercase leading-[0.85] tracking-[-0.02em] text-[var(--knk-bone)]"
              style={{ fontSize: "clamp(3rem, 11vw, 11.5rem)" }}
            >
              {HEADLINE.map((word, i) => {
                const accent = i === 1; // "Earth." outlined+amber
                const massive = i === 0; // "Move" oversized
                return (
                  <span key={i} className="inline-block overflow-hidden align-baseline pr-[0.1em]">
                    <span
                      className={`inline-block will-change-transform ${
                        accent ? "italic text-[var(--knk-amber)]" : ""
                      } ${massive ? "tracking-[-0.04em]" : ""}`}
                      style={{
                        transform: revealed ? "translateY(0)" : "translateY(110%)",
                        opacity: revealed ? 1 : 0,
                        transition: `transform 1.1s cubic-bezier(0.2,0.7,0.2,1) ${i * 60}ms, opacity 0.8s ease ${i * 60}ms`,
                      }}
                    >
                      {word}
                    </span>
                  </span>
                );
              })}
            </h1>

            {/* Hairline rule + ID */}
            <div className="mt-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-gradient-to-r from-[var(--knk-amber)] via-[var(--knk-line)] to-transparent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--knk-bone)]/50">
                FILE · KNK-EX-0427
              </span>
            </div>

            {/* 7. Sub-deck */}
            <p className="mt-6 max-w-xl text-base text-[var(--knk-bone)]/75 sm:text-lg">
              Site preparation, land clearing, demolition, grading, septic, and trench digging
              for builders and homeowners across Northern Kentucky. Honest quotes. Heavy iron.
              <span className="text-[var(--knk-amber)]"> Digging done right.</span>
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#contact"
                className="group inline-flex items-center gap-2 rounded-md bg-[var(--knk-amber)] px-6 py-4 text-sm font-black uppercase tracking-[0.2em] text-[var(--knk-ink)] shadow-[0_10px_30px_-8px_oklch(0.82_0.19_80_/_0.55)] transition hover:translate-y-[-2px] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--knk-amber)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--knk-ink)]"
              >
                Get Free Estimate
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </a>
              <a
                href="tel:8593803765"
                className="group inline-flex items-center gap-2 rounded-md border border-[var(--knk-line)] bg-transparent px-6 py-4 text-sm font-black uppercase tracking-[0.2em] text-[var(--knk-bone)] transition hover:border-[var(--knk-amber)] hover:text-[var(--knk-amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--knk-amber)]"
              >
                <Phone className="h-4 w-4" />
                (859) 380-3765
              </a>
            </div>

            {/* CountUps */}
            <dl className="mt-14 grid grid-cols-3 gap-4 border-t border-[var(--knk-line)] pt-8 sm:gap-8">
              <Stat n={<CountUp end={500} suffix="+" />} l="Projects Dug" />
              <Stat n={<CountUp end={12} suffix=" yrs" />} l="On the Iron" />
              <Stat n={<><CountUp end={48} />h</>} l="Avg. Quote Time" />
            </dl>
          </div>

          {/* 8. Widget */}
          <div className="lg:col-span-5 xl:col-span-4">
            <YardageEstimator />
          </div>
        </div>
      </div>

      {/* Marquee bottom */}
      <div className="absolute bottom-0 left-0 right-0">
        <Marquee
          items={[
            "Site Preparation",
            "Land Clearing",
            "Demolition",
            "Land Grading",
            "Septic Sanitary",
            "Soil Backfilling",
            "Site Development",
            "Trench Digging",
            "Alexandria KY",
            "Cold Spring KY",
            "Newport KY",
            "Fort Thomas KY",
            "Campbell County",
            "Kenton County",
          ]}
        />
      </div>
    </section>
  );
}

function Stat({ n, l }: { n: React.ReactNode; l: string }) {
  return (
    <div>
      <dt className="font-mono text-3xl font-black text-[var(--knk-bone)] sm:text-4xl">{n}</dt>
      <dd className="mt-1 text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--knk-bone)]/55">{l}</dd>
    </div>
  );
}
