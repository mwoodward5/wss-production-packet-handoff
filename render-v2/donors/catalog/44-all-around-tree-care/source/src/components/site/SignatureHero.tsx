/**
 * SignatureHero — All-Around Tree Care bespoke composition.
 * Asymmetric: left = stacked headline + live stat console,
 * right = layered tree-canopy photo with branch-line geometry, stump-ring overlay,
 * drifting sawdust particles, and overlapping JobCommandWidget.
 */
import { Phone, MessageSquare, Star, ShieldCheck, Clock3, CloudLightning, MapPin, Crosshair } from "lucide-react";
import { CLIENT, HERO } from "@/config";
import { JobCommandWidget } from "./JobCommandWidget";
import { DATA } from "@/wss/bridge";
import { useEffect, useState } from "react";

function HeroMedia() {
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const className = "absolute inset-0 w-full h-full object-cover";
  return DATA.hero.video && !reduced && !failed
    ? <video src={DATA.hero.video} poster={DATA.hero.poster} autoPlay loop muted playsInline onError={() => setFailed(true)} className={className} aria-label={DATA.identity.businessName} />
    : <img src={DATA.hero.poster} alt={DATA.identity.businessName} className={className} />;
}

function SawdustParticles() {
  // 18 deterministic particles drifting upward — feels like sawdust catching afternoon light.
  const dots = Array.from({ length: 18 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i * 0.6) % 8,
    duration: 6 + ((i * 1.3) % 6),
    size: 2 + (i % 3),
    opacity: 0.4 + ((i % 4) * 0.12),
  }));
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute bottom-0 rounded-full bg-[#D7B46A] animate-sawdust"
          style={{
            left: `${d.left}%`,
            width: `${d.size}px`,
            height: `${d.size}px`,
            opacity: d.opacity,
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function BranchGeometry() {
  // Subtle hand-drawn branch lines that trace across the hero.
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.18] mix-blend-multiply"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="branch-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#3a2418" />
          <stop offset="1" stopColor="#FF9400" />
        </linearGradient>
      </defs>
      <g stroke="url(#branch-grad)" strokeWidth="1.2" fill="none" strokeLinecap="round">
        <path d="M0,520 C180,460 280,510 420,420 C540,345 620,380 760,300 C880,232 980,250 1200,180" className="animate-branch-trace" />
        <path d="M0,600 C160,560 260,580 400,510 C520,452 600,470 740,400 C860,340 960,360 1200,300" className="animate-branch-trace-2" />
        <path d="M120,80 C220,140 280,120 420,200 C540,266 620,240 760,320 C880,388 980,360 1200,440" className="animate-branch-trace-3" />
      </g>
    </svg>
  );
}

function StumpRings() {
  // Concentric rings — like a freshly cut stump, anchored bottom-right.
  return (
    <svg
      className="absolute -bottom-20 -right-20 w-[420px] h-[420px] pointer-events-none opacity-25"
      viewBox="0 0 400 400"
      aria-hidden
    >
      <g fill="none" stroke="#3a2418" strokeWidth="1">
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx="200" cy="200" r={20 + i * 14} opacity={0.6 - i * 0.04} />
        ))}
      </g>
    </svg>
  );
}

