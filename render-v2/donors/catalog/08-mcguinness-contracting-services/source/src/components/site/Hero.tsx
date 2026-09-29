import { CLIENT, metrics, emailDraft } from "@/lib/wss";
import { ArrowRight, Phone, MapPin, HardHat, Ruler, ClipboardCheck, CalendarClock, Hammer } from "lucide-react";
import { useEffect, useState } from "react";

type ProjectType = string;
type Surface = "New pour" | "Tear-out & replace" | "Repair / resurface";
type Timeline = "ASAP" | "1–3 months" | "Planning ahead";

export function Hero() {
  const [pType, setPType] = useState<ProjectType>(CLIENT.services[0].name);
  const [size, setSize] = useState("");
  const [surface, setSurface] = useState<Surface>("New pour");
  const [timeline, setTimeline] = useState<Timeline>("1–3 months");

  const sizeUnit = "sq ft";
  const [motion, setMotion]=useState(false);
  const [videoFailed,setVideoFailed]=useState(false);
  useEffect(()=>{const m=window.matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setMotion(!m.matches);update();m.addEventListener("change",update);return()=>m.removeEventListener("change",update);},[]);

  const handleRequest = () => {
    const subject = encodeURIComponent(`Concrete estimate — ${pType} (${size} ${sizeUnit})`);
    const body = encodeURIComponent(
      `Project type: ${pType}\nApprox. size: ${size} ${sizeUnit}\nSurface condition: ${surface}\nTimeline: ${timeline}\n\nName:\nPhone:\nProject address:\nNotes:\n`
    );
    const href=emailDraft(decodeURIComponent(subject),decodeURIComponent(body));
    if (href) window.location.href=href;
  };

  return (
    <section
      id="top"
      className="relative min-h-[100svh] overflow-hidden bg-[var(--ink)] text-white"
    >
      <img src={CLIENT.hero.poster} alt="" className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none" />
      {CLIENT.hero.video && motion && !videoFailed && <video src={CLIENT.hero.video} poster={CLIENT.hero.poster} autoPlay loop muted playsInline onError={()=>setVideoFailed(true)} className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none" />}
      <div aria-hidden className="absolute inset-0 bg-black/60 backdrop-blur-[0.5px]" />
      {/* Concrete texture base */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 30%, rgba(255,255,255,0.18) 0, transparent 40%), radial-gradient(circle at 75% 70%, rgba(255,255,255,0.10) 0, transparent 50%), repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 9px)",
        }}
      />
      {/* Grain */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")",
        }}
      />
      {/* Warm safety glow */}
      <div
        aria-hidden
        className="absolute top-1/4 right-[-15%] h-[70vh] w-[70vh] rounded-full blur-3xl opacity-25 mix-blend-screen"
        style={{ background: "var(--gradient-warm)" }}
      />

      {/* Chalk-line edge ruler */}
      <div
        aria-hidden
        className="hidden md:block absolute left-0 top-0 bottom-0 w-12 border-r border-white/10"
      >
        <div
          className="h-full w-full opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0 47px, rgba(255,255,255,0.5) 47px 48px), repeating-linear-gradient(to bottom, transparent 0 235px, rgba(255,255,255,0.9) 235px 240px)",
          }}
        />
        <div className="absolute top-1/2 -translate-y-1/2 -right-[1px] flex flex-col items-center gap-1 text-[9px] font-mono tracking-[0.3em] text-white/40 [writing-mode:vertical-rl]">
          {CLIENT.identity.businessName} · {CLIENT.identity.city} · {CLIENT.identity.state}
        </div>
      </div>

      <div className="relative container mx-auto px-5 md:pl-20 md:pr-8 pt-28 md:pt-32 pb-28 md:pb-32 min-h-[100svh] flex flex-col">
        {/* Eyebrow rail */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] sm:text-[11px] uppercase tracking-[0.3em] text-white/65">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] animate-pulse" />
            {CLIENT.hero.eyebrow}
          </span>
          <span className="hidden sm:inline-block h-3 w-px bg-white/20" />
          <span className="hidden sm:inline-flex items-center gap-2">
            <MapPin className="h-3 w-3 text-[var(--gold)]" /> {CLIENT.identity.city}, {CLIENT.identity.state}
          </span>
          <span className="hidden md:inline-block h-3 w-px bg-white/20" />
          <span className="hidden md:inline-flex items-center gap-2">
            <HardHat className="h-3 w-3 text-[var(--gold)]" /> {CLIENT.services[0].shortLabel}
          </span>
        </div>

        <div className="mt-auto pt-16 md:pt-20 grid grid-cols-12 gap-x-6 gap-y-10 items-end">
          {/* Headline */}
          <div className="col-span-12 lg:col-span-7">
            <div className="flex items-center gap-3 text-[10px] font-mono tracking-[0.3em] text-[var(--gold)]/80 uppercase">
              <span>{CLIENT.identity.businessName}</span>
              <span className="h-px w-12 bg-[var(--gold)]/40" />
              <span>{CLIENT.identity.city}</span>
            </div>

            <h1 className="mt-5 font-display tracking-[-0.02em] leading-[0.95]">
              <span className="block text-[2.75rem] sm:text-6xl md:text-7xl lg:text-[5.25rem] xl:text-[6rem] uppercase">
                {CLIENT.hero.line1}
              </span>
              <span className="block text-[2.75rem] sm:text-6xl md:text-7xl lg:text-[5.25rem] xl:text-[6rem] uppercase text-gradient-warm">
                {CLIENT.hero.emphasis}
              </span>
              <span className="mt-5 block text-base sm:text-lg md:text-xl font-sans font-normal text-white/65 max-w-xl leading-relaxed">
                {CLIENT.hero.line3} {CLIENT.hero.support}
              </span>
            </h1>

            <div className="mt-9 flex flex-col sm:flex-row sm:flex-wrap gap-3">
              <a
                href="#contact"
                className="group inline-flex items-center justify-center gap-2 rounded-sm bg-gradient-warm text-[var(--ink)] px-7 py-4 text-sm font-bold uppercase tracking-wider shadow-glow hover:scale-[1.02] transition-transform duration-300"
              >
                Request an estimate
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </a>
              <a
                href={CLIENT.identity.phoneTel}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/25 bg-white/5 backdrop-blur px-7 py-4 text-sm font-bold uppercase tracking-wider hover:bg-white/15 transition"
              >
                <Phone className="h-4 w-4 text-[var(--gold)]" />
                {CLIENT.identity.phoneDisplay}
              </a>
            </div>

            {metrics().length > 0 && <dl className="mt-12 grid grid-cols-3 gap-x-6 gap-y-4 max-w-xl border-t border-white/10 pt-6">
              {metrics().map(b=><div key={b.value}><dt className="text-[10px] uppercase tracking-[0.25em] text-white/45">{b.label}</dt><dd className="mt-1.5 font-display text-base md:text-lg uppercase text-gradient-warm">{b.value}</dd></div>)}
            </dl>}
          </div>

          {/* Concrete estimate widget */}
          <div className="col-span-12 lg:col-span-5 lg:pl-6">
            <div className="relative max-w-md ml-auto">
              <div className="relative rounded-sm bg-[var(--ink)]/85 backdrop-blur-xl border border-white/10 shadow-elegant overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/[0.04]">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-3.5 w-3.5 text-[var(--gold)]" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/75">
                      Estimate request
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-white/40 tracking-widest">04 INPUTS</span>
                </div>

                <div className="px-5 py-5 space-y-4">
                  <Field label="Project type">
                    <div className="grid grid-cols-3 gap-1.5">
                      {CLIENT.services.map(s=>s.name).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setPType(t)}
                          className={`text-[10px] uppercase tracking-wider py-2 rounded-sm border transition ${
                            pType === t
                              ? "bg-[var(--gold)] text-[var(--ink)] border-[var(--gold)]"
                              : "bg-white/5 border-white/10 text-white/75 hover:bg-white/10"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label={`Approx. size (${sizeUnit})`}>
                    <div className="flex items-center gap-2">
                      <Ruler className="h-4 w-4 text-white/40 shrink-0" />
                      <input
                        aria-label="Approximate size in square feet"
                        type="number"
                        min={0}
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded-sm px-3 py-2 text-sm text-white outline-none focus:border-[var(--gold)]"
                      />
                      <span className="text-[10px] uppercase tracking-wider text-white/50">{sizeUnit}</span>
                    </div>
                  </Field>

                  <Field label="Surface condition">
                    <select
                      aria-label="Surface condition"
                      value={surface}
                      onChange={(e) => setSurface(e.target.value as Surface)}
                      className="w-full bg-white/5 border border-white/10 rounded-sm px-3 py-2 text-sm text-white outline-none focus:border-[var(--gold)]"
                    >
                      <option className="bg-[var(--ink)]">New pour</option>
                      <option className="bg-[var(--ink)]">Tear-out &amp; replace</option>
                      <option className="bg-[var(--ink)]">Repair / resurface</option>
                    </select>
                  </Field>

                  <Field label="Timeline">
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["ASAP","1–3 months","Planning ahead"] as Timeline[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTimeline(t)}
                          className={`text-[10px] uppercase tracking-wider py-2 rounded-sm border transition ${
                            timeline === t
                              ? "bg-white text-[var(--ink)] border-white"
                              : "bg-white/5 border-white/10 text-white/75 hover:bg-white/10"
                          }`}
                        >
                          <CalendarClock className="inline h-3 w-3 mr-1 -mt-0.5" />
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                <button
                  onClick={handleRequest}
                  disabled={!CLIENT.identity.email}
                  className="group flex items-center justify-between w-full px-5 py-3.5 border-t border-white/10 bg-gradient-warm text-[var(--ink)] font-bold uppercase tracking-wider text-sm hover:brightness-105 transition"
                >
                  <span className="inline-flex items-center gap-2">
                    <Hammer className="h-4 w-4" />
                    Open email draft
                  </span>
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>
              </div>

              <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-white/40 text-right">
                {CLIENT.identity.email ? "Opens your email app. Send the draft to request an estimate." : "Call to discuss your project."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-b from-transparent to-background pointer-events-none" />
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/50 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
