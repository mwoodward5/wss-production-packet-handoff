import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { arts } from "@/data/arts";
import { ArtSymbol } from "./icons/ArtSymbols";
import { copy } from "@/data/copy";
import { ChapterMark, Epigraph } from "./ChapterMark";

/**
 * Twelve rooms as a horizontal carousel with depth: focal card center,
 * neighbors recede on both sides. Ink-wash brush layer washes behind
 * everything for a martial-arts scroll feel — no flat grid.
 */

// Family-specific accent tint (used sparingly — one stripe per card).
const FAMILY_ACCENT:Record<string,string>={};

export function ArtAtlas() {
  const [i, setI] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const n = arts.length;

  const go = (delta: number) => setI((v) => (v + delta + n) % n);

  // Scroll the focal card into view on change
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const focal = el.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    focal?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", inline: "center", block: "nearest" });
  }, [i]);

  return (
    <section id="atlas" aria-labelledby="atlas-h" className="relative overflow-hidden border-y border-hairline py-24 md:py-32" style={{ background: "var(--paper)" }}>
      {/* Ink-wash brush strokes for depth */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08]">
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1440 800">
          <path d="M -50 200 Q 400 120 900 220 T 1500 180" stroke="#2d1a08" strokeWidth="60" fill="none" opacity="0.6" />
          <path d="M -50 500 Q 500 620 1000 480 T 1500 520" stroke="#2d1a08" strokeWidth="90" fill="none" opacity="0.4" />
          <path d="M 200 -50 Q 380 300 260 700 T 320 900" stroke="#2d1a08" strokeWidth="40" fill="none" opacity="0.5" />
        </svg>
      </div>

      <div className="relative mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-center justify-between">
          <span className="eyebrow" style={{ color: "var(--paper-steel)" }}>{copy.atlas.eyebrow}</span>
          <ChapterMark n="VII" />
        </div>
        <div className="mt-8 grid grid-cols-12 items-end gap-8">
          <h2 id="atlas-h" className="col-span-12 font-serif text-5xl leading-[1.02] tracking-[-0.025em] md:col-span-7 md:text-7xl" style={{ color: "var(--paper-ink)" }}>
            {copy.atlas.title}
          </h2>
          <div className="col-span-12 md:col-span-5">
            <p className="text-[17px] leading-relaxed" style={{ color: "var(--paper-steel)" }}>{copy.atlas.sub}</p>
            <div className="mt-6">
              <Epigraph text={copy.atlas.epigraph.text} credit={copy.atlas.epigraph.credit} />
            </div>
          </div>
        </div>

        {/* Controls + numeral */}
        <div className="mt-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              className="grid h-11 w-11 place-items-center border border-hairline text-lg hover:border-edge hover:text-edge"
              aria-label="Previous art"
              style={{ color: "var(--paper-ink)" }}
            >←</button>
            <button
              onClick={() => go(1)}
              className="grid h-11 w-11 place-items-center border border-hairline text-lg hover:border-edge hover:text-edge"
              aria-label="Next art"
              style={{ color: "var(--paper-ink)" }}
            >→</button>
          </div>
          <div className="numeral text-xl" style={{ color: "var(--edge-deep)" }}>
            {String(i + 1).padStart(2, "0")} <span style={{ color: "var(--paper-steel)" }}>/ {String(n).padStart(2, "0")}</span>
          </div>
        </div>

        {/* Carousel track — horizontal snap */}
        <div
          ref={scrollerRef}
          className="mt-8 flex gap-6 overflow-x-auto pb-6"
          style={{ scrollSnapType: "x mandatory", scrollPadding: "0 25%" }}
        >
          {/* Spacers so first/last cards can center */}
          <div className="shrink-0" style={{ width: "15%" }} aria-hidden />
          {arts.map((a, idx) => {
            const focal = idx === i;
            const dist = Math.abs(idx - i);
            const accent = FAMILY_ACCENT[a.family] ?? "var(--edge-deep)";
            return (
              <div
                key={a.slug}
                data-idx={idx}
                className="shrink-0 transition-all duration-500"
                style={{
                  scrollSnapAlign: "center",
                  width: focal ? "min(420px, 82vw)" : "min(300px, 60vw)",
                  transform: focal ? "scale(1)" : `scale(${Math.max(0.82, 1 - dist * 0.06)})`,
                  opacity: focal ? 1 : Math.max(0.55, 1 - dist * 0.18),
                }}
              >
                <button
                  onClick={() => setI(idx)}
                  className="block w-full text-left"
                  aria-label={`Focus ${a.name}`}
                >
                  <article
                    className="group relative border p-6 md:p-8"
                    style={{
                      borderColor: "color-mix(in oklab, var(--paper-ink) 15%, transparent)",
                      background:
                        "linear-gradient(180deg, var(--paper) 0%, var(--paper-2) 100%)",
                      minHeight: focal ? 460 : 400,
                      boxShadow: focal ? "0 30px 60px -30px rgba(45,26,8,.35)" : "none",
                    }}
                  >
                    {/* Accent stripe */}
                    <div
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ background: accent }}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between">
                      <div
                        className="grid h-16 w-16 place-items-center border"
                        style={{
                          borderColor: "color-mix(in oklab, var(--paper-ink) 20%, transparent)",
                          background: "var(--paper)",
                          color: accent,
                        }}
                      >
                        <ArtSymbol name={a.icon} size={44} />
                      </div>
                      <span className="numeral text-2xl" style={{ color: "var(--edge-deep)" }}>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="mt-6">
                      <h3 className="font-serif text-2xl leading-tight md:text-3xl" style={{ color: "var(--paper-ink)" }}>
                        {a.name}
                      </h3>
                      {a.native && (
                        <div className="mt-1 font-serif text-sm italic" style={{ color: "var(--paper-steel)" }}>
                          {a.native}
                        </div>
                      )}
                      <div className="mt-3 text-[11px] uppercase tracking-widest" style={{ color: "var(--paper-steel)" }}>
                        {[a.region,a.era].filter(Boolean).join(" · ")}
                      </div>
                      <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--paper-ink)" }}>
                        {a.essence}
                      </p>
                    </div>

                    {focal && (
                      <Link
                        to="/arts/$slug"
                        params={{ slug: a.slug }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-6 inline-flex items-center gap-2 border-b pb-1 text-xs uppercase tracking-widest transition"
                        style={{ color: accent, borderColor: accent }}
                      >
                        Enter the room →
                      </Link>
                    )}
                  </article>
                </button>
              </div>
            );
          })}
          <div className="shrink-0" style={{ width: "15%" }} aria-hidden />
        </div>

        {/* Progress rail — 12 ticks */}
        <div className="mt-8 flex items-center gap-1">
          {arts.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Jump to ${idx + 1}`}
              className="flex-1"
            >
              <span
                className="block h-px transition-all"
                style={{
                  background: idx === i ? "var(--edge-deep)" : "color-mix(in oklab, var(--paper-ink) 20%, transparent)",
                  height: idx === i ? 3 : 1,
                }}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
