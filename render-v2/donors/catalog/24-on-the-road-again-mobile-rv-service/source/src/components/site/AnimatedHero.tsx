import { WSS } from '@/wss/bridge';
/**
 * Cinematic Ken Burns hero with duotone veil, grain, and route-line schematic.
 */
import { useEffect, useState } from "react";
import { Phone, ArrowRight, MapPin } from "lucide-react";
import { CLIENT } from "@/config";
import { MEDIA } from "@/config/media";

interface CtaProps { label: string; href: string }
interface HeroProps {
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  primaryCta?: CtaProps;
  secondaryCta?: CtaProps;
  slides?: { src: string; alt: string }[];
  rightRail?: React.ReactNode;
}

export function AnimatedHero(props: HeroProps = {}) {
  const eyebrow = props.eyebrow ?? CLIENT.serviceAreaLabel;
  const headline = props.headline ?? CLIENT.businessName;
  const subhead = props.subhead ?? CLIENT.shortDescription;
  const primary = props.primaryCta ?? { label: "Call Now", href: `tel:${CLIENT.phoneE164}` };
  const secondary = props.secondaryCta ?? { label: "Services", href: "/services" };
  const slides = props.slides ?? MEDIA.heroMotion;

  const [reduced, setReduced] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(()=>{const q=matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setReduced(q.matches);update();q.addEventListener("change",update);return ()=>q.removeEventListener("change",update);},[]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if(reduced || WSS.hero.video || slides.length < 2)return;
    const id = setInterval(() => setActive((i) => (i + 1) % slides.length), 5200);
    return () => clearInterval(id);
  }, [slides.length,reduced]);

  return (
    <section className="relative isolate overflow-hidden">
      {/* Ken-Burns slide stack */}
      <div className="absolute inset-0 -z-20" aria-hidden>
        {!reduced && WSS.hero.video && !videoFailed ? <video src={WSS.hero.video} poster={WSS.hero.poster} autoPlay muted loop playsInline onError={()=>setVideoFailed(true)} className="w-full h-full object-cover" /> : (WSS.hero.video ? [{src:WSS.hero.poster,alt:""}] : slides).map((s, i) => (
          <div
            key={s.src}
            className={`absolute inset-0 transition-opacity duration-[1600ms] ${i === active ? "opacity-100" : "opacity-0"}`}
          >
            <img
              src={s.src}
              alt=""
              className={`w-full h-full object-cover ${i === active ? "animate-kenburns" : ""}`}
            />
          </div>
        ))}
      </div>
      {/* Olive/black duotone veil */}
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        aria-hidden
        style={{
          background:
            "linear-gradient(135deg, oklch(0.16 0.01 100 / 0.88) 0%, oklch(0.20 0.03 104 / 0.72) 45%, oklch(0.45 0.08 104 / 0.55) 100%)",
        }}
      />
      {/* Grain */}
      <div className="absolute inset-0 -z-10 opacity-[0.18] mix-blend-overlay pointer-events-none hero-grain" aria-hidden />
      {/* Route-line schematic */}
      <svg className="absolute inset-0 -z-10 w-full h-full opacity-40 pointer-events-none" aria-hidden viewBox="0 0 1440 800" preserveAspectRatio="none">
        <defs>
          <linearGradient id="route" x1="0" x2="1">
            <stop offset="0" stopColor="oklch(0.86 0.06 104)" stopOpacity="0" />
            <stop offset="0.5" stopColor="oklch(0.86 0.06 104)" stopOpacity="0.9" />
            <stop offset="1" stopColor="oklch(0.86 0.06 104)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M -20 620 C 240 580, 380 520, 560 540 S 920 660, 1100 560 S 1380 380, 1480 360"
              fill="none" stroke="url(#route)" strokeWidth="1.5" strokeDasharray="6 8" className="animate-roof-trace" />
        <path d="M -20 700 C 320 700, 540 640, 760 660 S 1080 720, 1480 660"
              fill="none" stroke="oklch(0.86 0.06 104 / 0.35)" strokeWidth="1" strokeDasharray="2 6" />
      </svg>

      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-20 md:pt-28 pb-20 md:pb-28 grid lg:grid-cols-[1.25fr_0.9fr] gap-12 items-center text-white">
        <div className="reveal-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/5 backdrop-blur px-3 py-1 text-xs tracking-wide text-white/90">
            <MapPin className="w-3 h-3" /> {eyebrow}
          </span>
          <h1 className="mt-6 font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.02] tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
            {headline}
          </h1>
          <p className="mt-6 text-base md:text-lg text-white/85 max-w-2xl">{subhead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={primary.href} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3.5 text-sm font-semibold shadow-lg shadow-black/40 hover:translate-y-[-1px] transition-transform">
              <Phone className="w-4 h-4" /> {primary.label}
            </a>
            <a href={secondary.href} className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 backdrop-blur text-white px-6 py-3.5 text-sm font-semibold hover:bg-white/20">
              {secondary.label} <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Trust eyebrow strip */}
          {WSS.trust.badges.length > 0 && <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/75 uppercase tracking-widest">{WSS.trust.badges.map(b=><span key={b.label}>{b.label}</span>)}</div>}
        </div>

        {props.rightRail && (
          <div className="lg:block">{props.rightRail}</div>
        )}
      </div>

      {/* Marquee */}
      <div className="relative border-t border-white/10 bg-black/40 backdrop-blur-sm text-white/80 overflow-hidden">
        <div className="flex whitespace-nowrap animate-marquee py-3 text-xs sm:text-sm tracking-wide">
          {[...Array(2)].map((_, dup) => (
            <div key={dup} className="flex shrink-0 items-center gap-8 pr-8">
              {[...WSS.services.map(s=>s.name),...WSS.trust.areas].map((label) => (
                <span key={`${dup}-${label}`} className="inline-flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
