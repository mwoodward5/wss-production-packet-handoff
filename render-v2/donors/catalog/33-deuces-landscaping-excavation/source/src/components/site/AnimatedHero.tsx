/**
 * AnimatedHero — DEUCES cinematic hero powered by a real client jobsite photo.
 * Layers: real photo + brand wash + dust + light sweep + animated stats + dual CTA.
 */
import { Link } from "@/wss/Link";
import { useEffect, useRef, useState } from "react";
import { Phone, ArrowRight, MapPin, MessageSquare } from "lucide-react";
import { CLIENT, BRAND, HERO, HOURS } from "@/config";
import { WSS } from '@/wss/bridge';
import { HeroMedia } from '@/wss/HeroMedia';

interface HeroProps {
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

function resolveCopy(props: HeroProps) {
  return {
    eyebrow: props.eyebrow ?? HERO.eyebrow ?? `${CLIENT.city}, ${CLIENT.region} · ${CLIENT.serviceAreaLabel}`,
    headline: props.headline ?? HERO.headline ?? CLIENT.businessName,
    subhead: props.subhead ?? HERO.subheadline ?? CLIENT.shortDescription,
    primary: props.primaryCta ?? HERO.primaryCta,
    secondary: props.secondaryCta ?? HERO.secondaryCta,
  };
}

const STATS = WSS.trust.stats.filter((s):s is {value:number;label:string;suffix?:string} => !!s && typeof s==='object' && 'value' in s && typeof s.value==='number' && 'label' in s && typeof s.label==='string');

function useCountUp(target: number, ready: boolean, durationMs = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!ready) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(t === 1 ? target : Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ready, durationMs]);
  return value;
}

function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.4 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const n = useCountUp(value, visible);
  return <span ref={ref}>{n}{suffix ?? ""}</span>;
}

export function AnimatedHero(props: HeroProps = {}) {
  const { eyebrow, subhead, primary, secondary } = resolveCopy(props);
  const primaryIsTel = primary.href.startsWith("tel:");
  const secondaryIsTel = secondary.href.startsWith("tel:");

  return (
    <section className="relative overflow-hidden isolate bg-black">
      {/* Cinematic background layer — real DEUCES jobsite photo */}
      <div className="absolute inset-0 -z-10">
        <HeroMedia />
        {/* Brand color wash + readability gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, oklch(0.16 0.02 80 / 0.82) 0%, oklch(0.18 0.03 75 / 0.62) 45%, oklch(0.16 0.04 70 / 0.45) 100%)",
          }}
        />
        {/* Yellow brand-accent radial glow */}
        <div
          className="absolute inset-0 opacity-70 mix-blend-screen pointer-events-none"
          style={{
            background:
              "radial-gradient(60% 70% at 85% 25%, oklch(0.85 0.16 90 / 0.22), transparent 60%)",
          }}
        />
        {/* Bottom vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 0%, transparent 35%, oklch(0.06 0 0 / 0.65) 100%)",
          }}
        />
        {/* Drifting dust haze */}
        <div
          className="absolute inset-0 animate-dust mix-blend-screen pointer-events-none"
          style={{
            background:
              "radial-gradient(40% 60% at 30% 70%, oklch(0.88 0.12 85 / 0.14), transparent 70%), radial-gradient(35% 55% at 75% 55%, oklch(0.92 0.10 90 / 0.10), transparent 70%)",
          }}
        />
        {/* Light sweep */}
        <div
          className="absolute inset-y-0 -left-1/3 w-1/2 animate-light-sweep pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.07) 50%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 pt-20 md:pt-28 pb-20 md:pb-28 grid lg:grid-cols-[1.3fr_1fr] gap-10 lg:gap-16 items-center">
        <div className="reveal-up text-white">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.88_0.18_95/0.55)] bg-black/35 backdrop-blur px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[oklch(0.92_0.16_92)]">
            <MapPin className="w-3 h-3" /> {eyebrow}
          </span>

          <h1 className="mt-6 text-[2.5rem] sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.02] tracking-tight font-display drop-shadow-[0_2px_20px_rgba(0,0,0,0.55)]">
            <span className="block text-white">{WSS.hero.line1}</span>
            <span className="block text-[var(--hero-accent)]">{WSS.hero.emphasis}</span>
            <span className="block text-white">{WSS.hero.line3}</span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-white/90 max-w-2xl leading-relaxed drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]">
            {subhead}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {primaryIsTel ? (
              <a href={primary.href} className="btn-gold"><Phone className="w-4 h-4" /> {primary.label}</a>
            ) : (
              <Link to={primary.href as "/contact"} className="btn-gold">
                {primary.label} <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {secondaryIsTel ? (
              <a
                href={secondary.href}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold border border-white/40 bg-white/10 backdrop-blur text-white hover:bg-white/20 transition"
              >
                <MessageSquare className="w-4 h-4" /> {secondary.label}
              </a>
            ) : (
              <Link
                to={secondary.href as "/contact"}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold border border-white/40 bg-white/10 backdrop-blur text-white hover:bg-white/20 transition"
              >
                {secondary.label}
              </Link>
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/85">
            {WSS.trust.badges.map(b=><span key={b.label} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-primary" />{b.label}</span>)}
            {HOURS && <span>{HOURS}</span>}
            {WSS.trust.aggregate && <a href={WSS.trust.aggregate.sourceUrl} target="_blank" rel="noopener noreferrer">{WSS.trust.aggregate.rating} / 5 · {WSS.trust.aggregate.count} reviews</a>}
          </div>
        </div>

        {/* Equipment-badge logo card */}
        <div className="relative hidden lg:block">
          <div className="relative mx-auto max-w-sm">
            <div
              className="absolute -inset-6 rounded-3xl blur-2xl opacity-70"
              style={{ background: "radial-gradient(closest-side, oklch(0.88 0.18 95 / 0.55), transparent 70%)" }}
            />
            <div className="relative rounded-2xl border border-[oklch(0.88_0.18_95/0.4)] bg-black/55 backdrop-blur-md p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
              <div className="flex items-center justify-between text-[0.6rem] font-bold tracking-[0.3em] uppercase text-[var(--hero-accent)]">
                <span>{WSS.identity.founded ? `Est. ${WSS.identity.founded}` : WSS.identity.businessName}</span>
                <span>{WSS.identity.state}</span>
              </div>
              <div className="mt-6 flex items-center justify-center">
                <img
                  src={BRAND.logoDark}
                  alt={CLIENT.businessName}
                  className="w-48 h-auto animate-float drop-shadow-[0_8px_30px_rgba(244,218,22,0.5)]"
                />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 text-[0.65rem] font-semibold uppercase tracking-wider text-white/85">
                {WSS.services.slice(0,4).map(s=><div key={s.name} className="rounded-md border border-white/15 bg-white/5 py-1.5 text-center">{s.shortLabel}</div>)}
              </div>
              <div className="mt-6 pt-4 border-t border-white/10 text-center text-[0.65rem] tracking-[0.25em] uppercase text-white/60">
                {WSS.trust.areas.join(" · ")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      {STATS.length > 0 && <div className="relative border-t border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center md:text-left">
              <div className="text-3xl md:text-4xl font-bold text-[var(--hero-accent)] font-display tabular-nums">
                <CountUp value={s.value} suffix={s.suffix} />
              </div>
              <div className="text-[0.7rem] md:text-xs uppercase tracking-widest text-white/70 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>}
    </section>
  );
}
