import { useEffect, useRef, useState } from "react";
import heroPoster from "@/assets/hero-waterfront.jpg";
import MagneticButton from "./MagneticButton";
import SplitText from "./SplitText";
import { fact } from "@/lib/facts";

const BUSINESS_NAME = fact("BUSINESS_NAME");
const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const PHONE = fact("PHONE");
const PHONE_DIGITS = fact("PHONE_DIGITS");
const TEL_HREF = PHONE_DIGITS ? "tel:+1" + PHONE_DIGITS : "";
const LOGO_URL = fact("LOGO_URL");
const RATING = fact("RATING");
const REVIEW_COUNT = fact("REVIEW_COUNT");
const HERO_HEADLINE = fact("HERO_HEADLINE");
const HERO_LINE_A = fact("HERO_LINE_A");
const HERO_LINE_B = fact("HERO_LINE_B");
const HERO_LINE_C = fact("HERO_LINE_C");

// Reduced motion never arms the hero video — the ladder runtime in index.html
// carries the same guard; this one decides whether the element mounts at all.
const heroReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const PARTICLE_COUNT = 10;

function GoldParticles() {
  return (
    <div className="absolute inset-0 pointer-events-none z-[5]">
      {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-gold/30"
          style={{
            width: `${2 + Math.random() * 3}px`,
            height: `${2 + Math.random() * 3}px`,
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
            animation: `float ${5 + Math.random() * 6}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 5}s`,
            filter: "blur(0.5px)",
          }}
        />
      ))}
    </div>
  );
}

