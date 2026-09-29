import {client} from "@/lib/bridge";
const logoUrl=client.identity.logoOnDark;
const heroPoster=client.hero.poster;
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Phone, MessageSquare, MapPin, Play, Pause, Volume2, VolumeX, Check } from "lucide-react";
import { business } from "@/lib/business";



/**
 * The Wall Studio Hero — cinematic video flagship, one-of-one.
 *
 * Center widget: The "Finish Advisor" — a business-specific, drywall-only
 * decision device. Pick your project + wall condition, instantly get back the
 * recommended finish level (L1–L5), what it includes, and a routed CTA.
 * This is unique to American Drywall & Plaster. Truthful, non-dynamic,
 * derived purely from local input — no fake live data.
 */

const heroVideoUrl = client.hero.video;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

type Project = string;

type Condition = "minor" | "moderate" | "rebuild";

const PROJECTS: { id: Project; label: string; sub: string }[] = client.services.map((s,i)=>({id:String(i),label:s.name,sub:"Service"}));

type Outcome = {
  level: string;       // e.g. "L4"
  title: string;       // e.g. "Skim Coat Finish"
  desc: string;        // what it includes
  scope: string[];     // 3 bullets — what's actually done
  window: string;      // honest timeline
  cta: { label: string; to?: string; href?: string };
};

function recommend(p:Project,c:Condition):Outcome { const s=client.services[Number(p)]||client.services[0];return {level:"",title:s.name,desc:s.description,scope:["Selected wall condition: "+c],window:"Discuss with us",cta:{label:"Discuss this project",to:"/contact"}};}

function o(level: string, title: string, desc: string, scope: string[], window: string, cta: Outcome["cta"]): Outcome {
  return { level, title, desc, scope, window, cta };
}

export function WallStudioHero() {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      setPlaying(false);
    }
  }, [reduced]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().then(() => setPlaying(true)).catch(() => setFailed(true)); }
    else { v.pause(); setPlaying(false); }
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  return (
    <section className="relative isolate overflow-hidden bg-ink text-bone">
      {/* CINEMATIC VIDEO LAYER */}
      <div className="absolute inset-0 z-0">
        {heroVideoUrl && !reduced && !failed ? <video
          ref={videoRef}
          onError={() => setFailed(true)}
          src={heroVideoUrl}
          poster={heroPoster}
          autoPlay={!reduced}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          aria-hidden="true"
        /> : <img src={heroPoster} alt="" className="h-full w-full object-cover" />}
        {/* cinematic graders */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/55 to-ink/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/10 to-ink/40" />
        <div className="absolute inset-0 grain pointer-events-none" aria-hidden />
      </div>

      {/* CONTENT */}
      <div className="relative z-10 mx-auto max-w-[1500px] px-5 sm:px-6 lg:px-10 pt-8 lg:pt-12 pb-20 lg:pb-28">
        {/* brand strip */}
        <div className="reveal flex items-center justify-between gap-3 mb-10 lg:mb-14">
          <div className="flex items-center gap-3">
            <img
              src={logoUrl}
              alt={client.identity.businessName+" logo"}
              width={36}
              height={36}
              className="h-9 w-9 rounded-sm object-cover ring-1 ring-bone/15 shadow-soft"
            />
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/65">
              <MapPin className="inline h-3 w-3 -mt-0.5 mr-1 text-amber" />
              {business.city}, {business.state}
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-bone/55">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            {client.identity.businessName}
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* LEFT — editorial hero copy */}
          <div className="lg:col-span-7 relative">
            <div className="reveal reveal-2 flex items-center gap-2 eyebrow !text-bone/60">
              <span className="inline-flex h-px w-8 bg-amber" />
              {client.hero.eyebrow}
            </div>

            <h1 className="reveal reveal-2 mt-5 font-display text-[48px] sm:text-[72px] lg:text-[104px] leading-[0.92] tracking-tight text-bone">{client.hero.line1} <span className="italic font-normal text-amber">{client.hero.emphasis}</span><br />{client.hero.line3}</h1>

            <p className="reveal reveal-3 mt-7 max-w-[52ch] text-[17px] lg:text-[19px] leading-relaxed text-bone/75">{client.hero.support}</p>

            <div className="reveal reveal-4 mt-9 flex flex-wrap items-center gap-3">
              <a
                href={`tel:${business.phoneRaw}`}
                className="group inline-flex items-center gap-3 px-6 py-4 rounded-sm bg-amber text-ink font-semibold shadow-amber hover:brightness-105 transition-all"
              >
                <Phone className="h-4 w-4" />
                <span className="tracking-wide">{business.phone}</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-bone/10 text-bone backdrop-blur-md border border-bone/20 hover:bg-bone/15 transition-colors"
              >
                Project inquiry <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="/contact"
                className="hidden sm:inline-flex items-center gap-2 px-5 py-4 rounded-sm border border-bone/15 text-bone/80 hover:bg-bone/10 transition-colors text-[14px]"
              >
                <MessageSquare className="h-4 w-4" /> Contact us
              </a>
            </div>

            {/* trust strip */}
            <div className="reveal reveal-5 mt-10 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 max-w-2xl">
              {client.trust.badges.slice(0,4).map(b=>[b.label,b.sublabel]).map(([t, s]) => (
                <div key={t} className="border-l border-bone/15 pl-3">
                  <div className="font-display text-[15px] text-bone leading-tight">{t}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-bone/55 mt-1">{s}</div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Finish Advisor (one-of-one widget) */}
          <div className="lg:col-span-5 relative">
            <FinishAdvisor />
          </div>
        </div>
      </div>

      {/* Video chrome — bottom-left controls */}
      {heroVideoUrl && !reduced && !failed && <div className="absolute bottom-5 left-5 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause hero video" : "Play hero video"}
          className="h-9 w-9 grid place-items-center rounded-full bg-bone/10 backdrop-blur-md border border-bone/20 text-bone hover:bg-bone/20 transition-colors"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute hero video" : "Mute hero video"}
          className="h-9 w-9 grid place-items-center rounded-full bg-bone/10 backdrop-blur-md border border-bone/20 text-bone hover:bg-bone/20 transition-colors"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.25em] text-bone/55">
          {business.city}, {business.state}
        </span>
      </div>}
    </section>
  );
}

