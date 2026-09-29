import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, ArrowUpRight, Sparkles, Wrench, Hammer, PaintBucket, DoorOpen, Layers, Bath, MapPin, CheckCircle2 } from "lucide-react";
import { BUSINESS } from "@/lib/business";

/**
 * Flagship hero — cinematic looped video, animated blueprint overlay,
 * live status, animated counters, magnetic CTAs, and an interactive
 * project command center. Truthful: every claim ties back to BUSINESS.
 */

const PROJECT_TYPES = SERVICES.slice(0,6).map(s=>({slug:s.slug,label:s.shortLabel,Icon:/paint/i.test(s.name)?PaintBucket:/drywall/i.test(s.name)?Layers:/door|window/i.test(s.name)?DoorOpen:/floor/i.test(s.name)?Hammer:/bath/i.test(s.name)?Bath:Wrench,blurb:s.description}));

export function HeroMedia({reduced,failed,onError}:{reduced:boolean;failed:boolean;onError:()=>void}) {
 return CLIENT.hero.video && !reduced && !failed ? <video src={CLIENT.hero.video} poster={CLIENT.hero.poster} autoPlay muted loop playsInline onError={onError} className="w-full h-full object-cover opacity-55" /> : <img src={CLIENT.hero.poster} alt="" className="w-full h-full object-cover opacity-55" />;
}

/** Magnetic hover wrapper for the primary CTA — premium tactile feel. */
function Magnetic({ children, strength = 0.25 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const on = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
    };
    const off = () => { el.style.transform = ""; };
    el.addEventListener("mousemove", on);
    el.addEventListener("mouseleave", off);
    return () => { el.removeEventListener("mousemove", on); el.removeEventListener("mouseleave", off); };
  }, [strength]);
  return <div ref={ref} className="inline-block transition-transform duration-300 ease-out will-change-transform">{children}</div>;
}