export default function Hero() {
  const [scrollY, setScrollY] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const parallaxScale = 1 + scrollY * 0.0004;
  const contentOpacity = Math.max(0, 1 - scrollY * 0.0018);
  const contentTranslate = scrollY * 0.35;

  return (
    <section ref={sectionRef} id="top" className="relative h-screen min-h-[800px] overflow-hidden" aria-label="Hero">
      {/* Cinematic media stack: the design photograph always paints (photo
          slot 1 — a verified client photo replaces the file in place); the
          ladder-armed <video> reveals above it only when a rung's bytes
          shipped. No static src — the ladder runtime in index.html arms it. */}
      <div className="absolute inset-0">
        <img
          src={heroPoster}
          alt="Waterfront estate at golden hour"
          className="absolute inset-0 w-full h-full object-cover will-change-transform"
          style={{ transform: `scale(${parallaxScale})` }}
        />
        {!heroReducedMotion && (
          <video
            data-hero-video
            hidden
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={heroPoster}
            aria-label="Signature property in motion"
            className="absolute inset-0 w-full h-full object-cover will-change-transform"
            style={{ transform: `scale(${parallaxScale})` }}
          />
        )}
        {/* Cinematic vignette + gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/60 via-charcoal/20 to-charcoal/80" />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse at center, transparent 40%, hsl(var(--charcoal) / 0.6) 100%)"
        }} />
      </div>

      {/* Slowly rotating client-logo watermark — only when the engine placed
          a verified logo; the donor ships no mark of its own. */}
      {LOGO_URL && (
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.05] pointer-events-none">
          <img
            src={LOGO_URL}
            alt=""
            className="w-[600px] md:w-[800px] h-auto object-contain"
            style={{
              animation: "rotate-slow 120s linear infinite",
              filter: "drop-shadow(0 0 60px hsl(var(--gold) / 0.15))",
            }}
          />
        </div>
      )}

      {/* Film grain overlay */}
      <div className="absolute inset-0 grain-overlay opacity-[0.04] pointer-events-none" />

      {/* Floating gold particles */}
      <GoldParticles />

      {/* Hero content */}
      <div
        className="relative z-10 h-full flex flex-col justify-center luxury-section"
        style={{
          opacity: contentOpacity,
          transform: `translateY(${contentTranslate}px)`,
        }}
      >
        <div className="w-full max-w-6xl">
          {/* Animated gold line */}
          <div className="luxury-divider-animate revealed mb-10" />

          <p
            className="font-body text-[11px] md:text-xs tracking-[0.4em] uppercase text-gold mb-8 opacity-0 animate-fade-up"
            style={{ animationDelay: "0.4s" }}
          >
            Real Estate &middot; {PLACE}
          </p>

          <h1
            className="font-display font-medium leading-[0.95] text-ivory mb-8 relative"
            style={{
              fontSize: "clamp(2.5rem, 6vw, 6.5rem)",
              textShadow: "0 4px 30px hsl(var(--charcoal) / 0.5)",
            }}
          >
            {HERO_LINE_A && HERO_LINE_B ? (
              <>
                <span className="block overflow-hidden">
                  <SplitText text={HERO_LINE_A} delay={0.5} mode="word" />
                </span>
                <span className="block overflow-hidden">
                  <em className="italic">
                    <SplitText text={HERO_LINE_B} className="text-gold" delay={0.8} mode="word" />
                  </em>
                </span>
                {HERO_LINE_C && (
                  <span className="block overflow-hidden font-display italic text-gold/70 mt-4" style={{ fontSize: "clamp(1rem, 1.8vw, 1.5rem)", lineHeight: 1.4 }}>
                    <SplitText text={HERO_LINE_C} delay={1.1} mode="word" />
                  </span>
                )}
              </>
            ) : (
              <span className="block overflow-hidden">
                <SplitText text={HERO_HEADLINE} delay={0.5} mode="word" />
              </span>
            )}
          </h1>

          {/* Self-drawing gold rule */}
          <div
            className="h-px bg-gold/40 mb-10 opacity-0 animate-fade-up"
            style={{
              animationDelay: "1.1s",
              width: "120px",
            }}
          />

          <p
            className="font-body text-base md:text-lg lg:text-xl text-ivory/50 max-w-2xl leading-relaxed mb-14 opacity-0 animate-fade-up"
            style={{ animationDelay: "1.3s" }}
          >
            {BUSINESS_NAME} represents buyers, sellers, investors and relocating
            clients in the {PLACE} market — with discretion, preparation and
            white-glove attention at every step.
          </p>

          <div className="flex flex-col sm:flex-row gap-5 opacity-0 animate-fade-up" style={{ animationDelay: "1.5s" }}>
            <MagneticButton
              href="#collections"
              className="group relative font-body text-[11px] tracking-luxury uppercase bg-gold text-charcoal px-12 py-5 transition-all duration-500 text-center shadow-[0_0_30px_hsl(var(--gold)/0.2)] hover:shadow-[0_0_50px_hsl(var(--gold)/0.4)] hover:scale-[1.03] shimmer-btn"
            >
              <span className="relative z-10">Explore Signature Properties</span>
              <span className="absolute inset-0 bg-gold-light opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </MagneticButton>
            <MagneticButton
              href="#contact"
              dataCta="hero-quote"
              className="group relative font-body text-[11px] tracking-luxury uppercase border border-ivory/20 text-ivory px-12 py-5 transition-all duration-500 text-center hover:border-gold hover:text-gold hover:shadow-[0_0_30px_hsl(var(--gold)/0.15)] overflow-hidden"
            >
              <span className="relative z-10">Schedule a Private Consultation</span>
              <span className="absolute inset-0 bg-gold/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" />
            </MagneticButton>
            {PHONE && (
              <MagneticButton
                href={TEL_HREF}
                dataCta="hero-call"
                className="group relative font-body text-[11px] tracking-luxury uppercase border border-gold/30 text-gold px-12 py-5 transition-all duration-500 text-center hover:bg-gold hover:text-charcoal"
              >
                <span className="relative z-10">Call {PHONE}</span>
              </MagneticButton>
            )}
          </div>

          {RATING && (
            <p
              className="font-body text-[10px] text-ivory/25 mt-12 tracking-[0.3em] uppercase opacity-0 animate-fade-up"
              style={{ animationDelay: "1.7s" }}
            >
              Rated {RATING} ★{REVIEW_COUNT ? <span> by {REVIEW_COUNT} clients</span> : null}
            </p>
          )}
        </div>
      </div>

      {/* Scroll indicator */}
      <div
        className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3 opacity-0 animate-fade-in"
        style={{ animationDelay: "2s" }}
      >
        <span className="font-body text-[9px] tracking-[0.4em] uppercase text-ivory/30">Scroll</span>
        <div className="w-px h-10 relative overflow-hidden">
          <div className="absolute inset-0 bg-gold/40" style={{ animation: "scroll-line 2s ease-in-out infinite" }} />
        </div>
      </div>
    </section>
  );
}
