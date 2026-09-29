import {site, portrait} from "@/lib/wss";
import {heroPlaybackAllowed} from '@/lib/hero-playback';
import { useEffect, useRef, useState } from "react";
import { Link } from "@/lib/navigation";



import { business } from "@/lib/business";

const heroVideo = {url:site.hero.video};
const heroPoster=site.hero.poster;

/**
 * HeroFlagship — "Field Journal" edition.
 *
 * A 100% bespoke hero for Peppers Structural & Land Management.
 * Concept: a carpenter's marked-up field journal meets architectural
 * blueprint — every element is a real artifact of how Jim works.
 *
 *   ▸ Blueprint grid backdrop with tape-measure ruler down the left edge
 *   ▸ Big wood-grain rotating seal stamped "Pepper · Genoa · 2015"
 *   ▸ Hand-drawn SVG arrows callout-annotating the craftsman photo
 *   ▸ Dossier card on Jim with hand-stamped date and signature
 *   ▸ Drafting-pencil cursor that underlines the headline word-by-word
 *   ▸ Polaroid-stack of three real project plates, slightly rotated
 *   ▸ Live "open now" pill that hydrates safely (no SSR mismatch)
 *   ▸ Cinematic video plays as a small framed insert, not full-bleed —
 *     gives the hero an unmistakable layout no template can fake.
 */
export function HeroFlagship() {
  return (
    <section
      className="relative isolate overflow-hidden bg-bone text-ink"
      aria-label={business.name}
    >
      <HeroBackdrop />

      <div className="relative z-10 mx-auto grid max-w-[1500px] grid-cols-1 gap-y-12 px-7 pb-20 pt-10 lg:grid-cols-12 lg:gap-x-8 lg:px-14 lg:pb-28 lg:pt-14">
        {/* ============ LEFT — Field journal page ============ */}
        <div className="relative lg:col-span-7">
          <JournalHeader />
          <HeadlineBlock />
          <BodyParagraph />
          <CTABlock />
          <SignatureBlock />
        </div>

        {/* ============ RIGHT — Visual dossier ============ */}
        <div className="relative lg:col-span-5">
          <CraftsmanPlate />
          <PolaroidStack />
          <FramedFilmInsert />
          <LiveOpenPill />
          <RotatingSeal />
        </div>
      </div>

      <BlueprintFooter />
      <PencilCursorStyles />
    </section>
  );
}

/* =========================================================================
 * HERO BACKDROP — warm paper wash (map/blueprint treatment removed)
 * ========================================================================= */
function HeroBackdrop() {
  return (
    <>
      <div aria-hidden className="absolute inset-0 z-0 bg-gradient-to-br from-bone via-cream to-bone/60" />
      <div aria-hidden className="grain absolute inset-0 z-0" />
    </>
  );
}

/* TapeMeasureRail removed — was a map-style coordinate tick rail */

/* =========================================================================
 * JOURNAL HEADER — a hand-stamped "field journal" masthead
 * ========================================================================= */
function JournalHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-dashed border-umber/40 pb-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-umber">{site.hero.eyebrow}</p>
        <p className="mt-2 font-display text-sm italic text-charcoal/75">{business.city}, {business.state}</p>
      </div>
      {site.trust.badges[0] && (<div className="rounded-sm border-2 border-clay/70 px-3 py-1.5 text-clay" style={{ transform: "rotate(-2deg)" }}>
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em]">{site.trust.badges[0].label}</p>
      </div>)}
    </div>
  );
}

/* =========================================================================
 * HEADLINE — pencil-underlined word reveal
 * ========================================================================= */
function HeadlineBlock() {
  return (
    <h1 className="mt-8 font-display text-[clamp(2.8rem,7.2vw,6.5rem)] font-light leading-[0.95] tracking-[-0.035em] text-ink"><span className="block">{site.hero.line1}</span><span className="block pencil-underline italic-fraunces text-umber">{site.hero.emphasis}</span><span className="mt-2 block font-display text-[clamp(1.3rem,2.4vw,2rem)] not-italic font-light text-charcoal/70">{site.hero.line3}</span></h1>
  );
}

/* =========================================================================
 * BODY — annotated paragraph with sidebar callout
 * ========================================================================= */
function BodyParagraph() {
  return (
    <div className="mt-10">
      <p className="max-w-2xl text-pretty text-base leading-[1.7] text-charcoal lg:text-lg">{site.hero.support}</p>
    </div>
  );
}

/* =========================================================================
 * CTA BLOCK — annotated with a hand-drawn arrow
 * ========================================================================= */