export function FlagshipHero() {
  const [reduceMotion,setReduceMotion]=useState(true);
  const [videoFailed,setVideoFailed]=useState(false);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const sync=()=>setReduceMotion(media.matches);sync();media.addEventListener('change',sync);return ()=>media.removeEventListener('change',sync);},[]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activeProject = useMemo(() => PROJECT_TYPES[hoverIdx ?? 0], [hoverIdx]);

  return (
    <section className="relative bg-ink text-bone overflow-hidden min-h-[720px] lg:min-h-[820px]">
      {/* ============ LAYER 1 — Cinematic video background ============ */}
      <div className="absolute inset-0 z-0">
        <HeroMedia reduced={reduceMotion} failed={videoFailed} onError={()=>setVideoFailed(true)}/>
        {/* Color grade overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-transparent to-ink" />
        {/* Film grain */}
        <div className="absolute inset-0 opacity-[0.08] mix-blend-overlay pointer-events-none"
             style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")" }} />
      </div>

      {/* ============ LAYER 2 — Animated blueprint grid SVG ============ */}
      <svg
        className="absolute inset-0 w-full h-full z-[1] pointer-events-none opacity-[0.18]"
        aria-hidden
      >
        <defs>
          <pattern id="bp" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-volt" />
          </pattern>
          <pattern id="bpMaj" width="320" height="320" patternUnits="userSpaceOnUse">
            <rect width="320" height="320" fill="url(#bp)" />
            <path d="M 320 0 L 0 0 0 320" fill="none" stroke="currentColor" strokeWidth="1" className="text-volt" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bpMaj)" />
        {/* Crosshair sweep */}
        <g className="hero-sweep">
          <line x1="0" y1="0" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" className="text-volt" />
        </g>
      </svg>

      {/* ============ LAYER 3 — Volt accent glow ============ */}
      <div aria-hidden className="absolute -top-40 -right-40 w-[680px] h-[680px] rounded-full z-[1] pointer-events-none"
           style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--volt) 28%, transparent) 0%, transparent 60%)" }} />

      {/* ============ LAYER 4 — Top status bar ============ */}
      <div className="relative z-10 border-b border-bone/10 bg-ink/40 backdrop-blur-sm">
        <div className="container-edge h-10 flex items-center justify-between text-[10.5px] font-mono tracking-[0.18em] uppercase text-bone/70">
          <div className="flex items-center gap-4"><span>{SITE.hoursText || CLIENT.identity.businessName}</span></div>
          <div className="hidden md:flex items-center gap-4">
            <span className="flex items-center gap-1.5"><MapPin size={11} className="text-volt" /> {BUSINESS.city}, {BUSINESS.state}</span>
            
          </div>
        </div>
      </div>

      {/* ============ MAIN GRID ============ */}
      <div className="relative z-10 container-edge pt-14 lg:pt-20 pb-28 lg:pb-36">
        <div className="grid lg:grid-cols-12 gap-12 items-start">

          {/* LEFT — display */}
          <div className="lg:col-span-7 relative">
            <div className="flex items-center gap-3 mb-8 reveal">
              <Sparkles size={14} className="text-volt" />
              <span className="eyebrow text-bone/80">{CLIENT.hero.eyebrow}</span>
              <span className="hairline w-12 text-bone" />
            </div>

            <h1 className="display-xl text-bone reveal" style={{ animationDelay: ".05s" }}>
              <span className="block">{CLIENT.hero.line1}</span>
              <span className="block italic text-volt">{CLIENT.hero.emphasis}</span>
              <span className="block">
                
                <span className="relative inline-block">
                  {CLIENT.hero.line3}
                  <svg className="absolute left-0 -bottom-2 w-full h-3" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
                    <path d="M2 8 Q 50 1 100 6 T 198 5" fill="none" stroke="currentColor" strokeWidth="3" className="text-volt hero-stroke" />
                  </svg>
                </span>
              </span>
            </h1>

            <p className="mt-9 max-w-xl text-[17px] leading-relaxed text-bone/70 reveal" style={{ animationDelay: ".15s" }}>
              {CLIENT.hero.support}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-6 reveal" style={{ animationDelay: ".25s" }}>
              <Magnetic>
                <Link to="/contact" className="btn-volt group">
                  Request a quote
                  <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </Magnetic>
              <a href={`tel:${BUSINESS.phoneE164}`} className="flex items-center gap-3 text-bone hover:text-volt transition-colors group">
                <span className="w-11 h-11 grid place-items-center border border-bone/30 group-hover:border-volt group-hover:bg-volt group-hover:text-ink transition-all">
                  <Phone size={15} />
                </span>
                <div className="text-left leading-tight">
                  <div className="font-display text-lg">{BUSINESS.phone}</div>
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-bone/50">Call {BUSINESS.name}</div>
                </div>
              </a>
            </div>

            {/* Verified credentials strip — only source-site + BBB facts */}
            <div className="mt-14 grid grid-cols-3 gap-6 max-w-xl reveal" style={{ animationDelay: ".35s" }}>
              {CLIENT.identity.founded ? [{v:CLIENT.identity.founded,k:'Founded'}].map((s,i)=>(
                <div key={i} className="border-l-2 border-volt/70 pl-4">
                  <div className="font-display text-[28px] leading-none text-bone">{s.v}</div>
                  <div className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-bone/55">{s.k}</div>
                </div>
              )) : null}
            </div>
          </div>

          {/* RIGHT — image card + command center widget */}
          <div className="lg:col-span-5 relative">
            <div className="relative">
              {/* Editorial image card — high-tech architectural rendering of the 848 mark */}
              <div className="relative aspect-[3/4] frame-ink overflow-hidden bg-ink">
                <img
                  src={CLIENT.hero.poster}
                  alt={CLIENT.identity.businessName}
                  width={1080}
                  height={1440}
                  fetchPriority="high"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Subtle scanning sweep over the blueprint */}
                <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-volt/15 to-transparent hero-sweep pointer-events-none" />
                {/* Corner crops */}
                <CornerTicks />
                {/* Bottom caption */}
                <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-ink/95 via-ink/40 to-transparent">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-[10px] font-mono tracking-[0.22em] uppercase text-volt">{CLIENT.identity.businessName}</div>
                      <div className="font-display text-bone text-xl leading-tight mt-1">{CLIENT.hero.eyebrow}</div>
                    </div>
                    <div className="text-right text-[10px] font-mono tracking-[0.18em] uppercase text-bone/70">
                      <div>{BUSINESS.city}</div>
                      <div>{BUSINESS.state}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating command center */}
              <div
                className="lg:absolute lg:-left-16 lg:-bottom-10 mt-6 lg:mt-0 w-full lg:w-[360px] bg-bone/80 backdrop-blur-md text-ink ring-1 ring-ink/5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] reveal"
                style={{ animationDelay: ".5s" }}
              >
                <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="num-badge text-ink">№ 01</span>
                    <span className="font-display text-sm">Project router</span>
                  </div>
                  <span className="text-[10px] font-mono tracking-widest uppercase text-ink/45">Pick a service →</span>
                </div>

                <div className="p-3 grid grid-cols-3 grid-rows-2 gap-2">
                  {PROJECT_TYPES.map((p, i) => {
                    const active = hoverIdx === i;
                    return (
                      <Link
                        key={i}
                        to="/services/$slug"
                        params={{ slug: p.slug }}
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                        onFocus={() => setHoverIdx(i)}
                        onBlur={() => setHoverIdx(null)}
                        className={`group relative aspect-square flex flex-col items-center justify-center text-center px-2 border transition-all ${active ? "border-ink bg-ink text-bone" : "border-ink/15 hover:border-ink/40"}`}
                      >
                        <p.Icon size={20} className={active ? "text-volt" : "text-ink/70"} />
                        <span className={`mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] leading-tight ${active ? "text-bone" : "text-ink/80"}`}>{p.label}</span>
                      </Link>
                    );
                  })}
                </div>

                <div className="px-5 pb-5 pt-1">
                  <div className="text-[11px] font-mono tracking-[0.16em] uppercase text-ink/45 mb-1.5">Service brief</div>
                  <p className="text-[13px] leading-snug text-ink/80 min-h-[40px]">
                    {activeProject.blurb}
                  </p>
                  <Link
                    to="/services/$slug" params={{slug:activeProject.slug}}
                    className="mt-4 flex items-center justify-between bg-volt text-ink px-4 py-3 font-semibold uppercase tracking-[0.14em] text-[11px] hover:bg-volt-deep transition-colors"
                  >
                    Start this project
                    <ArrowUpRight size={14} />
                  </Link>
                  {CLIENT.content.values.length>0 && <ul className="mt-4 space-y-1.5 text-[11.5px] text-ink/65">{CLIENT.content.values.slice(0,3).map(v=><li key={v.title}>{v.title}</li>)}</ul>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ Marquee strip ============ */}
      <div className="relative z-10 bg-volt text-ink py-3.5 overflow-hidden border-y border-ink/10">
        <div className="marquee">
          {[...Array(2)].map((_, dup) => (
            <div key={dup} className="flex gap-10 items-center text-[12.5px] tracking-[0.2em] uppercase font-bold">
              {SERVICES.map(s=>s.name).flatMap(s => [
                <span key={s}>{s}</span>,
                <span key={s + "-d"} className="text-ink/50">✦</span>,
              ])}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CornerTicks() {
  const corners = ["top-3 left-3", "top-3 right-3", "bottom-3 left-3", "bottom-3 right-3"];
  return (
    <>
      {corners.map((c, i) => (
        <span key={i} className={`absolute ${c} w-4 h-4 pointer-events-none`}>
          <span className="absolute inset-0 border-l-2 border-t-2 border-volt"
                style={{
                  transform: i === 1 ? "scaleX(-1)" : i === 2 ? "scaleY(-1)" : i === 3 ? "scale(-1,-1)" : "none",
                }} />
        </span>
      ))}
    </>
  );
}
