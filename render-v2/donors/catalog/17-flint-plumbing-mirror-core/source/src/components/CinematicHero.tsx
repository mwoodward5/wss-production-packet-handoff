/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the hero renderer. Video reel OR Ken Burns stills.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE CHANGES INSTEAD:
 * │   clientConfig.hero.mode        <- "video" if you produced a reel, else "kenburns"
 * │   clientConfig.hero.videoSrc    <- /public/hero/hero.mp4  (h264, <=18s, <=8MB, muted)
 * │   clientConfig.hero.videoPoster <- /public/hero/poster.jpg
 * │   clientConfig.hero.stills[]    <- /public/hero/still-1..3.jpg (Places photos or generated)
 * │   clientConfig.hero.kicker/headline/headlineAccent/sub <- Firecrawl scrape h1 + tagline
 * │   clientConfig.brand.logoScale  <- 1 = 34px baseline; 2 = current build
 * │ IF YOU CANNOT SOURCE A FIELD: leave mode "kenburns"; stills always work.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Hero assets
 * └──────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";

import { clientConfig, type ClientConfig } from "@/client.config";
import { useReducedMotion } from "@/trust-widgets/hooks/useReducedMotion";

/**
 * The one bespoke element of the template: a cinematic hero that runs either a
 * looping background video or a Ken Burns still sequence, driven entirely from
 * `clientConfig.hero`. Swap the config and every mirror gets its own hero
 * without touching this file.
 */
export function CinematicHero({
  cfg = clientConfig,
  children,
  overlay,
}: {
  cfg?: ClientConfig;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const stills = cfg.hero.stills;
  const [index, setIndex] = React.useState(0);
  const [videoFailed, setVideoFailed] = React.useState(false);
  const useVideo = !videoFailed && cfg.hero.mode === "video" && Boolean(cfg.hero.videoSrc) && !reduced;

  React.useEffect(() => {
    if (useVideo || reduced || stills.length < 2) return;
    const ms = (cfg.hero.stillDurationSec ?? 7) * 1000;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % stills.length), ms);
    return () => window.clearInterval(id);
  }, [useVideo, reduced, stills.length, cfg.hero.stillDurationSec]);

  return (
    <div className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-30" aria-hidden>
        {useVideo ? (
          <video
            className="size-full object-cover"
            src={cfg.hero.videoSrc}
            poster={cfg.hero.videoPoster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        ) : (
          stills.map((s, i) => (
            <img
              key={s.src}
              src={s.src}
              alt=""
              aria-hidden
              width={1920}
              height={1080}
              {...(i === 0 ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
              className={
                "absolute inset-0 size-full object-cover transition-opacity duration-[1600ms] ease-out " +
                (i === index ? "opacity-100" : "opacity-0") +
                (reduced ? "" : " hero-kenburns")
              }
              style={
                {
                  transformOrigin: s.origin ?? "50% 50%",
                  animationDuration: `${(cfg.hero.stillDurationSec ?? 7) + 3}s`,
                  animationPlayState: i === index ? "running" : "paused",
                  "--kb-from": s.from ?? "scale(1.05)",
                  "--kb-to": s.to ?? "scale(1.16)",
                } as React.CSSProperties
              }
            />
          ))
        )}
      </div>

      {/* legibility + brand wash */}
      <div className="absolute inset-0 -z-20 bg-[color-mix(in_oklab,var(--petrol-deep)_78%,transparent)]" aria-hidden />
      <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} aria-hidden />
      <div
        className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-b from-transparent to-background"
        aria-hidden
      />

      {overlay}
      {children}
    </div>
  );
}

/**
 * Header logo + wordmark, pulled from the mirror config.
 * Size = 44px * clientConfig.brand.logoScale (defaults to 1). Nothing here is
 * client-specific — swap logoSrc/logoScale in src/client.config.ts only.
 */
export function BrandMark({ cfg = clientConfig }: { cfg?: ClientConfig }) {
  const size = Math.round(44 * (cfg.brand.logoScale ?? 1));
  return (
    <a href="/" className="flex items-center gap-3">
      {cfg.brand.logoSrc ? (
        <img
          src={cfg.brand.logoSrc}
          alt={cfg.brand.logoAlt ?? `${cfg.brand.wordmark} logo`}
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="object-contain shrink-0 drop-shadow-[0_6px_18px_rgba(0,0,0,.45)]"
        />
      ) : null}

      <span className="leading-tight">
        <span className="block font-[Archivo] text-lg font-extrabold uppercase tracking-[0.16em] text-cream">
          {cfg.brand.wordmark}
        </span>
        {cfg.brand.wordmarkSub ? (
          <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-mint">
            {cfg.brand.wordmarkSub}
          </span>
        ) : null}
      </span>
    </a>
  );
}
