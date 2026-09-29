import { useEffect, useState } from "react";
import { SERVICES } from "@/content/services";
import { CLIENT, SITE } from "@/lib/site";
import { CC_ASSETS } from "@/assets/cc";

export function Hero() {
  const [motion, setMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return (
    <section
      id="top"
      className="relative isolate min-h-screen overflow-hidden bg-[var(--ink)] text-white"
      aria-label={SITE.name}
    >
      {/* Blueprint background */}
      <div className="absolute inset-0 -z-10">
        <img
          src={CC_ASSETS.heroBg}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          width={1920}
          height={1080}
          style={{ visibility: CLIENT.hero.video && motion && !videoFailed ? 'hidden' : 'visible' }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          className="absolute inset-0 h-full w-full object-cover opacity-[0.18]"
        />
        {CLIENT.hero.video && motion && !videoFailed && <video src={CLIENT.hero.video} poster={CLIENT.hero.poster} autoPlay muted loop playsInline onError={() => setVideoFailed(true)} className="absolute inset-0 h-full w-full object-cover opacity-[0.22]" />}
        <div className="absolute inset-0 blueprint-grid opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--ink)]/40 via-transparent to-[var(--ink)]" />
        {/* horizontal grade laser */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--brand)]/70 grade-laser-h shadow-[0_0_24px_4px_rgba(18,193,26,0.35)]" />
      </div>

      {/* Ruler ticks */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-3 ruler-top opacity-50" />
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-3 ruler-left opacity-50" />

      {/* Hazard strip */}
      <div className="absolute left-0 right-0 top-0 h-1 hazard-tape opacity-90" />

      {/* Slab perspective floor at base */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-48 slab-floor opacity-60" style={{ transform: "perspective(700px) rotateX(58deg)", transformOrigin: "bottom" }} />

      {/* Aggregate dust particles */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {[0,1,2,3,4].map((i) => (
          <span
            key={i}
            className="absolute size-1 rounded-full bg-[var(--brand)]/60 dust-rise"
            style={{
              left: `${15 + i * 17}%`,
              bottom: `${10 + (i % 2) * 8}%`,
              animationDelay: `${i * 1.6}s`,
            }}
          />
        ))}
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8 pt-28 pb-16 sm:pt-32 sm:pb-24">
        {/* Spec header strip */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
          <span className="spec-mark">SHEET A-01 · SITE PLAN</span>
          <span className="inline-flex items-center gap-2 text-white/70">
            <span className="h-2 w-2 rounded-full bg-[var(--brand)] led-blink" />
            CONTACT · {SITE.phone}
          </span>
          <span className="text-white/50">{CLIENT.hero.eyebrow}</span>
        </div>

        {/* Headline + annotation callouts */}
        <div className="relative mt-8 max-w-5xl">
          <h1 className="font-display text-5xl sm:text-7xl lg:text-8xl font-black leading-[0.92] type-etched relative">
            {CLIENT.hero.line1}<br />
            <span className="text-[var(--brand)]">{CLIENT.hero.emphasis}</span><br />{CLIENT.hero.line3}
            <span aria-hidden className="absolute inset-0 wet-sheen pointer-events-none">{CLIENT.hero.line1}<br />{CLIENT.hero.emphasis}<br />{CLIENT.hero.line3}</span>
          </h1>

          {CLIENT.trust.badges.length > 0 && <svg aria-hidden className="hidden lg:block absolute -right-4 top-2 w-72 h-56 overflow-visible" viewBox="0 0 288 224" fill="none"><path d="M 10 30 L 90 30 L 130 60" stroke="var(--brand)" strokeWidth="1" className="anno-draw" /><path d="M 10 110 L 70 110 L 110 140" stroke="var(--brand)" strokeWidth="1" className="anno-draw" /></svg>}
          {CLIENT.trust.badges.length > 0 && <div className="hidden lg:flex absolute -right-2 top-0 flex-col gap-3 items-end">
            {CLIENT.trust.badges.slice(0, 3).map(b => <span key={b.label} className="spec-mark bg-black/40 border border-[var(--brand)]/40 px-2 py-1 rounded">{b.label}</span>)}
          </div>}
        </div>

        <p className="mt-6 max-w-2xl text-base sm:text-lg text-white/75">
          {CLIENT.hero.support}
        </p>

        {CLIENT.trust.aggregate && CLIENT.trust.aggregate.rating !== null && CLIENT.trust.aggregate.count !== null && <a href={CLIENT.trust.aggregate.sourceUrl} className="spec-mark inline-block mt-4 border border-[var(--brand)]/40 px-3 py-2">★ {CLIENT.trust.aggregate.rating} · {CLIENT.trust.aggregate.count} reviews</a>}
        {/* Job triage console */}
        <div className="relative mt-10 glass-panel rounded-2xl p-4 sm:p-5">
          {/* Corner registration marks */}
          <span aria-hidden className="absolute -top-1 -left-1 size-3 border-t-2 border-l-2 border-[var(--brand)]" />
          <span aria-hidden className="absolute -top-1 -right-1 size-3 border-t-2 border-r-2 border-[var(--brand)]" />
          <span aria-hidden className="absolute -bottom-1 -left-1 size-3 border-b-2 border-l-2 border-[var(--brand)]" />
          <span aria-hidden className="absolute -bottom-1 -right-1 size-3 border-b-2 border-r-2 border-[var(--brand)]" />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
            <span className="spec-mark">JOB TRIAGE · FORM CC-Q1</span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] led-blink" />
              READY
            </span>
          </div>

          <form
            action="#quote"
            className="mt-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              window.dispatchEvent(new CustomEvent('wss-triage', {detail: {service: data.get('service'), zip: data.get('zip'), notes: `Size (SF): ${data.get('size') || ''}; Timing: ${data.get('timing') || ''}`}}));
              document.getElementById("quote")?.scrollIntoView({ behavior: motion ? "smooth" : "auto" });
            }}
          >
            <label className="sm:col-span-3">
              <span className="block spec-mark mb-1">TYPE</span>
              <select name="service" className="w-full bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm">
                {SERVICES.map(s => <option key={s.slug}>{s.name}</option>)}
              </select>
            </label>
            <label className="sm:col-span-3">
              <span className="block spec-mark mb-1">SIZE (SF)</span>
              <input name="size" inputMode="numeric" placeholder="e.g. 2,400" className="w-full bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm placeholder:text-white/60" />
            </label>
            <label className="sm:col-span-2">
              <span className="block spec-mark mb-1">TIMING</span>
              <select name="timing" className="w-full bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm">
                <option>ASAP</option>
                <option>30 days</option>
                <option>60–90 days</option>
                <option>Planning</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="block spec-mark mb-1">ZIP</span>
              <input name="zip" inputMode="numeric" maxLength={5} placeholder="ZIP code" className="w-full bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm placeholder:text-white/60" />
            </label>
            <div className="sm:col-span-2 flex items-end">
              <button
                type="submit"
                className="w-full bg-[var(--brand)] text-[var(--ink)] font-semibold rounded-md px-3 py-2 text-sm hover:brightness-110 transition"
              >
                Start →
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
            <span>Or call directly</span>
            <a href={SITE.phoneHref} className="text-[var(--brand)] font-semibold">
              {SITE.phone}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