function CTABlock() {
  return (
    <div className="relative mt-10">
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/contact" className="group relative inline-flex items-center gap-3 bg-ink px-7 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-cream transition-all hover:bg-umber">
          Discuss your project
          <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
        <a
          href={`tel:${business.phoneTel}`}
          className="inline-flex items-center gap-3 border-2 border-ink bg-transparent px-6 py-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink transition-all hover:bg-ink hover:text-cream"
          aria-label={`Call ${business.name} at ${business.phone}`}
        >
          <span aria-hidden>☎</span> {business.phone}
        </a>
      </div>

      {/* hand-drawn arrow + note pointing at the CTA */}
      <svg
        aria-hidden
        viewBox="0 0 220 90"
        className="pointer-events-none absolute -right-6 top-full mt-1 hidden h-20 w-52 sm:block"
        style={{ color: "#2D0905" }}
      >
        <path
          d="M 200 12 Q 140 8 90 36 T 20 78"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="320"
          strokeDashoffset="320"
          style={{ animation: "draw-on 1.6s ease-out 0.8s forwards" }}
        />
        <path
          d="M 26 70 L 18 80 L 30 82 Z"
          fill="currentColor"
          style={{ opacity: 0, animation: "fade-in-late 0.4s ease-out 2.2s forwards" }}
        />
        <text
          x="210"
          y="8"
          textAnchor="end"
          fill="currentColor"
          fontFamily="Fraunces, Georgia, serif"
          fontStyle="italic"
          fontSize="14"
          style={{ opacity: 0, animation: "fade-in-late 0.6s ease-out 1.4s forwards" }}
        >get in touch</text>
      </svg>
    </div>
  );
}

/* =========================================================================
 * SIGNATURE BLOCK — handwritten "Jim" + dossier facts
 * ========================================================================= */
function SignatureBlock() { return <div className="mt-16 grid grid-cols-2 gap-px border-t border-umber/30 pt-6 sm:grid-cols-4"><DossierCell label="Business" value={business.name} sub="" />{business.yearFounded && <DossierCell label="Founded" value={String(business.yearFounded)} sub="" />}<DossierCell label="Based in" value={business.city} sub={business.state} />{site.trust.areas.length > 0 && <DossierCell label="Service areas" value={String(site.trust.areas.length)} sub="" />}</div>; }

function DossierCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-umber">{label}</p>
      <p className="mt-1.5 font-display text-2xl leading-none text-ink">{value}</p>
      <p className="mt-1.5 text-[10px] leading-tight text-charcoal/60">{sub}</p>
    </div>
  );
}

/* =========================================================================
 * CRAFTSMAN PLATE — annotated portrait with callouts
 * ========================================================================= */
function CraftsmanPlate() {
  if (!portrait) return null;
  return (
    <figure className="relative">
      <div className="relative overflow-hidden border-[6px] border-cream shadow-[0_30px_60px_-20px_oklch(0.18_0.02_50/0.45)]">
        <img src={portrait.path} alt={business.name} width={900} height={1100} fetchPriority="high" decoding="async" className="aspect-[4/5] w-full object-cover object-top ken-burns" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/85 to-transparent" />
        <figcaption className="absolute inset-x-0 bottom-0 p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-amber-glow">Plate I</p>
          <p className="mt-1 font-display text-xl italic text-cream">{business.name}</p>
        </figcaption>
      </div>

      {/* SVG annotation overlays — hand-drawn arrows pointing at details */}
      <svg
        aria-hidden
        viewBox="0 0 400 500"
        className="pointer-events-none absolute -left-12 top-12 h-[60%] w-[60%]"
        style={{ color: "#2D0905" }}
        preserveAspectRatio="none"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          style={{
            strokeDasharray: 400,
            strokeDashoffset: 400,
            animation: "draw-on 1.8s ease-out 0.5s forwards",
          }}
        >
          <path d="M 20 80 Q 110 60 180 100" />
          <circle cx="180" cy="100" r="3.5" fill="currentColor" />
        </g>
        <text
          x="14"
          y="68"
          fill="currentColor"
          fontFamily="Fraunces, Georgia, serif"
          fontStyle="italic"
          fontSize="14"
          style={{ opacity: 0, animation: "fade-in-late 0.5s ease-out 1.6s forwards" }}
        >{business.city}</text>
        <text
          x="14"
          y="84"
          fill="currentColor"
          fontFamily="Fraunces, Georgia, serif"
          fontStyle="italic"
          fontSize="14"
          style={{ opacity: 0, animation: "fade-in-late 0.5s ease-out 1.8s forwards" }}
        >{business.state}</text>
      </svg>
    </figure>
  );
}

/* =========================================================================
 * POLAROID STACK — three real project plates rotated like dropped photos
 * ========================================================================= */
function PolaroidStack() { return null; }

