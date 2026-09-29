import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router"; // swap to react-router-dom or <a>
import { ArrowRight, Clock, ShieldCheck, Wrench } from "lucide-react";
import { CallButton } from "./CallButton"; // build your own <CallButton /> — see README
import { HeroWelcomeAudio } from "./_deps/HeroWelcomeAudio";
import { ASSETS } from "./_deps/manifest.example"; // your asset manifest

const VIDEO_START_SEC = 0;

/**
 * Full-viewport cinematic hero with a looping video background.
 * Includes an optional "welcome audio" (voice + fading music bed).
 */
export function HeroCinematic() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seekStart = () => { try { if (v.currentTime < VIDEO_START_SEC) v.currentTime = VIDEO_START_SEC; } catch {} };
    const onLoop = () => { v.currentTime = VIDEO_START_SEC; };
    v.addEventListener("loadedmetadata", seekStart);
    v.addEventListener("ended", onLoop);
    if (v.readyState >= 1) seekStart();
    return () => {
      v.removeEventListener("loadedmetadata", seekStart);
      v.removeEventListener("ended", onLoop);
    };
  }, []);

  return (
    <section className="relative isolate flex min-h-[92vh] w-full items-center overflow-hidden bg-[color:var(--asphalt)] text-white">
      {/* Full-bleed video */}
      <video ref={videoRef}
             className="absolute inset-0 -z-20 h-full w-full object-cover"
             src={`${ASSETS.hero_video.url}#t=${VIDEO_START_SEC}`}
             poster={ASSETS.hero_poster.url}
             autoPlay muted loop playsInline preload="metadata" aria-hidden />
      {/* Cinematic scrim */}
      <div className="absolute inset-0 -z-10" style={{
        background: "linear-gradient(110deg, color-mix(in oklab, var(--asphalt) 85%, transparent) 0%, color-mix(in oklab, var(--asphalt) 55%, transparent) 55%, color-mix(in oklab, var(--asphalt) 25%, transparent) 100%), linear-gradient(180deg, color-mix(in oklab, black 30%, transparent) 0%, transparent 40%, color-mix(in oklab, black 35%, transparent) 100%)",
      }} />

      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-36">
        {/* Mobile-only centered logo + welcome audio */}
        <div className="mb-8 flex flex-col items-center gap-5 lg:hidden">
          <img src={ASSETS.logo.url} alt="Business logo"
               className="h-40 w-auto max-w-[80vw] drop-shadow-[0_10px_30px_rgba(0,0,0,0.45)] sm:h-48"
               width={420} height={192} />
          <HeroWelcomeAudio />
        </div>

        <div className="mx-auto flex max-w-3xl flex-col items-center text-center soft-rise lg:mx-0 lg:items-start lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20 backdrop-blur">
            <span className="sun-pulse size-2 rounded-full bg-[color:var(--banana)]" />
            Austin · Buda · Kyle · San Marcos
          </span>

          <div className="mt-6 font-display leading-[0.9] tracking-tight" aria-hidden>
            <span className="block text-[clamp(3rem,8vw,7rem)]">45 Minutes</span>
            <span className="relative block text-[clamp(3rem,8vw,7rem)] text-[color:var(--banana)]">or Less.</span>
          </div>

          <h1 className="mt-6 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl md:text-[2.75rem]">
            Reliable Roadside Assistance in Austin TX When You Need It Most.
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg">
            One call, a friendly voice, and a truck already moving your way — anywhere in the Austin metro.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
            <CallButton size="xl" />
            <Link to="/services"
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/10">
              See what we handle
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="mt-8 hidden lg:block">
            <HeroWelcomeAudio />
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/80 lg:justify-start">
            <span className="inline-flex flex-col items-center gap-1 lg:items-start">
              <span className="inline-flex items-center gap-2">
                <Clock className="size-4 text-[color:var(--banana)]" />
                Sun – Thu · 7am – 5pm · Closed Fri & Sat
              </span>
              <span className="text-xs text-[color:var(--banana)]/90">Calls after hours will incur an extra charge.</span>
            </span>
            <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-[color:var(--banana)]" />BBB Accredited</span>
            <span className="inline-flex items-center gap-2"><Wrench className="size-4 text-[color:var(--banana)]" />1,500+ five-star reviews</span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
