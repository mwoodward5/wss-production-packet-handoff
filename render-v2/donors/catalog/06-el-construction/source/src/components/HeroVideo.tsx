import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Play, ShieldCheck, Clock, MapPin, Star } from "lucide-react";

import { CallButton } from "./CallButton";
import { site, client, stats as certifiedStats, gallery } from "@/lib/site";
import {heroVideoSource} from '@/lib/wss-bridge';

// The certified hero asset is a text graphic. Use the source-site photograph
// when present so the first viewport shows the business's actual work.
const heroImg=gallery[0]?.path || client.hero.poster;
const HERO_VIDEO_FULL=client.hero.video || null;
const HERO_VIDEO_LITE=HERO_VIDEO_FULL;
const stats=certifiedStats.map(s=>({icon:Star,k:String(s.value),v:s.label}));

type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

function pickVideoStrategy(): { src: string | null } {
  if (typeof navigator === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return { src: null };

  const conn =
    (navigator as Navigator & { connection?: ConnectionLike }).connection ?? null;

  if (!heroVideoSource(client.hero.video, window.matchMedia('(prefers-reduced-motion: reduce)').matches, conn || undefined)) return {src:null};

  // 1. Save-Data → poster only
  if (conn?.saveData) return { src: null };

  // 2. 2G/3G → poster only
  const et = conn?.effectiveType;
  if (et === "slow-2g" || et === "2g" || et === "3g") return { src: null };

  // 3. Small viewport OR weak 4G → lite encode
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const weak4G = et === "4g" && typeof conn?.downlink === "number" && conn.downlink < 2;
  if (w < 768 || weak4G) return { src: HERO_VIDEO_LITE };

  // 4. Default → full
  return { src: HERO_VIDEO_FULL };
}

export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Reduced-motion subscription
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Mount the video immediately on hydration so it starts loading with the page.
  // The poster image still paints first (it's in the SSR HTML), so LCP stays fast,
  // but the video fetch kicks off right away instead of waiting for idle time.
  useEffect(() => {
    if (reducedMotion) {
      setVideoSrc(null);
      return;
    }
    const { src } = pickVideoStrategy();
    setVideoSrc(src);
  }, [reducedMotion]);

  // Kick playback once the video element exists
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const tryPlay = () => v.play().catch(() => undefined);
    const onReady = () => {
      setLoaded(true);
      tryPlay();
    };
    tryPlay();
    if (v.readyState >= 2) {
      onReady();
      return;
    }
    v.addEventListener("loadeddata", onReady, { once: true });
    v.addEventListener("canplay", onReady, { once: true });
    return () => {
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
    };
  }, [videoSrc]);

  const showVideo = !!videoSrc && !reducedMotion;
  const showAnimatedOverlays = !reducedMotion;

  return (
    <section
      className="relative isolate overflow-hidden bg-primary"
      aria-label={site.name}
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
          className={`h-full w-full object-cover transition-opacity duration-700 ${
            showVideo && loaded ? "opacity-0" : "opacity-100"
          }`}
        />
        {showVideo && (
          <video
            ref={videoRef}
            aria-hidden="true"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            poster={heroImg}
            onCanPlay={() => setLoaded(true)}
            onError={() => {setLoaded(false); setVideoSrc(null);}}
          />
        )}
        {/* No-JS fallback: ensure poster shows */}
        <noscript>
          <img
            src={heroImg}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </noscript>
        {/* Cinematic gradient grade — navy bottom, warm fade top, red glow accent */}
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/50 to-primary/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/45 to-transparent" />
        {/* Brand-red rim glow on the right edge */}
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
      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:pt-20 lg:px-6 lg:pb-24 lg:pt-24">
        <div className="min-w-0 max-w-2xl text-primary-foreground">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md animate-fade-up">
            <span className="relative flex h-2 w-2">
              {!reducedMotion && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              )}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
            </span>
            {client.hero.eyebrow}
          </div>

          {/* Headline */}
          <h1 className="mt-6 break-words font-display text-[clamp(2rem,9vw,3rem)] font-semibold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4.5rem]">
            {client.hero.line1}{" "}<span className="block text-gradient-gold">{client.hero.emphasis}</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/85 md:text-xl">
            {client.hero.support}
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <CallButton
              variant="gold"
              location="hero"
              label={`Call ${site.phone}`}
              className="cta-conic animate-glow text-base"
            />
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/20"
            >
              Get a Quote
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            {gallery.length > 0 && <a
              href="#projects"
              className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white/85 hover:text-white"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                <Play className="h-3.5 w-3.5 fill-white text-white" />
              </span>
              See our work
            </a>}
          </div>

          {/* Stat ribbon */}
          {stats.length > 0 && <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-5 border-t border-white/15 pt-8 sm:grid-cols-4">
            {stats.map((s, i) => (
              <div
                key={s.v}
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
          </dl>}
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
