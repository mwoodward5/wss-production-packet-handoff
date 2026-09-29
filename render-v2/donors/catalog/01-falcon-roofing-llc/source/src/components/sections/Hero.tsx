import {CLIENT,routeFor} from "@/lib/wss";
import {HERO_VIDEO_SOURCES} from "@/lib/heroVideo";
import { Link } from "react-router-dom";
import { Phone, ArrowRight, Home, Building2, Droplets, PaintRoller, Zap, Wrench, Camera, MapPin, ClipboardCheck, ShieldCheck } from "lucide-react";
import { ASSETS } from "@/lib/assets";
const heroImg = ASSETS.heroRoof;
import { BUSINESS } from "@/lib/business";
import { HeroMedia } from "@/components/HeroMedia";

const SNAPSHOT=CLIENT.services.slice(0,4).map((s,i)=>({icon:[Home,Wrench,Building2,Droplets][i],label:s.shortLabel,spec:""}));
const COMMAND_INTENTS: {icon:typeof Zap;label:string;href:string;tone?:"urgent"|"default"}[]=[
 {icon:Phone,label:"Call us",href:CLIENT.identity.phoneTel},
 {icon:ClipboardCheck,label:"Contact",href:"/contact"},
 ...CLIENT.services.slice(0,4).map(s=>({icon:Home,label:s.shortLabel,href:s.href || routeFor(s)})),
 ...(CLIENT.trust.areas.length?[{icon:MapPin,label:"Service area",href:"/service-area"}]:[]),
 ...(CLIENT.identity.email?[{icon:Camera,label:"Email project details",href:`mailto:${CLIENT.identity.email}`}]:[]),
 ...(CLIENT.trust.bookingUrl?[{icon:ClipboardCheck,label:"Book online",href:CLIENT.trust.bookingUrl}]:[])
];

export const Hero = () => (
  <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
    <HeroMedia
      poster={heroImg}
      posterAlt={CLIENT.identity.businessName}
      sources={HERO_VIDEO_SOURCES}
      objectPosition="center 35%"
      overlayClassName="bg-gradient-hero-strong"
    />
    {/* Blueprint hairline grid + roofline mark in corner */}
    <div className="pointer-events-none absolute inset-0 z-[1] blueprint-grid-dark opacity-50" aria-hidden="true" />
    <div className="pointer-events-none absolute right-6 top-24 z-[1] hidden h-32 w-32 roofline-silhouette opacity-60 md:block" aria-hidden="true" />

    {/* Storm: intermittent lightning flash across the whole hero */}
    <div className="pointer-events-none absolute inset-0 z-[1] hero-flash" aria-hidden="true" />

    {/* Storm: animated lightning bolts behind the headline area */}
    <div
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      aria-hidden="true"
    >
      <svg
        className="absolute -top-4 left-[8%] h-[70%] w-[55%] hero-bolt hero-bolt-1"
        viewBox="0 0 400 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M210 0 L120 230 L200 230 L80 480 L260 220 L170 220 L260 0 Z"
          fill="hsl(var(--accent-glow))"
          stroke="hsl(var(--accent))"
          strokeWidth="2"
        />
      </svg>
      <svg
        className="absolute top-0 right-[6%] h-[80%] w-[45%] hero-bolt hero-bolt-2"
        viewBox="0 0 400 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M260 0 L160 280 L240 280 L120 560 L300 260 L210 260 L300 0 Z"
          fill="hsl(var(--accent-glow))"
          stroke="hsl(var(--accent))"
          strokeWidth="2"
        />
      </svg>
      <svg
        className="absolute top-10 left-[40%] hidden h-[55%] w-[28%] hero-bolt hero-bolt-3 md:block"
        viewBox="0 0 400 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M220 0 L150 200 L220 200 L130 420 L280 190 L210 190 L290 0 Z"
          fill="hsl(var(--accent-glow))"
          stroke="hsl(var(--accent))"
          strokeWidth="2"
        />
      </svg>
    </div>

    <div className="container-tight relative z-[2] min-h-[86vh] pb-12 pt-24 md:min-h-[88vh] md:pb-16 md:pt-28">
      <div className="grid min-h-[calc(86vh-9rem)] grid-cols-1 content-end gap-8 md:min-h-[calc(88vh-11rem)] md:grid-cols-12">
      <div className="md:col-span-10 lg:col-span-8">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-signal">
            {CLIENT.hero.eyebrow}
          </span>
          <span className="h-px flex-1 bg-primary-foreground/25" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-display text-[40px] font-extrabold leading-[0.95] tracking-tight sm:text-6xl md:text-[78px]">
          {CLIENT.hero.line1}
          <br />
          <span className="relative inline-block">
            <span className="relative z-10 text-accent hero-headline-glow">{CLIENT.hero.emphasis}</span>
            <span className="absolute -bottom-1 left-0 right-0 h-2 bg-accent/25" aria-hidden="true" />
          </span><br />{CLIENT.hero.line3}
        </h1>
        <p className="mt-6 max-w-xl text-lg text-primary-foreground/85">
          {CLIENT.hero.support}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/contact" className="btn-falcon">
            Request quote
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a href={`tel:${BUSINESS.phoneTel}`} className="btn-ghost-on-dark">
            <Phone className="h-4 w-4 text-signal" /> {BUSINESS.phoneDisplay}
          </a>
        </div>
      </div>

      {/* Roof Command — owner & customer quick intents */}
      <aside
        className="md:col-span-12"
        aria-label="Roof command"
      >
        <div className="border-l-2 border-accent bg-primary/72 p-5 backdrop-blur-sm" style={{ borderRadius: "2px" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">
            <span>Roof command · A-01</span>
            
          </div>
          <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {COMMAND_INTENTS.map(({ icon: Icon, label, href, tone }) => {
              const isExternal = href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("https:");
              const cls = `group flex items-center justify-between gap-3 border px-3 py-2.5 transition ${
                tone === "urgent"
                  ? "border-signal/70 bg-signal/10 text-primary-foreground hover:bg-signal/20"
                  : "border-primary-foreground/15 bg-primary-foreground/5 text-primary-foreground hover:border-accent hover:bg-primary-foreground/10"
              }`;
              const inner = (
                <>
                  <span className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${tone === "urgent" ? "text-signal" : "text-accent"}`} />
                    <span className="font-display text-sm font-semibold">{label}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </>
              );
              return isExternal ? (
                <a key={label} href={href} className={cls} style={{ borderRadius: "2px" }}>{inner}</a>
              ) : (
                <Link key={label} to={href} className={cls} style={{ borderRadius: "2px" }}>{inner}</Link>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-primary-foreground/20 pt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary-foreground/60">
            <span>{BUSINESS.name}</span>
            <span className="text-accent">{BUSINESS.city}, {BUSINESS.region}</span>
          </div>
        </div>
      </aside>
      </div>
    </div>

    {/* Roof System Snapshot strip */}
    <div className="relative z-[2] border-t border-primary-foreground/15 bg-primary/85 backdrop-blur-sm">
      <div className="container-tight grid grid-cols-2 divide-x divide-primary-foreground/10 md:grid-cols-4">
        {SNAPSHOT.map(({ icon: Icon, label, spec }) => (
          <div key={label} className="flex items-center gap-3 px-4 py-4 md:px-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary-foreground/20 bg-primary-foreground/5" style={{ borderRadius: "2px" }}>
              <Icon className="h-5 w-5 text-accent" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-bold uppercase tracking-wider">{label}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary-foreground/65">{spec}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);