function Polaroid({
  src,
  caption,
  rotate,
  z,
  offset,
}: {
  src: string;
  caption: string;
  rotate: number;
  z: number;
  offset: { x: number; y: number };
}) {
  return (
    <div
      className="absolute inset-0 border-[10px] border-cream bg-cream pb-6 shadow-[0_18px_40px_-12px_oklch(0.18_0.02_50/0.5)]"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotate}deg)`,
        zIndex: z,
      }}
    >
      <img src={src} alt="" width={400} height={400} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      <p className="absolute inset-x-0 bottom-1 text-center font-mono text-[8.5px] uppercase tracking-[0.22em] text-charcoal/70">
        {caption}
      </p>
    </div>
  );
}

/* =========================================================================
 * FRAMED FILM INSERT — the cinematic video, but as a small framed plate
 * ========================================================================= */
function FramedFilmInsert() {
  const ref = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    type NetInfo = { saveData?: boolean; effectiveType?: string };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection ?? {};
    const mq=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>setShouldLoad(heroPlaybackAllowed(mq.matches,conn));
    mq.addEventListener('change',update);
    const schedule =
      (window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = schedule(update, { timeout: 3000 });
    return () => {
      const cancel =
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback ??
        window.clearTimeout;
      cancel(id as number);
      mq.removeEventListener('change',update);
    };
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    ref.current?.play().catch(() => setShouldLoad(false));
  }, [shouldLoad]);

  return (
    <div
      className="absolute -right-6 -top-8 z-20 hidden h-44 w-64 overflow-hidden border-[6px] border-ink bg-ink shadow-[0_25px_60px_-15px_oklch(0.18_0.02_50/0.6)] lg:block"
      style={{ transform: "rotate(3deg)" }}
    >
      <img src={heroPoster} alt="" width={640} height={360} className="absolute inset-0 h-full w-full object-cover" aria-hidden />
      {shouldLoad && heroVideo.url && (
        <video
          ref={ref}
          src={heroVideo.url}
          poster={heroPoster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={()=>setShouldLoad(false)}
          className="absolute inset-0 h-full w-full object-cover"
          aria-hidden
        />
      )}
      <div className="absolute inset-0 bg-ink/15" />
      {/* film sprocket bar */}
      <div className="absolute inset-x-0 top-0 flex h-2.5 items-center justify-around bg-ink">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} className="h-1 w-1.5 bg-cream/70" />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-2.5 items-center justify-around bg-ink">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} className="h-1 w-1.5 bg-cream/70" />
        ))}
      </div>
      {/* label tab */}
      <div className="absolute -bottom-3 left-3 bg-amber-glow px-2 py-1">
        <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.22em] text-ink">
          Reel · A
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
 * LIVE OPEN PILL — hydration-safe live status (no Date on first render)
 * ========================================================================= */
function LiveOpenPill() { return null; }

/* =========================================================================
 * ROTATING SEAL — wood-grain disc with stamped trade-mark text
 * ========================================================================= */
function RotatingSeal() { return <div aria-hidden className="absolute -right-3 bottom-10 hidden h-28 w-28 lg:block"><svg viewBox="0 0 120 120" className="h-full w-full animate-[spin_40s_linear_infinite]"><defs><path id="sealText" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0"/></defs><circle cx="60" cy="60" r="54" fill="none" stroke="currentColor"/><text fontSize="10" fill="currentColor"><textPath href="#sealText">{business.name} · {business.city} ·</textPath></text></svg></div>; }

/* =========================================================================
 * BLUEPRINT FOOTER — engineer's title-block strip across the bottom
 * ========================================================================= */
function BlueprintFooter() { return <div className="border-t border-umber/20 px-7 py-4 font-mono text-[9px] uppercase tracking-[0.22em] text-umber">{business.name} · {business.city}, {business.state}</div>; }

function TitleCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-4 py-3">
      <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-amber-glow">{label}</p>
      <p className="mt-1 font-display text-sm text-cream">{value}</p>
    </div>
  );
}

/* =========================================================================
 * Pencil-underline + late-fade keyframes (scoped to hero)
 * ========================================================================= */
function PencilCursorStyles() {
  return (
    <style>{`
      .pencil-underline {
        position: relative;
        display: inline-block;
      }
      .pencil-underline::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: -0.06em;
        height: 0.18em;
        background: #2D0905;
        transform-origin: left center;
        transform: scaleX(0);
        animation: pencil-stroke 0.9s cubic-bezier(0.2, 0.7, 0.1, 1) 0.4s forwards;
        border-radius: 999px;
      }
      @keyframes pencil-stroke {
        from { transform: scaleX(0); }
        to   { transform: scaleX(1); }
      }
      @keyframes fade-in-late {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );
}
