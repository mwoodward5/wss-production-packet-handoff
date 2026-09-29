import {ClientImage} from "./ClientImage";
import {aggregate,client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock, ShieldCheck, Wrench } from "lucide-react";
import { CallButton } from "./CallButton";
import { HeroWelcomeAudio } from "./HeroWelcomeAudio";
import { BrandMarquee } from "./BrandMarquee";
import { ASSETS } from "@/assets/manifest";

export function HeroCinematic() {
  const [reduce,setReduce]=useState(true);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{const m=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduce(m.matches);update();m.addEventListener('change',update);return ()=>m.removeEventListener('change',update)},[]);
  return (
    <section className="relative isolate flex min-h-[92vh] w-full items-center overflow-hidden bg-[color:var(--asphalt)] text-white">
      {/* Full-bleed video */}
      <ClientImage src={client.hero.poster} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
      {client.hero.video && !reduce && !failed && <video
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        src={client.hero.video} poster={client.hero.poster} autoPlay muted loop playsInline preload="metadata" aria-hidden onError={()=>setFailed(true)}
      />}
      {/* Cinematic scrim for legibility */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(110deg, color-mix(in oklab, var(--asphalt) 85%, transparent) 0%, color-mix(in oklab, var(--asphalt) 55%, transparent) 55%, color-mix(in oklab, var(--asphalt) 25%, transparent) 100%), linear-gradient(180deg, color-mix(in oklab, black 30%, transparent) 0%, transparent 40%, color-mix(in oklab, black 35%, transparent) 100%)",
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-36">
        {/* Mobile-only: giant centered hero logo + tagline + brand carousel + welcome audio */}
        <div className="mb-8 flex flex-col items-center gap-5 lg:hidden">
          <ClientImage
            src={client.identity.logoOnDark}
            alt={client.identity.businessName}
            className="h-40 w-auto max-w-[80vw] drop-shadow-[0_10px_30px_rgba(0,0,0,0.45)] sm:h-48"
            width={420}
            height={192}
          />
          <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] sm:text-base">
            {client.hero.eyebrow}
          </p>
          <BrandMarquee variant="hero" />
          <HeroWelcomeAudio />
        </div>

        <div className="mx-auto flex max-w-3xl flex-col items-center text-center soft-rise lg:mx-0 lg:items-start lg:text-left">
          <p className="mb-4 hidden text-base font-semibold uppercase tracking-[0.2em] text-[color:var(--banana)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] lg:block">
            {client.hero.eyebrow}
          </p>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20 backdrop-blur">
            <span className="sun-pulse size-2 rounded-full bg-[color:var(--banana)]" />
            {client.trust.areas.join(" · ") || `${client.identity.city}, ${client.identity.state}`}
          </span>


          <div className="mt-6 font-display leading-[0.9] tracking-tight" aria-hidden>
            <span className="block text-[clamp(3rem,8vw,7rem)]">{client.hero.line1}</span>
            <span className="relative block text-[clamp(3rem,8vw,7rem)] text-[color:var(--banana)]">
              {client.hero.emphasis}
            </span>
          </div>

          <h1 className="mt-6 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl md:text-[2.75rem]">
            {client.hero.line3}
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg">{client.hero.support}</p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
            <CallButton size="xl" />
            <Link
              to="/services"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/10"
            >
              See what we handle
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {/* Desktop-only: brand carousel above the click-to-play greeting */}
          <div className="mt-8 hidden w-full max-w-2xl lg:block">
            <BrandMarquee variant="hero" />
            <HeroWelcomeAudio />
          </div>


          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/80 lg:justify-start">
            {hoursText && <span className="inline-flex items-center gap-2"><Clock className="size-4 text-[color:var(--banana)]"/>{hoursText}</span>}
            {client.trust.badges.map(b=><span key={b.label} className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-[color:var(--banana)]"/>{b.label}</span>)}
            {aggregate && <a href={aggregate.sourceUrl}>{aggregate.rating}/5 · {aggregate.count} reviews</a>}
          </div>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
