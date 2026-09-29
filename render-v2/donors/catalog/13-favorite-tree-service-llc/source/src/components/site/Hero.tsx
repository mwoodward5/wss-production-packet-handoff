import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, Phone, Shield } from "lucide-react";
import { TEL_HREF, BUSINESS } from "@/lib/business";
import { CountUp } from "@/components/site/CountUp";
import { Marquee } from "@/components/site/Marquee";
import { SchematicOverlay } from "@/components/site/SchematicOverlay";
import { CursorLight } from "@/components/site/CursorLight";
import { QuoteConfigurator } from "@/components/site/QuoteConfigurator";
import { client, stats } from '@/lib/wss-bridge';
import { useEffect, useState } from 'react';
const HERO_VIDEO_URL = client.hero.video;
const heroPoster = client.hero.poster;
const SERVICES_TICKER = client.services.map(s => s.name);
const HEADLINE_WORDS = [
  { text: client.hero.line1, accent: false },
  { text: client.hero.emphasis, accent: true },
  { text: client.hero.line3, accent: false },
].flatMap(line => line.text.split(/\s+/).map(text => ({text, accent: line.accent})));

export function Hero() {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => { const query=window.matchMedia('(prefers-reduced-motion: reduce)'); const sync=()=>setReduceMotion(query.matches); sync(); query.addEventListener('change',sync); return ()=>query.removeEventListener('change',sync); }, []);
  return (
    <section
      className="ft3-hero relative isolate overflow-hidden text-[color:var(--ft3-cream)]"
      aria-label={client.identity.businessName}
    >
      {/* 1. Video background (with poster + reduced-motion fallback) */}
      <div className="absolute inset-0 -z-30">
        <img
          src={heroPoster}
          alt=""
          aria-hidden
          className="ft3-poster absolute inset-0 h-full w-full object-cover"
        />
        {HERO_VIDEO_URL && !reduceMotion && !videoFailed && <video
          className="ft3-video absolute inset-0 h-full w-full object-cover"
          onError={() => setVideoFailed(true)}
          src={HERO_VIDEO_URL}
          poster={heroPoster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
        />}
      </div>

      {/* 2. Gradient veil */}
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(ellipse 70% 70% at 18% 30%, color-mix(in oklab, var(--ft3-loam) 60%, transparent) 0%, transparent 60%), linear-gradient(120deg, color-mix(in oklab, var(--ft3-loam) 88%, transparent) 0%, color-mix(in oklab, var(--ft3-loam) 55%, transparent) 55%, color-mix(in oklab, var(--ft3-loam) 80%, transparent) 100%)",
        }}
        aria-hidden
      />

      {/* 3. Grain layer */}
      <div className="ft3-grain pointer-events-none absolute inset-0 -z-10" aria-hidden />

      {/* 4. Schematic overlay */}
      <SchematicOverlay />

      {/* Cursor reactive light (desktop only) */}
      <CursorLight />

      {/* Top eyebrow row */}
      <div className="relative mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--ft3-cream)]/75">
          <span>{client.hero.eyebrow}</span>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pb-32 lg:pt-24">
        {/* HEADLINE COLUMN */}
        <div className="lg:col-span-7 xl:col-span-7">
          <h1
            className="ft3-headline font-serif font-medium leading-[0.92] tracking-[-0.025em]"
            style={{ fontSize: "clamp(2.85rem, 7.6vw, 7rem)" }}
            aria-label={HEADLINE_WORDS.map(w => w.text).join(" ")}
          >
            {HEADLINE_WORDS.map((w, i) => {
              const isAccent = w.accent;
              return (
                <span
                  key={i}
                  className="ft3-word inline-block max-w-full break-words"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className={
                      isAccent
                        ? "italic text-[color:var(--ft3-accent)]"
                        : ""
                    }
                  >
                    {w.text}
                  </span>
                  {i < HEADLINE_WORDS.length - 1 ? " " : ""}
                </span>
              );
            })}
          </h1>

          <p className="ft3-fade-up mt-7 max-w-xl text-base leading-relaxed text-[color:var(--ft3-cream)]/80 sm:text-lg" style={{ animationDelay: "440ms" }}>
            {client.hero.support}
          </p>

          <div className="ft3-fade-up mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "560ms" }}>
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-md px-7 py-4 text-sm font-bold text-[var(--ft3-loam)] shadow-[0_18px_45px_-12px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-[color:var(--ft3-accent)]"
              style={{ background: "var(--ft3-accent)" }}
            >
              Discuss your project <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href={TEL_HREF}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--ft3-cream)]/30 px-7 py-4 text-sm font-semibold text-[color:var(--ft3-cream)] backdrop-blur transition-colors hover:border-[color:var(--ft3-cream)]/60 hover:bg-white/5"
            >
              <Phone className="h-4 w-4" /> {BUSINESS.phoneDisplay}
            </a>
          </div>

          {/* CountUp stats */}
          {stats.length > 0 && <dl className="ft3-fade-up mt-12 grid grid-cols-3 gap-4 border-t border-white/10 pt-8 sm:gap-8" style={{ animationDelay: "680ms" }}>
            {stats.map(s => <Stat key={s.label} label={s.label} to={s.value} suffix={s.suffix} format={!/^founded$/i.test(s.label)} />)}
          </dl>}
        </div>

        {/* WIDGET COLUMN */}
        <div className="lg:col-span-5 xl:col-span-5">
          <div className="lg:sticky lg:top-24">
            <QuoteConfigurator />
          </div>
        </div>
      </div>

      {/* Marquee ticker — bottom edge */}
      <Marquee items={SERVICES_TICKER} />
    </section>
  );
}

function Stat({
  label,
  to,
  suffix,
  decimals,
  format,
}: {
  label: string;
  to: number;
  suffix?: string;
  decimals?: number;
  format?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--ft3-cream)]/55">
        {label}
      </dt>
      <dd
        className="mt-2 font-serif text-3xl text-[color:var(--ft3-cream)] sm:text-4xl"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <CountUp to={to} suffix={suffix} decimals={decimals ?? 0} format={format} />
      </dd>
    </div>
  );
}