/* ===================== Finish Advisor — the one-of-one widget ===================== */

function FinishAdvisor() {
  const [project, setProject] = useState<Project>("0");
  const [condition, setCondition] = useState<Condition>("moderate");
  const outcome = useMemo(() => recommend(project, condition), [project, condition]);

  return (
    <div className="advisor relative rounded-md bg-bone text-ink shadow-lift overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="eyebrow">Finish Advisor</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Explore services
        </div>
      </div>

      {/* step 1 */}
      <div className="px-5 mt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
          1 · What are you working on?
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PROJECTS.map((p) => {
            const active = project === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProject(p.id)}
                className={
                  "text-left px-3 py-2.5 rounded-sm border transition-all " +
                  (active
                    ? "bg-ink text-bone border-ink shadow-soft"
                    : "bg-card text-ink border-border hover:border-ink/40")
                }
              >
                <div className="text-[13px] font-medium leading-tight">{p.label}</div>
                <div className={"text-[10.5px] font-mono uppercase tracking-[0.12em] mt-1 " + (active ? "text-amber" : "text-muted-foreground")}>
                  {p.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* step 2 */}
      <div className="px-5 mt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
          2 · Wall condition
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: "minor"    as const, label: "Minor",    sub: "Light damage" },
            { id: "moderate" as const, label: "Moderate", sub: "Resurface" },
            { id: "rebuild"  as const, label: "Rebuild",  sub: "Down to studs" },
          ].map((c) => {
            const active = condition === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCondition(c.id)}
                className={
                  "px-2.5 py-2.5 rounded-sm border text-center transition-all " +
                  (active
                    ? "bg-amber text-ink border-amber"
                    : "bg-card text-ink border-border hover:border-ink/40")
                }
              >
                <div className="text-[13px] font-semibold leading-tight">{c.label}</div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] mt-0.5 opacity-75">{c.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* outcome */}
      <div className="mt-6 bg-ink text-bone px-5 py-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber">Selected service</div>
            <div className="font-display text-[44px] leading-none mt-1">{outcome.level}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[20px] leading-tight">{outcome.title}</div>
            <p className="text-[13px] leading-relaxed text-bone/70 mt-1.5">{outcome.desc}</p>
          </div>
        </div>

        <ul className="mt-4 grid gap-1.5">
          {outcome.scope.map((s) => (
            <li key={s} className="flex items-start gap-2 text-[13px] text-bone/85">
              <Check className="h-3.5 w-3.5 text-amber mt-0.5 shrink-0" />
              <span>{s}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center justify-between gap-3 pt-4 border-t border-bone/10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-bone/60">
            Scheduling · <span className="text-bone">{outcome.window}</span>
          </div>
          {outcome.cta.to ? (
            <Link
              to={outcome.cta.to}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-sm bg-amber text-ink font-semibold text-[13px] hover:brightness-105"
            >
              {outcome.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <a
              href={outcome.cta.href}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-sm bg-amber text-ink font-semibold text-[13px] hover:brightness-105"
            >
              {outcome.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="px-5 py-3 text-[11px] text-muted-foreground bg-card border-t border-border">
        Select a service and wall condition to discuss with us. Finish level, scope and timing require a project review.
      </div>
    </div>
  );
}
