import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Play, ShieldCheck, Clock, MapPin, Star } from "lucide-react";
import heroImg from "@/assets/hero-concrete.webp";
import { CallButton } from "./CallButton";
import { useLiveAreas, useLiveIdentity, useLiveServices } from "@/lib/wssc";
import { site } from "@/lib/site";

// THE HEADLINE, in the pieces this display typeface needs (engine-composed —
// never the donor's sentence). Whole-value tokens: a blank line collapses its
// own <span> at render, never leaving welded copy behind.
const HERO_LINE_A = "{{HERO_LINE_A}}";
const HERO_LINE_B = "{{HERO_LINE_B}}";

// THE HERO VIDEO LADDER RUNG.
// The design's own hero video system, re-pointed at the fleet contract: this
// element ships MARKED (data-hero-video) with NO src and hidden; the universal
// hero-video-ladder runtime in the shell arms the first rung whose bytes
// actually shipped — the client's own verified clip, then the WSS-owned
// fallback clip — and unhides it on loadedmetadata. An error steps down
// silently; reduced motion never arms. Until a rung arms, the poster image
// (instant LCP) and the drawn composition carry the hero exactly as designed.
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const id = useLiveIdentity();
  const areas = useLiveAreas();
  const serviceLines = useLiveServices();

  // Reduced-motion subscription
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Poster fades only when a ladder rung actually reaches canplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => setLoaded(true);
    if (v.readyState >= 2) onReady();
    v.addEventListener("canplay", onReady, { once: true });
    return () => v.removeEventListener("canplay", onReady);
  }, []);

  const showAnimatedOverlays = !reducedMotion;

  // THE STAT RIBBON — composed or evidence-backed only: a count over verified
  // services/areas, a verified license, a verified rating pair. Nothing here
  // is invented (no "100% insured", no "same-week", no warranty assertion).
  const stats: { icon: typeof MapPin; k: string; v: string }[] = [];
  if (areas.length > 0) stats.push({ icon: MapPin, k: String(areas.length), v: areas.length === 1 ? "Area Served" : "Areas Served" });
  if (serviceLines.length > 0) stats.push({ icon: Clock, k: String(serviceLines.length), v: serviceLines.length === 1 ? "Service Line" : "Service Lines" });
  if (id.license) stats.push({ icon: ShieldCheck, k: "Licensed", v: id.license.split(/[+,]/)[0].trim().slice(0, 24) });
  if (id.rating && id.reviewCount) stats.push({ icon: Star, k: String(id.rating), v: `${id.reviewCount} Reviews` });

  return (
    <section
      className="relative isolate overflow-hidden bg-primary"
      aria-label="Commercial concrete and renovation"
    >
      {/* MEDIA LAYER */}
      <div className="absolute inset-0 -z-10">
        {/* Poster image — instant paint (LCP). Stays visible until video is ready. */}
        <img
          src={heroImg}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          loading="eager"
          className={`h-full w-full object-cover transition-opacity duration-700 ${loaded ? "opacity-0" : "opacity-100"}`}
        />
        {/* THE MARKED HERO VIDEO RUNG — armed by the shell's ladder runtime. */}
        <video
          ref={videoRef}
          data-hero-video="1"
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${loaded ? "opacity-100" : "opacity-0"}`}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          hidden
          disablePictureInPicture
          poster={heroImg}
          onCanPlay={() => setLoaded(true)}
        />
        {/* No-JS fallback: ensure poster shows */}
        <noscript>
          <img
            src={heroImg}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </noscript>
        {/* Cinematic gradient grade — navy bottom, warm fade top, gold glow accent */}
        <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-primary/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/85 via-primary/40 to-transparent" />
        {/* Gold rim glow on the right edge */}
        <div
          aria-hidden="true"
          className="absolute -right-40 top-1/2 h-[80vh] w-[80vh] -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--gold) 0%, transparent 70%)" }}
        />
        {/* Film grain / mesh overlay — suppressed when reduced-motion is on */}
        {showAnimatedOverlays && (
          <>
            <div className="absolute inset-0 bg-mesh-animated opacity-40 mix-blend-overlay" />
            <div className="bg-concrete-noise absolute inset-0" />
          </>
        )}
        {/* Vignette */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)",
          }}
        />
      </div>

      {/* CONTENT */}
      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-20 lg:px-6 lg:pb-32 lg:pt-32">
        <div className="max-w-3xl text-primary-foreground">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md animate-fade-up">
            <span className="relative flex h-2 w-2">
              {!reducedMotion && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              )}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
            </span>
            {site.city}, {site.state}
          </div>

          {/* Headline — the client's own composed lines, never the donor's sentence. */}
          <h1 className="mt-6 text-balance font-display text-5xl font-semibold leading-[1.02] tracking-tight text-white md:text-6xl lg:text-7xl xl:text-[5.25rem]">
            {HERO_LINE_A && <span className="block">{HERO_LINE_A}</span>}
            <span className="block text-gradient-gold">{HERO_LINE_B}</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/85 md:text-xl">
            Commercial concrete, foundations, flatwork, demolition and full-service general contracting in{" "}
            {site.city}, {site.state} and the surrounding area — quoted in writing, delivered to spec, and
            walked with you at the end.
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <CallButton
              variant="gold"
              location="hero"
              className="cta-conic animate-glow text-base"
            />
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/20"
            >
              Get a Quote
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#projects"
              className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white/85 hover:text-white"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                <Play className="h-3.5 w-3.5 fill-white text-white" />
              </span>
              See our work
            </a>
          </div>

          {/* Stat ribbon — composed/evidence-backed claims only */}
          {stats.length > 0 && (
            <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-5 border-t border-white/15 pt-8 sm:grid-cols-4">
              {stats.slice(0, 4).map((s, i) => (
                <div
                  key={s.v + s.k}
                  className="animate-fade-up"
                  style={{ animationDelay: `${0.15 + i * 0.08}s` }}
                >
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/60">
                    <s.icon className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                    {s.v}
                  </dt>
                  <dd className="mt-1 font-display text-2xl font-semibold text-white">{s.k}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Scroll cue */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-4 hidden justify-center text-white/60 md:flex"
        >
          <ChevronDown className="scroll-indicator h-6 w-6" />
        </div>
      </div>
    </section>
  );
}
