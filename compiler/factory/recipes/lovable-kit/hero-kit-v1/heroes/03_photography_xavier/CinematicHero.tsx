import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom"; // swap to @tanstack/react-router or <a> as needed
import { ArrowRight, Camera } from "lucide-react";

// ASSETS — replace with your CDN URLs. Use exactly 5 hero frames (portrait-friendly).
import hero1 from "@/assets/xp/hero1.jpg";
import hero2 from "@/assets/xp/hero2.jpg";
import hero3 from "@/assets/xp/hero3.jpg";
import hero4 from "@/assets/xp/hero4.jpg";
import hero5 from "@/assets/xp/hero5.jpg";

const frames = [hero1, hero2, hero3, hero4, hero5];

/**
 * Cinematic Hero — Editorial split
 * LEFT: oversized serif statement + frame-counter + stats
 * RIGHT: layered z-stack of three offset portrait plates,
 *        gold rule diagonals, floating signature card.
 */
export default function CinematicHero() {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [py, setPy] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % frames.length), 5200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top;
      setPy(Math.max(-160, Math.min(160, -top * 0.18)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section ref={ref} className="relative min-h-[100svh] bg-onyx text-ivory overflow-hidden grain"
             aria-label="XPhotography hero">
      {/* Backdrop wash */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(38_45%_22%/0.55),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(24_14%_5%/0.9),transparent_70%)]" />
      </div>

      {/* Gold diagonal rules — signature motif */}
      <svg className="absolute inset-0 z-[2] w-full h-full opacity-[0.18]" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" x2="1">
            <stop offset="0" stopColor="hsl(38 60% 70%)" stopOpacity="0" />
            <stop offset="0.5" stopColor="hsl(38 60% 70%)" stopOpacity="1" />
            <stop offset="1" stopColor="hsl(38 60% 70%)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="-5%" y1="78%" x2="105%" y2="22%" stroke="url(#g)" strokeWidth="1" />
        <line x1="-5%" y1="92%" x2="105%" y2="42%" stroke="url(#g)" strokeWidth="0.5" />
      </svg>

      <div className="relative z-10 container pt-32 md:pt-40 pb-24 md:pb-32 grid lg:grid-cols-12 gap-10 lg:gap-6 min-h-[100svh] items-center">
        {/* LEFT */}
        <div className="lg:col-span-6 relative">
          <div className="flex items-center gap-4 mb-8 animate-fade-in">
            <span className="h-px w-10 bg-gold" />
            <span className="eyebrow text-gold-soft">Atlanta · Est. 2018 · Xavier Jordan</span>
          </div>

          <h1 className="font-display text-[14vw] sm:text-[10vw] lg:text-[6.4vw] leading-[0.92] tracking-[-0.015em] text-balance animate-fade-up">
            Quietly <em className="text-gold-soft not-italic">cinematic</em><br />
            photography for<br />
            the moments that<br />
            <span className="italic text-ivory/95">earn the wall.</span>
          </h1>

          <p className="mt-8 max-w-md text-ivory/75 leading-relaxed text-[15px] animate-fade-up [animation-delay:200ms]">
            Weddings, portraits, family stories and brand work — composed with the patience of a
            documentarian and the eye of an editor. Based in Atlanta, photographing the South and beyond.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4 animate-fade-up [animation-delay:380ms]">
            <Link to="/contact"
                  className="group inline-flex items-center gap-3 px-7 py-4 bg-ivory text-onyx hover:bg-gold transition-all duration-500 uppercase tracking-[0.28em] text-[11.5px]">
              Reserve Your Date
              <ArrowRight className="w-4 h-4 transition-transform duration-500 group-hover:translate-x-1.5" />
            </Link>
            <Link to="/portfolio"
                  className="inline-flex items-center gap-2 text-ivory/80 hover:text-gold transition-colors uppercase tracking-[0.28em] text-[11.5px]">
              View The Portfolio →
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-3 gap-6 max-w-md animate-fade-up [animation-delay:560ms]">
            {[
              ["6+", "Years behind the lens"],
              ["200+", "Sessions delivered"],
              ["5★", "Couple & family rated"],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="font-display text-3xl text-gold">{n}</div>
                <div className="text-[10.5px] uppercase tracking-[0.22em] text-ivory/55 mt-1 leading-tight">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: layered photo stack */}
        <div className="lg:col-span-6 relative h-[68vh] sm:h-[72vh] lg:h-[78vh]">
          <div className="absolute -top-2 right-0 z-30 flex items-center gap-3 text-ivory/70">
            <Camera className="w-4 h-4 text-gold" />
            <span className="font-mono text-[11px] tracking-[0.3em]">
              {String(idx + 1).padStart(2, "0")} / {String(frames.length).padStart(2, "0")}
            </span>
          </div>

          {/* Plate A — tall hero */}
          <div className="absolute top-6 right-0 w-[72%] h-[88%] overflow-hidden shadow-luxe"
               style={{ transform: `translateY(${py * 0.4}px)` }}>
            {frames.map((src, i) => (
              <img key={src} src={src} alt={`Signature frame ${i + 1}`}
                   className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1600ms] ${
                     i === idx ? "opacity-100 animate-ken-burns" : "opacity-0"
                   }`}
                   loading={i === 0 ? "eager" : "lazy"} />
            ))}
            <div className="absolute inset-0 bg-grad-onyx opacity-60" />
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between text-ivory/85">
              <div>
                <div className="eyebrow text-gold-soft">Featured Frame</div>
                <div className="font-display text-xl mt-1 italic">Light is the only verb that matters.</div>
              </div>
            </div>
          </div>

          {/* Plate B — accent bottom-left */}
          <div className="absolute bottom-0 left-0 w-[44%] h-[42%] overflow-hidden shadow-soft border border-gold/30"
               style={{ transform: `translateY(${py * -0.55}px)` }}>
            <img src={frames[(idx + 1) % frames.length]} alt="Editorial accent frame"
                 className="w-full h-full object-cover animate-ken-burns" />
            <div className="absolute inset-0 ring-1 ring-inset ring-ivory/10" />
          </div>

          {/* Plate C — top-left tiny */}
          <div className="absolute top-0 left-[14%] w-[26%] aspect-[3/4] overflow-hidden shadow-soft hidden sm:block"
               style={{ transform: `translateY(${py * 0.7}px) rotate(-2deg)` }}>
            <img src={frames[(idx + 2) % frames.length]} alt="Portrait detail"
                 className="w-full h-full object-cover" />
          </div>

          {/* Floating signature card */}
          <div className="absolute -bottom-4 right-[6%] z-30 bg-onyx/85 backdrop-blur border border-gold/40 px-5 py-4 max-w-[230px] hidden md:block"
               style={{ transform: `translateY(${py * -0.3}px)` }}>
            <div className="eyebrow text-gold mb-2">Signed</div>
            <div className="font-display italic text-2xl leading-none">Xavier Jordan</div>
            <div className="text-[11px] text-ivory/60 tracking-[0.18em] uppercase mt-2">Photographer · Atlanta</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-ivory/50">
        <span className="eyebrow">Scroll</span>
        <span className="block w-px h-10 bg-gradient-to-b from-gold/80 to-transparent animate-[fade-in_2s_ease-in-out_infinite_alternate]" />
      </div>
    </section>
  );
}