export function SignatureHero() {
  return (
    <section className="relative overflow-hidden bg-[oklch(0.97_0.015_85)]">
      {/* warm canopy wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 80% at 85% 20%, oklch(0.62 0.10 80 / 0.30) 0%, transparent 60%), radial-gradient(ellipse 60% 70% at 10% 90%, oklch(0.40 0.08 22 / 0.18) 0%, transparent 65%)",
        }}
      />
      <BranchGeometry />
      <StumpRings />

      <div className="absolute inset-x-0 bottom-0 h-28 pointer-events-none bg-[linear-gradient(90deg,rgba(255,148,0,0.10)_1px,transparent_1px),linear-gradient(0deg,rgba(79,95,62,0.12)_1px,transparent_1px)] bg-[size:54px_54px] opacity-60" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 pt-12 pb-16 md:pt-16 md:pb-24 grid lg:grid-cols-[0.92fr_1.08fr] gap-8 lg:gap-12 items-center">
        {/* ===== LEFT: headline + live stat console ===== */}
        <div className="relative z-10">
          {/* Coordinate-style eyebrow — feels like a dispatch ticket. Desktop: stripped chrome, ~40% smaller. */}
          <div className="inline-flex items-center gap-2 rounded-md bg-[#151815] text-[oklch(0.92_0.08_85)] px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase border border-[var(--gold)]/30 shadow-[0_4px_20px_-6px_rgba(20,30,20,0.4)] md:border-0 md:bg-transparent md:shadow-none md:px-0 md:py-0 md:text-[8px] md:tracking-[0.16em] md:text-foreground/55 md:gap-1.5">
            <span className="inline-block h-1.5 w-1.5 md:h-1 md:w-1 rounded-full bg-[var(--gold)] animate-pulse" />
            {DATA.hero.eyebrow}
          </div>


          <h1
            className="mt-5 text-[2.5rem] sm:text-5xl lg:text-[4.25rem] font-bold leading-[1.02] tracking-tight text-[#1a1d1a]"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            {DATA.hero.line1}{" "}
            <span className="relative inline-block">
              <span className="relative z-10 italic text-[#FF9400]">{DATA.hero.emphasis}</span>
              <span className="absolute bottom-1 left-0 right-0 h-3 bg-[var(--gold)]/40 -skew-x-6 z-0" />
            </span>{" "}{DATA.hero.line3}
          </h1>

          <p className="mt-5 text-lg text-foreground/75 max-w-xl leading-relaxed">
            {DATA.hero.support}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`tel:${CLIENT.phoneE164}`}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgba(255,148,0,0.6)] hover:-translate-y-0.5 transition-transform"
              style={{ background: "linear-gradient(135deg, #FF9400 0%, #5a2424 100%)" }}
            >
              <Phone className="w-4 h-4" /> Call {CLIENT.phone}
            </a>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-white/80 backdrop-blur border border-foreground/15 px-5 py-3.5 text-sm font-bold text-foreground hover:bg-white"
            >
              <MessageSquare className="w-4 h-4" /> Contact us
            </a>
            <a
              href="#dispatch"
              className="inline-flex items-center gap-2 rounded-full bg-[#151815] px-5 py-3.5 text-sm font-bold text-white hover:opacity-90"
            >
              Plan your request
            </a>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/65">
            {DATA.services.map((s) => s.shortLabel).map((label) => (
              <span key={label} className="rounded-full border border-[#FF9400]/20 bg-white/70 px-3 py-1.5">{label}</span>
            ))}
          </div>

          {DATA.trust.badges.length > 0 && <div className="mt-8 grid grid-cols-3 gap-px rounded-2xl overflow-hidden bg-foreground/10 border border-foreground/10 shadow-[var(--shadow-card)]">
            {DATA.trust.badges.slice(0, 3).map((badge) => <div key={badge.label} className="bg-white p-4">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground/55"><ShieldCheck className="w-3 h-3 text-[var(--gold)]" />{badge.label}</div>
              {badge.sublabel && <div className="mt-1 text-lg font-bold text-foreground">{badge.sublabel}</div>}
              {badge.meta && <div className="text-[10px] text-foreground/55">{badge.meta}</div>}
            </div>)}
          </div>}

        </div>

        {/* ===== RIGHT: layered photo + sawdust + overlapping widget ===== */}
        <div id="dispatch" className="relative">
          {/* Photo column — tall, framed in burgundy edge */}
          <div className="relative aspect-[4/5] lg:aspect-[3/4.2] rounded-[2rem] overflow-hidden border border-foreground/10 shadow-[0_40px_100px_-30px_rgba(20,30,20,0.55)]">
            <HeroMedia />
            {/* warm tint */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, oklch(0.18 0.02 140 / 0.20) 60%, oklch(0.18 0.02 140 / 0.55) 100%)",
              }}
            />
            <SawdustParticles />

            {/* property-line scanner */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-70 animate-property-scan" />
            <div className="absolute left-[12%] top-[18%] h-24 w-24 rounded-full border border-white/45 animate-storm-pulse" />
            <div className="absolute left-[24%] top-[42%] h-16 w-16 rounded-full border border-[var(--gold)]/60 animate-storm-pulse [animation-delay:1.4s]" />

            <div className="absolute right-4 top-4 grid gap-2 text-white">
              <div className="rounded-xl border border-white/25 bg-black/35 backdrop-blur px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--gold)]"><CloudLightning className="h-3 w-3" /> Services</div>
                <div className="text-xs font-semibold">{DATA.services[0].name}</div>
              </div>
              <div className="rounded-xl border border-white/25 bg-black/35 backdrop-blur px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--gold)]"><MapPin className="h-3 w-3" /> Location</div>
                <div className="text-xs font-semibold">{CLIENT.city}, {CLIENT.region}</div>
              </div>
            </div>

            {/* corner caption */}
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 text-white">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)] font-semibold">
                  {CLIENT.businessName}
                </div>
                <div className="text-sm font-semibold drop-shadow">{DATA.hero.eyebrow}</div>
              </div>
              <div className="rounded-full bg-white/15 backdrop-blur px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border border-white/30">
                <Crosshair className="mr-1 inline h-3 w-3" /> {CLIENT.city}
              </div>
            </div>
          </div>

          {/* Overlapping JobCommandWidget — desktop overlaps photo, mobile sits below */}
          <div className="mt-6 lg:mt-0 lg:absolute lg:-bottom-10 lg:-left-12 lg:w-[420px] xl:w-[440px] lg:z-20">
            <JobCommandWidget />
          </div>
        </div>
      </div>
    </section>
  );
}
