import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Phone,
  MessageSquare,
  ChevronRight,
  ShieldCheck,
  Star,
  Clock,
  MapPin,
  Mail,
  Trees,
  Scissors,
  Construction,
  Truck,
  CloudLightning,
  Mountain,
  Sprout,
  Home as HomeIcon,
  CheckCircle2,
  ArrowRight,
  Facebook,
  Maximize2,
  X,
  Navigation,
  Layers,
  Zap,
} from "lucide-react";

import { brandStyle, type BoundSite } from "../wss/bridge";
const SiteContext = createContext<BoundSite | null>(null);
function useSite() {
  const site = useContext(SiteContext);
  if (!site) throw Error("client_data_missing");
  return {
    ...site, client: site.client,
    PHONE_DISPLAY:site.client.identity.phoneDisplay,
    PHONE_TEL:site.client.identity.phoneTel.slice(4),
    EMAIL:site.client.identity.email,
    ADDRESS:`${site.client.identity.city}, ${site.client.identity.state}`,
    SERVICES:site.services.map(s=>({...s,icon:serviceIcon(s.name)})),
    GALLERY:site.gallery.map((m,i)=>({src:m.path,tag:`Photo ${i+1}`,caption:site.client.identity.businessName})),
    FAQS:site.client.content.faqs,
    SERVICE_AREA:site.client.trust.areas.map(name=>({name})),
    TESTIMONIALS:site.client.trust.reviews.slice(0,4).map(t=>({...t,name:t.author})),
  };
}
export function DonorApp({site,path="/"}:{site:BoundSite;path?:string}) {
  return <SiteContext.Provider value={site}><div style={brandStyle(site)}><ClientRoute path={path}/></div></SiteContext.Provider>;
}
function ClientRoute({path}:{path:string}) {
 const {client,plan}=useSite();
 const clean=path.replace(/\/+$/,"")||"/";
 if(clean==="/") return <Home/>;
 const service=client.services.find(s=>s.href===clean);
 if(service) return <><Nav/><main className="bg-[var(--forest-deep)] py-20 text-[var(--bone)]"><div className="mx-auto max-w-7xl px-6"><SectionEyebrow tone="light">{client.identity.businessName}</SectionEyebrow><h1 className="mt-6 font-display text-5xl font-extrabold">{service.name}</h1><p className="mt-6 max-w-2xl whitespace-pre-line text-lg">{service.description}</p><a className="mt-8 inline-flex rounded-full bg-[var(--amber-cta)] px-6 py-3 text-[var(--forest-deep)]" href="#contact">Discuss {service.shortLabel}</a></div></main><ContactSection/><Footer/></>;
 const pages:Record<string,React.ReactNode>={services:<ServicesSection/>,gallery:<GallerySection/>,"service-area":<ServiceAreaSection/>,contact:<ContactSection/>,about:<section className="mx-auto max-w-6xl px-6 py-20"><h1 className="font-display text-5xl font-extrabold">{client.content.whyHeadline||client.identity.businessName}</h1><p className="mt-6 whitespace-pre-line">{plan?.content?.about||client.content.about}</p><ProcessStrip/></section>};
 if(Object.hasOwn(pages,clean.slice(1))) return <><Nav/>{pages[clean.slice(1)]}<Footer/></>;
 return <><Nav/><main className="mx-auto max-w-6xl px-6 py-20"><h1 className="font-display text-5xl">Page not found</h1><a href="/">Home</a></main><Footer/></>;
}

function Home() {

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <TrustStrip />
      <ServicesSection />
      <StormShelterSpotlight />
      <ProcessStrip />
      <GallerySection />
      <TestimonialsSection />
      <ServiceAreaSection />
      <FaqSection />
      <ContactSection />
      <Footer />
      <MobileDock />
    </div>
  );
}

/* ============================================================
   LOGOMARK — masks the source mark inside an amber-glow chip
   and pairs it with a strong stacked wordmark.
   ============================================================ */
function Logomark({ size = "md", tone = "light" }: { size?: "sm" | "md" | "lg"; tone?: "light" | "dark" }) {
  const {client,inset} = useSite();
  // 72px floor on md, 104px on lg, 64px on sm (mobile header)
  const dims = size === "lg" ? "h-[104px] w-[104px]" : size === "sm" ? "h-16 w-16" : "h-[76px] w-[76px]";
  const img  = size === "lg" ? "h-[80px] w-[80px]" : size === "sm" ? "h-12 w-12" : "h-[58px] w-[58px]";
  const word = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  const sub  = size === "lg" ? "text-[12px]" : "text-[11px]";
  return (
    <div className="flex items-center gap-3.5">
      <div className={`logomark-chip relative grid place-items-center rounded-[18px] ${dims}`}>
        <span className="pointer-events-none absolute inset-[3px] rounded-[15px] ring-1 ring-[var(--amber-cta)]/25" aria-hidden />
        <img
          src={tone === "light" ? client.identity.logoOnLight : client.identity.logoOnDark}
          alt={`${client.identity.businessName} logo`}
          className={`${img} object-contain`}
          style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.55)) drop-shadow(0 0 1px rgba(0,0,0,.35))" }}
        />
      </div>
      <div className="leading-none">
        <div className={`font-display ${word} font-extrabold tracking-tight ${tone === "light" ? "text-foreground" : "text-[var(--bone)]"}`}>
          {client.identity.businessName}
        </div>
        <div className={`mt-1 ${sub} font-semibold uppercase tracking-[0.22em] ${tone === "light" ? "text-foreground/60" : "text-[var(--bone)]/70"}`}>
          {client.identity.city}, {client.identity.state}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   NAV
   ============================================================ */
function Nav() {
  const {client,shelter,geo,PHONE_DISPLAY,PHONE_TEL,GALLERY,SERVICE_AREA} = useSite();
  const [open, setOpen] = useState(false);
  const links = [
    ["Services", "/#services"],
    ...(shelter ? [[shelter.shortLabel,"/#storm-shelter"]] : []),
    ...(GALLERY.length ? [["Work","/#work"]] : []),
    ...(SERVICE_AREA.length || geo || client.trust.mapUrl ? [["Service Area","/#service-area"]] : []),
    ["Contact","/#contact"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6 md:grid-cols-[auto_1fr_auto]">
        <a href="/" className="flex min-w-0 items-center">
          <Logomark size="md" tone="light" />
        </a>
        <nav className="hidden items-center justify-center gap-7 text-sm font-medium text-foreground/80 md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-foreground">{label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href={`tel:${PHONE_TEL}`} className="hidden items-center gap-2 rounded-full bg-[var(--amber-cta)] px-4 py-2 text-sm font-semibold text-[var(--forest-deep)] shadow-sm transition hover:bg-[var(--amber-cta-hover)] sm:inline-flex">
            <Phone className="h-4 w-4" />
            {PHONE_DISPLAY}
          </a>
          <button type="button" aria-label="Open menu" onClick={() => setOpen((v) => !v)} className="rounded-md border border-border p-2 md:hidden">
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="flex flex-col px-4 py-3 text-sm font-medium">
            {links.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 transition hover:bg-muted">{label}</a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

/* ============================================================
   HERO — bespoke asymmetric composition
   Left: stacked headline + Job Command panel
   Right: tilted, torn-earth photo plate bleeding off the edge
   Background: topographic contours, equipment LEDs, dust, grade-sweep
   ============================================================ */
function Hero() {
  const {client,inset,shelter,PHONE_DISPLAY,PHONE_TEL} = useSite();
  return (
    <section id="top" className="relative isolate overflow-hidden bg-[var(--forest-ink)]">
      <div className="absolute inset-0 hero-ink" aria-hidden />
      <ContourBackdrop />
      {/* Grade sweep on load */}
      <div className="anim-grade-sweep pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[var(--amber-cta)]/15 to-transparent" aria-hidden />
      {/* Equipment LEDs */}
      <EquipmentLEDs />
      {/* Dust motes */}
      <DustField />

      {/* Client photo plate — original tilted geometry */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] lg:block" aria-hidden>
        <div className="absolute inset-0 origin-bottom-right rotate-[2.5deg]">
          <HeroMedia className="torn-earth h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-l from-transparent via-[var(--forest-ink)]/35 to-[var(--forest-ink)]" />
        </div>
        {/* Inset secondary photo — magazine-style asymmetric frame */}
        {inset && <div className="absolute bottom-10 left-6 hidden h-44 w-64 -rotate-2 overflow-hidden rounded-[2px] border-2 border-[var(--amber-cta)]/70 shadow-2xl xl:block">
          <img src={inset} alt="" className="h-full w-full object-cover" style={{ objectPosition: "center 30%" }} />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--forest-ink)]/85 to-transparent px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--amber-cta)]">{client.identity.businessName}</div>
          </div>
        </div>
        }
        {/* Storm-shelter glyph watermark */}
        {shelter && <svg viewBox="0 0 120 120" className="absolute bottom-6 right-10 h-24 w-24 opacity-30" aria-hidden>
          <rect x="22" y="46" width="76" height="58" rx="5" fill="none" stroke="oklch(0.80 0.16 75)" strokeWidth="2" />
          <rect x="44" y="32" width="32" height="14" rx="2" fill="none" stroke="oklch(0.80 0.16 75)" strokeWidth="2" />
          <path d="M30 104 L30 64 L60 50 L90 64 L90 104" fill="none" stroke="oklch(0.80 0.16 75)" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>}
      </div>

      {/* Mobile photo banner */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[44%] lg:hidden" aria-hidden>
        <HeroMedia className="torn-bottom h-full w-full object-cover opacity-85" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--forest-ink)]" />
      </div>


      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-[44vw] sm:px-6 sm:pt-[40vw] lg:grid lg:grid-cols-12 lg:gap-10 lg:pb-32 lg:pt-24">
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--amber-cta)]/40 bg-[var(--amber-cta)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--amber-cta)] backdrop-blur">
            <span className="anim-led inline-block h-1.5 w-1.5 rounded-full bg-[var(--amber-cta)]" />
            {client.hero.eyebrow}
          </div>

          <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[0.92] tracking-tight text-balance text-[var(--bone)] sm:text-6xl lg:text-[5.2rem]">
            {client.hero.line1} <span className="relative inline-block italic">
              {client.hero.emphasis}
              <svg className="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden>
                <path d="M0 6 Q 50 0 100 5 T 200 4" stroke="oklch(0.80 0.16 75)" strokeWidth="3" fill="none" strokeLinecap="round" />
              </svg>
            </span>{" "}
            <br className="hidden sm:block" /><span className="italic text-[var(--amber-cta)]">{client.hero.line3}</span>
          </h1>

          <p className="mt-6 max-w-xl text-base text-[var(--bone)]/80 sm:text-lg">
            {client.hero.support}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={`tel:${PHONE_TEL}`} className="ring-amber-glow inline-flex items-center gap-2 rounded-full bg-[var(--amber-cta)] px-5 py-3 text-sm font-semibold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)]">
              <Phone className="h-4 w-4" />
              Call {PHONE_DISPLAY}
            </a>
            <a href="#services" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-[var(--bone)] backdrop-blur transition hover:bg-white/10">
              See what we do <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          {/* Job Command — overlaps photo edge on lg */}
          <div className="mt-10 lg:mt-12 lg:max-w-[640px]">
            <JobCommand />
          </div>
        </div>
      </div>
    </section>
  );
}

function ContourBackdrop() {
  return (
    <svg className="anim-contour pointer-events-none absolute -inset-x-20 -inset-y-20 opacity-[0.18] mix-blend-screen" viewBox="0 0 1400 900" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="contours" width="1400" height="900" patternUnits="userSpaceOnUse">
          {Array.from({ length: 18 }).map((_, i) => {
            const r = 80 + i * 60;
            return (
              <path
                key={i}
                d={`M -200 ${300 + i * 28} Q ${200 + i * 30} ${200 + (i % 3) * 60} ${600 + i * 20} ${320 + (i % 4) * 40} T 1500 ${280 + i * 30}`}
                fill="none"
                stroke="oklch(0.80 0.16 75)"
                strokeWidth={i % 4 === 0 ? 1.2 : 0.6}
                opacity={i % 4 === 0 ? 0.9 : 0.5}
              />
            );
          })}
        </pattern>
      </defs>
      <rect width="1400" height="900" fill="url(#contours)" />
    </svg>
  );
}

function EquipmentLEDs() {
  const leds = [
    { x: "18%", y: "82%", d: 0 },
    { x: "62%", y: "58%", d: 0.6 },
    { x: "78%", y: "74%", d: 1.2 },
    { x: "88%", y: "40%", d: 0.3 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {leds.map((l, i) => (
        <span
          key={i}
          className="anim-led absolute block h-2.5 w-2.5 rounded-full bg-[var(--amber-cta)]"
          style={{ left: l.x, top: l.y, animationDelay: `${l.d}s`, boxShadow: "0 0 18px oklch(0.80 0.16 75 / 0.8), 0 0 4px oklch(0.80 0.16 75)" }}
        />
      ))}
    </div>
  );
}

function DustField() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="anim-float-y absolute block rounded-full bg-amber-200/40"
          style={{
            width: `${2 + (i % 4)}px`,
            height: `${2 + (i % 4)}px`,
            left: `${(i * 53) % 100}%`,
            top: `${10 + ((i * 37) % 80)}%`,
            animationDelay: `${(i % 7) * 0.6}s`,
            filter: "blur(0.5px)",
          }}
        />
      ))}
    </div>
  );
}

/* ============================================================
   JOB COMMAND — owner-grade dispatch widget
   ============================================================ */
function JobCommand() {
  const {client,plan,hours,inset,PHONE_DISPLAY,PHONE_TEL,SERVICES} = useSite();
  const [service, setService] = useState<string>(SERVICES[0].id);
  const [urgency, setUrgency] = useState<number>(1); // 0 plan, 1 this week, 2 today
  const [zip, setZip] = useState("");

  const zipState = zip.length === 5 ? "unknown" : null;
  const urgencyMap = [
    {label:"Plan ahead",note:"Choose your preferred timing."},
    {label:"This week",note:"Call to confirm availability."},
    {label:"Today",note:"Call to discuss availability."},
  ];
  const isEmergency = urgency === 2;
  const chips = SERVICES;
  function handoffToForm() {
    window.dispatchEvent(new CustomEvent("wss:quote-init", { detail: { service, zip } }));
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="glass-deep relative overflow-hidden rounded-2xl p-5 text-[var(--bone)] sm:p-6">
      {/* sweep accent */}
      <div className="anim-shimmer pointer-events-none absolute -inset-y-2 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/8 to-transparent" aria-hidden />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[var(--amber-cta)]">
            <Zap className="h-3 w-3" /> Job Command
          </div>
          <div className="mt-0.5 font-display text-lg font-bold leading-tight sm:text-xl">
            Tell us about your job.
          </div>
        </div>
        <div className="hidden shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] sm:block">
          {hours}
        </div>
      </div>

      {/* Job chips */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bone)]/60">Job type</div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {chips.map((c) => {
            const Icon = c.icon;
            const active = service === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setService(c.id)}
                className={[
                  "group flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] font-semibold transition",
                  active
                    ? "border-[var(--amber-cta)] bg-[var(--amber-cta)]/15 text-[var(--bone)] shadow-[inset_0_0_0_1px_oklch(0.80_0.16_75_/_0.5)]"
                    : "border-white/12 bg-white/5 text-[var(--bone)]/75 hover:bg-white/10",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Urgency */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bone)]/60">Urgency</div>
          <div className={`text-[11px] font-semibold ${isEmergency ? "text-[var(--amber-cta)]" : "text-[var(--bone)]/75"}`}>{urgencyMap[urgency].label}</div>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={urgency}
          onChange={(e) => setUrgency(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--amber-cta)]"
          aria-label="How urgent is this job?"
        />
        <div className="mt-1 grid grid-cols-3 text-[10px] uppercase tracking-wider text-[var(--bone)]/45">
          <span>Plan</span>
          <span className="text-center">This week</span>
          <span className="text-right">Today</span>
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--bone)]/65">{urgencyMap[urgency].note}</div>
      </div>

      {/* ZIP / area check */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bone)]/60">ZIP code (optional)</div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            maxLength={5}
            placeholder="ZIP code"
            className="w-28 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-[var(--bone)] placeholder:text-[var(--bone)]/40 focus:border-[var(--amber-cta)] focus:outline-none"
          />
          {zipState && <span className="text-xs text-[var(--bone)]/75">Call to confirm service at this ZIP.</span>}

        </div>
      </div>

      {/* Handoff row */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        {isEmergency ? (
          <a
            href={`tel:${PHONE_TEL}`}
            className="ring-amber-glow col-span-3 flex items-center justify-center gap-2 rounded-lg bg-[var(--amber-cta)] px-4 py-3 text-sm font-bold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)]"
          >
            <Phone className="h-4 w-4" /> Call {PHONE_DISPLAY} now
          </a>
        ) : (
          <>
            <a href={`tel:${PHONE_TEL}`} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-[var(--bone)] transition hover:bg-white/10">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
            <a href="/#contact" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-[var(--bone)] transition hover:bg-white/10">
              <MessageSquare className="h-3.5 w-3.5" /> Contact
            </a>
            <button type="button" onClick={handoffToForm} className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--amber-cta)] px-3 py-2.5 text-xs font-bold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)]">
              Get quote <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <div className="mt-3 text-[10.5px] text-[var(--bone)]/50">
        {client.trust.badges.map(b=>b.label).join(" · ")}
      </div>
    </div>
  );
}

/* ============================================================
   TRUST STRIP — softened (no "5-star" structured claim)
   ============================================================ */
function TrustStrip() {
  const {client,hours,SERVICES} = useSite();
  if (!client.trust.badges.length && !hours) return null;
  const items = [...client.trust.badges.map(b=>({icon:ShieldCheck,label:b.label})),...(hours?[{icon:Clock,label:hours}]:[])];
  return (
    <section className="border-b border-border bg-[var(--bone-dim)]/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-4 text-sm text-foreground/80 sm:px-6">
        {items.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[var(--forest)]" />
            <span className="font-medium">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   SERVICES — shingled bento: 3 hero cards + 5 chip cards
   ============================================================ */
function ServicesSection() {
  const {client,inset,SERVICES} = useSite();
  const big = SERVICES.slice(0,3);
  const small = SERVICES.slice(3);
  return (
    <section id="services" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionEyebrow>Our Services</SectionEyebrow>
        <div className="mt-3 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <h2 className="max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            {client.content.whyHeadline || "Our services"}
          </h2>
          <p className="max-w-md text-foreground/70">
            {client.content.serviceIntro}
          </p>
        </div>

        {/* Hero cards — full-bleed photo with torn mask */}
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {big.map((s) => {
            const Icon = s.icon;
            return (
              <a
                key={s.id}
                href={s.href || "/#contact"}
                className="group relative isolate flex aspect-[5/6] flex-col justify-end overflow-hidden rounded-3xl border border-border bg-[var(--forest-deep)] p-6 text-[var(--bone)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-2xl"
              >
                {s.img && <img src={s.img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-65 transition duration-700 group-hover:scale-[1.05] group-hover:opacity-75" />}
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--forest-ink)] via-[var(--forest-ink)]/55 to-transparent" />
                <div className="absolute left-5 top-5 grid h-11 w-11 place-items-center rounded-xl bg-[var(--amber-cta)] text-[var(--forest-deep)] shadow-lg">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="relative">
                  <h3 className="font-display text-2xl font-extrabold leading-tight">{s.label}</h3>
                  <p className="mt-1.5 max-w-sm text-sm text-[var(--bone)]/80">{s.copy}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--amber-cta)] transition-all group-hover:gap-2.5">
                    Request a quote <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </a>
            );
          })}
        </div>

        {/* Chip cards — compact row */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {small.map((s) => {
            const Icon = s.icon;
            return (
              <a
                key={s.id}
                href={s.href || "/#contact"}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition hover:border-[var(--amber-cta)] hover:shadow-md"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                  {s.img && <img src={s.img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--forest-deep)]/40 to-transparent" />
                  <div className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-md bg-[var(--bone)]/95 text-[var(--forest-deep)]">
                    <Icon className="h-3 w-3" />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-bold">{s.label}</div>
                  <div className="truncate text-xs text-foreground/65">{s.copy}</div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   STORM SHELTER SPOTLIGHT — softened copy, dark inset band
   ============================================================ */
function StormShelterSpotlight() {
  const {inset,shelter,SERVICES,PHONE_DISPLAY,PHONE_TEL} = useSite();
  if (!shelter) return null;
  return (
    <section id="storm-shelter" className="relative isolate overflow-hidden bg-[var(--forest-deep)] py-20 text-[var(--bone)] sm:py-28">
      <div className="absolute inset-0 grain opacity-30" aria-hidden />
      <div className="absolute inset-0 opacity-25" aria-hidden style={{ backgroundImage: `radial-gradient(70% 50% at 20% 30%, oklch(0.45 0.10 80 / 0.5), transparent 60%)` }} />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--amber-cta)]/40 bg-[var(--amber-cta)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[var(--amber-cta)]">
            <ShieldCheck className="h-3.5 w-3.5" /> {shelter?.shortLabel}
          </div>
          <h2 className="mt-4 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            {shelter?.name}
          </h2>
          <p className="mt-4 max-w-xl text-[var(--bone)]/80">
            {shelter?.description}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#contact"
              onClick={() => window.dispatchEvent(new CustomEvent("wss:quote-init", { detail: { service: SERVICES.find(s=>s.name===shelter.name)?.id } }))}
              className="ring-amber-glow inline-flex items-center gap-2 rounded-full bg-[var(--amber-cta)] px-5 py-3 text-sm font-semibold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)]"
            >
              Request shelter sizing <ArrowRight className="h-4 w-4" />
            </a>
            <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-[var(--bone)] backdrop-blur transition hover:bg-white/10">
              <Phone className="h-4 w-4" /> Call {PHONE_DISPLAY}
            </a>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-[var(--amber-cta)]/10 to-transparent blur-2xl" aria-hidden />
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--forest-deep)] p-4">
            <svg viewBox="0 0 400 320" role="img" aria-label="In-ground storm shelter cross-section" className="block h-auto w-full">
              <defs>
                <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.40 0.06 220)" />
                  <stop offset="100%" stopColor="oklch(0.30 0.06 80)" />
                </linearGradient>
                <linearGradient id="ground" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.32 0.05 60)" />
                  <stop offset="100%" stopColor="oklch(0.18 0.04 60)" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="400" height="120" fill="url(#sky)" />
              <path d="M60 120 L60 80 L100 50 L140 80 L140 120 Z" fill="oklch(0.20 0.03 155)" />
              <rect x="92" y="92" width="16" height="28" fill="oklch(0.80 0.16 75 / 0.6)" />
              <g className="anim-canopy">
                <circle cx="200" cy="100" r="22" fill="oklch(0.30 0.07 150)" />
                <rect x="197" y="105" width="6" height="20" fill="oklch(0.22 0.05 60)" />
              </g>
              <g className="anim-canopy" style={{ animationDelay: "1.2s" }}>
                <circle cx="245" cy="108" r="14" fill="oklch(0.32 0.06 150)" />
                <rect x="243" y="110" width="4" height="14" fill="oklch(0.22 0.05 60)" />
              </g>
              <rect x="0" y="120" width="400" height="200" fill="url(#ground)" />
              {[140, 170, 210, 260].map((y) => (
                <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="oklch(1 0 0 / 0.05)" strokeWidth="1" />
              ))}
              <g>
                <rect x="240" y="155" width="130" height="110" rx="8" fill="oklch(0.22 0.03 155)" stroke="oklch(0.80 0.16 75)" strokeWidth="2" />
                <rect x="265" y="120" width="40" height="14" rx="3" fill="oklch(0.80 0.16 75)" />
                <line x1="285" y1="134" x2="285" y2="155" stroke="oklch(0.80 0.16 75)" strokeWidth="3" />
                <path d="M250 155 L260 155 L260 168 L272 168 L272 181 L284 181 L284 195 L296 195 L296 208 L308 208 L308 222 L320 222" fill="none" stroke="oklch(0.80 0.16 75 / 0.65)" strokeWidth="3" />
                <g fill="oklch(0.97 0.012 85)" stroke="oklch(0.97 0.012 85)" strokeWidth="1.2">
                  <circle cx="340" cy="230" r="4" />
                  <line x1="340" y1="234" x2="340" y2="248" />
                  <line x1="340" y1="238" x2="334" y2="244" />
                  <line x1="340" y1="238" x2="346" y2="244" />
                  <line x1="340" y1="248" x2="336" y2="256" />
                  <line x1="340" y1="248" x2="344" y2="256" />
                </g>
              </g>
              <g fontFamily="Inter, sans-serif" fontSize="11" fill="oklch(0.97 0.012 85 / 0.85)">
                <text x="240" y="148">Shelter set & secured</text>
                <text x="20" y="138">Topsoil</text>
                <text x="20" y="200">Compacted backfill</text>
                <text x="20" y="280">Undisturbed earth</text>
              </g>
            </svg>
          </div>
          <p className="mt-3 text-xs text-[var(--bone)]/55">
            Illustrative cross-section. Confirm specifications with the business.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PROCESS — diagonal alternating timeline
   ============================================================ */
function ProcessStrip() {
  const {client,GALLERY} = useSite();
  if (!client.content.values.length) return null;
  const steps = client.content.values.map(v=>[v.title,v.body]);
  return (
    <section className="border-y border-border bg-[var(--bone-dim)]/40 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionEyebrow>Our approach</SectionEyebrow>
        <h2 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl">{client.content.whyHeadline || "About our work"}</h2>

        <ol className="relative mt-10 space-y-5">
          {/* vertical spine */}
          <div className="absolute left-1/2 top-2 hidden h-[calc(100%-1rem)] w-px -translate-x-1/2 bg-gradient-to-b from-[var(--forest)]/30 via-[var(--amber-cta)]/40 to-[var(--forest)]/30 md:block" aria-hidden />
          {steps.map(([title, copy], i) => {
            const left = i % 2 === 0;
            return (
              <li key={title} className="md:grid md:grid-cols-2 md:gap-10">
                <div className={left ? "md:pr-12 md:text-right" : "md:col-start-2 md:pl-12"}>
                  <div className="relative inline-block rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="font-display text-3xl font-extrabold text-[var(--forest)]/25">0{i + 1}</div>
                    <div className="mt-0.5 font-display text-lg font-bold">{title}</div>
                    <div className="mt-1 text-sm text-foreground/70">{copy}</div>
                  </div>
                </div>
                <div className={`relative hidden items-center md:flex ${left ? "md:justify-start" : "md:col-start-1 md:row-start-1 md:justify-end"}`}>
                  <div className={`h-px w-12 ${left ? "ml-0" : "mr-0"} bg-[var(--forest)]/30`} />
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--amber-cta)] bg-background font-bold text-[var(--forest-deep)] shadow">
                    {i + 1}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================
   GALLERY — asymmetric bento + native <dialog> lightbox
   ============================================================ */
function GallerySection() {
  const {client,plan,inset,GALLERY,TESTIMONIALS} = useSite();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (openIdx !== null) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [openIdx]);

  useEffect(() => {
    if (openIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? null : (i + 1) % GALLERY.length));
      if (e.key === "ArrowLeft") setOpenIdx((i) => (i === null ? null : (i - 1 + GALLERY.length) % GALLERY.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx]);

  // Bento class plan: index → class
  const bento = [
    "col-span-2 row-span-2 aspect-square sm:aspect-[5/6]", // 0 big
    "aspect-square",                                        // 1
    "aspect-[5/4]",                                         // 2
    "aspect-square",                                        // 3
    "col-span-2 aspect-[16/9]",                             // 4 wide
    "aspect-square",                                        // 5
    "aspect-[5/4]",                                         // 6
    "col-span-2 aspect-[16/9]",                             // 7 wide
    "aspect-square",                                        // 8
  ];

  if (!GALLERY.length) return null;
  return (
    <section id="work" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionEyebrow>Recent Work</SectionEyebrow>
        <div className="mt-3 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <h2 className="max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            {client.identity.businessName} — gallery
          </h2>

        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {GALLERY.map((g, i) => (
            <button
              key={g.src + i}
              type="button"
              onClick={() => setOpenIdx(i)}
              className={[
                "group relative overflow-hidden rounded-2xl border border-border bg-muted text-left",
                "transition hover:-translate-y-0.5 hover:shadow-xl",
                bento[i] ?? "aspect-square",
              ].join(" ")}
            >
              {/* Amber corner tick */}
              <span className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-[var(--bone)]/85 text-[var(--forest-deep)] opacity-0 backdrop-blur transition group-hover:opacity-100">
                <Maximize2 className="h-3.5 w-3.5" />
              </span>
              <img
                src={g.src}
                alt={`${client.identity.businessName} — ${g.tag}`}
                loading="lazy"
                className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.06]"
                style={{ filter: "saturate(108%) contrast(104%)" }}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--forest-ink)]/75 via-[var(--forest-ink)]/0 to-transparent" />
              <div className="pointer-events-none absolute inset-x-3 bottom-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--amber-cta)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--forest-deep)]">
                  {g.tag}
                </div>
                <div className="mt-1.5 line-clamp-1 text-[12px] font-medium text-[var(--bone)] opacity-0 transition group-hover:opacity-100">
                  {g.caption}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      <dialog
        ref={dialogRef}
        onClose={() => setOpenIdx(null)}
        className="m-auto max-h-[92vh] w-[min(92vw,1100px)] rounded-2xl bg-transparent p-0 backdrop:bg-black/80"
      >
        {openIdx !== null && (
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--forest-ink)] text-[var(--bone)]">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpenIdx(null)}
              className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-[var(--bone)]/90 text-[var(--forest-deep)] shadow"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setOpenIdx((i) => (i === null ? null : (i - 1 + GALLERY.length) % GALLERY.length))}
              className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-[var(--bone)]/85 text-[var(--forest-deep)] shadow sm:grid"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => setOpenIdx((i) => (i === null ? null : (i + 1) % GALLERY.length))}
              className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-[var(--bone)]/85 text-[var(--forest-deep)] shadow sm:grid"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <img src={GALLERY[openIdx].src} alt={GALLERY[openIdx].caption} className="max-h-[78vh] w-full object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[var(--forest-deep)] px-5 py-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--amber-cta)]">{GALLERY[openIdx].tag}</div>
                <div className="text-sm text-[var(--bone)]/85">{GALLERY[openIdx].caption}</div>
              </div>
              <a
                href="/#contact"
                onClick={() => setOpenIdx(null)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--amber-cta)] px-3.5 py-2 text-xs font-bold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)]"
              >
                Discuss a project <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

/* ============================================================
   TESTIMONIALS — verified-from-packet quotes only
   ============================================================ */
function TestimonialsSection() {
  const {client,TESTIMONIALS} = useSite();
  const aggregate = client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null ? client.trust.aggregate : null;
  if (!TESTIMONIALS.length && !aggregate) return null;
  return (
    <section className="bg-[var(--forest-deep)] py-20 text-[var(--bone)] sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionEyebrow tone="light">From customers</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
          Customer reviews.
        </h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur"
              style={{ transform: i % 2 ? "rotate(-0.4deg)" : "rotate(0.4deg)" }}
            >
              <div className="absolute -top-4 left-6 font-display text-6xl leading-none text-[var(--amber-cta)]/60">"</div>
              <blockquote className="relative text-[var(--bone)]/90">{t.text}</blockquote>
              <figcaption className="mt-5 flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--bone)]/85">— {t.name}</span>
                <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] uppercase tracking-wider text-[var(--bone)]/55">Review source</a>
              </figcaption>
            </figure>
          ))}
        </div>
        {aggregate && <a href={aggregate.sourceUrl} className="mt-8 inline-flex rounded-full border border-white/20 px-5 py-3">{aggregate.rating} / 5 · {aggregate.count} reviews</a>}

      </div>
    </section>
  );
}

/* ============================================================
   SERVICE AREA — terrain-styled SVG (no Google key required)
   + real Apple & Google Maps deeplinks
   ============================================================ */
function ServiceAreaSection() {
  const {client,plan,geo,googleDirections,appleDirections,PHONE_TEL,ADDRESS,SERVICE_AREA} = useSite();
  if (!SERVICE_AREA.length && !geo && !client.trust.mapUrl) return null;
  return (
    <section id="service-area" className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionEyebrow>Service Area</SectionEyebrow>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            {client.identity.city}, {client.identity.state}
          </h2>
          <p className="mt-4 max-w-lg text-foreground/70">
            {plan?.content?.["service-area"] || "Service area"}
          </p>
          <ul className="mt-6 grid max-w-md grid-cols-2 gap-x-6 gap-y-2 text-sm text-foreground/80">
            {SERVICE_AREA.map((a) => (
              <li key={a.name} className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[var(--forest)]" />
                <span className="truncate">{a.name}</span>
              </li>
            ))}

          </ul>
          <div className="mt-7 flex flex-wrap gap-2.5">
            {(googleDirections || client.trust.mapUrl) && <a href={googleDirections || client.trust.mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[var(--forest-deep)] px-4 py-2.5 text-sm font-semibold text-[var(--bone)] transition hover:bg-[var(--forest)]">
              <Navigation className="h-4 w-4" /> Google Maps
            </a>}
            {appleDirections && <a href={appleDirections} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-[var(--amber-cta)]">
              <Navigation className="h-4 w-4" /> Apple Maps
            </a>}
            <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-[var(--amber-cta)]">
              <Phone className="h-4 w-4" /> Call
            </a>
          </div>
          <div className="mt-4 text-xs text-foreground/55">
            {ADDRESS}
          </div>
        </div>

        <div className="lg:col-span-3">
          <SatelliteMap />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SATELLITE MAP — certified coordinates only; original map card geometry.
   Donor geographic illustration is intentionally excluded.
   ============================================================ */
function SatelliteMap() {
 const {geo,client}=useSite();
 if(!geo) return null;
 return <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border bg-[var(--forest-deep)] shadow-xl"><iframe title={`${client.identity.businessName} location`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full border-0" src={`https://maps.google.com/maps?q=${geo.lat},${geo.lng}&z=13&t=k&output=embed`}/></div>;
}

function FaqSection() {
  const {FAQS} = useSite();
  if (!FAQS.length) return null;
  return (
    <section className="border-y border-border bg-[var(--bone-dim)]/30 py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight sm:text-5xl">Straight answers.</h2>
        <dl className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQS.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-display text-lg font-semibold text-foreground">
                {f.q}
                <span className="ml-4 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-border text-[var(--forest)] transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-foreground/75">{f.a}</p>
            </details>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ============================================================
   CONTACT
   ============================================================ */
function ContactSection() {
  const {client,plan,PHONE_DISPLAY,PHONE_TEL,EMAIL,ADDRESS,SERVICE_AREA} = useSite();
  return (
    <section id="contact" className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-start gap-12 px-4 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionEyebrow>Get in touch</SectionEyebrow>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight sm:text-5xl">{client.content.ctaHeadline || "Get in touch"}</h2>
          <p className="mt-4 text-foreground/70">
            {plan?.content?.contact || client.content.ctaBody}
          </p>
          <div className="mt-7 space-y-3 text-sm">
            <a href={`tel:${PHONE_TEL}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-[var(--amber-cta)]">
              <Phone className="h-5 w-5 text-[var(--forest)]" />
              <div>
                <div className="font-semibold">{PHONE_DISPLAY}</div>
                <div className="text-xs text-foreground/60">Call</div>
              </div>
            </a>
            {client.trust.bookingUrl && <a href={client.trust.bookingUrl} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-[var(--amber-cta)]">
              <MessageSquare className="h-5 w-5 text-[var(--forest)]" />
              <div>
                <div className="font-semibold">Book online</div>
                <div className="text-xs text-foreground/60">Open booking page</div>
              </div>
            </a>}
            {EMAIL && <a href={`mailto:${EMAIL}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-[var(--amber-cta)]">
              <Mail className="h-5 w-5 text-[var(--forest)]" />
              <div>
                <div className="font-semibold">{EMAIL}</div>
                <div className="text-xs text-foreground/60">Email</div>
              </div>
            </a>}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <HomeIcon className="h-5 w-5 text-[var(--forest)]" />
              <div>
                <div className="font-semibold">{ADDRESS}</div>
                <div className="text-xs text-foreground/60">{SERVICE_AREA.map(a=>a.name).join(" · ")}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-3">
          <QuoteForm />
        </div>
      </div>
    </section>
  );
}

function QuoteForm() {
  const {PHONE_DISPLAY,PHONE_TEL,EMAIL,SERVICES} = useSite();
  const [fields, setFields] = useState({
    name: "",
    phone: "",
    email: "",
    service: SERVICES[0].id,
    zip: "",
    message: "",
    website: "",
  });

  useEffect(() => {
    const handler = (ev: Event) => {
      const d = (ev as CustomEvent<{ service?: string; zip?: string }>).detail || {};
      setFields((f) => ({
        ...f,
        service: (d.service as typeof f.service) || f.service,
        zip: d.zip ?? f.zip,
      }));
    };
    window.addEventListener("wss:quote-init", handler);
    return () => window.removeEventListener("wss:quote-init", handler);
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!EMAIL) return;
    const label = SERVICES.find(s=>s.id===fields.service)?.label || "";
    const body = `${fields.name}\n${fields.phone}\n${fields.email}\n${label}\n${fields.zip}\n${fields.message}`;
    window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(label)}&body=${encodeURIComponent(body)}`;
  }
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <input required value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} maxLength={80} className={inputCls} placeholder="First and last" />
        </Field>
        <Field label="Phone" required>
          <input required type="tel" inputMode="tel" value={fields.phone} onChange={(e) => setFields({ ...fields, phone: e.target.value })} maxLength={25} className={inputCls} placeholder="Your phone number" />
        </Field>
        <Field label="Email" required>
          <input required type="email" value={fields.email} onChange={(e) => setFields({ ...fields, email: e.target.value })} maxLength={160} className={inputCls} placeholder="you@example.com" />
        </Field>
        <Field label="Zip code">
          <input value={fields.zip} onChange={(e) => setFields({ ...fields, zip: e.target.value })} inputMode="numeric" maxLength={20} className={inputCls} placeholder="ZIP code" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Service" required>
            <select required value={fields.service} onChange={(e) => setFields({ ...fields, service: e.target.value as typeof fields.service })} className={inputCls}>
              {SERVICES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Tell us about the job">
            <textarea value={fields.message} onChange={(e) => setFields({ ...fields, message: e.target.value })} rows={4} maxLength={2000} className={inputCls} placeholder="Describe the work and access to the site." />
          </Field>
        </div>
        <input tabIndex={-1} autoComplete="off" aria-hidden value={fields.website} onChange={(e) => setFields({ ...fields, website: e.target.value })} name="website" className="hidden" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!EMAIL} className="ring-amber-glow inline-flex items-center gap-2 rounded-full bg-[var(--amber-cta)] px-5 py-3 text-sm font-semibold text-[var(--forest-deep)] transition hover:bg-[var(--amber-cta-hover)] disabled:opacity-60">
          Open email draft <ArrowRight className="h-4 w-4" />
        </button>
        <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-muted">
          <Phone className="h-4 w-4" /> Or call {PHONE_DISPLAY}
        </a>
      </div>
      <p className="mt-4 text-xs text-foreground/55">{EMAIL ? "This form opens your email app. Review and send the draft there. Nothing is submitted by this site." : "Call the number shown to discuss your project. Online submission is unavailable."}</p>
    </form>
  );
}

const inputCls = "w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-[var(--amber-cta)] focus:outline-none focus:ring-2 focus:ring-[var(--amber-cta)]/30";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-foreground/70">
        {label} {required && <span className="text-[var(--amber-cta-hover)]">*</span>}
      </span>
      {children}
    </label>
  );
}

/* ============================================================
   FOOTER — contour-line top border
   ============================================================ */
function Footer() {
  const {client,hours,inset,PHONE_DISPLAY,PHONE_TEL,EMAIL,ADDRESS,SERVICES} = useSite();
  return (
    <footer className="relative bg-[var(--forest-deep)] text-[var(--bone)]">
      {/* contour top accent */}
      <svg className="absolute inset-x-0 top-0 h-8 w-full opacity-40" viewBox="0 0 1200 32" preserveAspectRatio="none" aria-hidden>
        <path d="M0 8 Q 300 0 600 12 T 1200 6" stroke="oklch(0.80 0.16 75)" strokeWidth="1.2" fill="none" />
        <path d="M0 20 Q 300 12 600 22 T 1200 18" stroke="oklch(0.80 0.16 75 / 0.6)" strokeWidth="0.8" fill="none" />
      </svg>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Logomark size="lg" tone="dark" />
          <p className="mt-4 max-w-md text-sm text-[var(--bone)]/70">
            {client.content.about}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">{client.trust.socials.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer" className="rounded-full border border-white/15 px-3 py-2 text-xs">Business profile {i+1}</a>)}</div>

        </div>
        <div className="lg:col-span-3">
          <div className="text-xs uppercase tracking-widest text-[var(--bone)]/60">Services</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {SERVICES.map((s) => (
              <li key={s.id}><a href={s.href || "/#services"} className="text-[var(--bone)]/85 hover:text-[var(--bone)]">{s.label}</a></li>
            ))}

          </ul>
        </div>
        <div className="lg:col-span-3">
          <div className="text-xs uppercase tracking-widest text-[var(--bone)]/60">Contact</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href={`tel:${PHONE_TEL}`} className="hover:text-[var(--amber-cta)]">{PHONE_DISPLAY}</a></li>
            <li>{EMAIL && <a href={`mailto:${EMAIL}`} className="break-all hover:text-[var(--amber-cta)]">{EMAIL}</a>}</li>
            <li className="text-[var(--bone)]/70">{ADDRESS}</li>
            <li className="text-[var(--bone)]/70">{hours}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-[var(--bone)]/60 sm:flex-row sm:items-center sm:px-6">
          <div>© {new Date().getFullYear()} {client.identity.businessName}</div>
          <div>{client.content.seasonalNote}</div>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   MOBILE DOCK
   ============================================================ */
function MobileDock() {
  const {inset,PHONE_TEL} = useSite();
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 py-2 backdrop-blur md:hidden">
      <div className="grid grid-cols-3 gap-2">
        <a href={`tel:${PHONE_TEL}`} className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--amber-cta)] px-3 py-2.5 text-sm font-semibold text-[var(--forest-deep)]">
          <Phone className="h-4 w-4" /> Call
        </a>
        <a href="/#contact" className="flex items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3 py-2.5 text-sm font-semibold">
          <MessageSquare className="h-4 w-4" /> Contact
        </a>
        <a href="#contact" className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--forest-deep)] px-3 py-2.5 text-sm font-semibold text-[var(--bone)]">
          Quote
        </a>
      </div>
    </div>
  );
}

/* ============================================================
   HELPERS
   ============================================================ */
function SectionEyebrow({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "light" }) {
  return (
    <div className={["inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest",
      tone === "light" ? "border border-white/15 bg-white/5 text-[var(--bone)]/80" : "border border-[var(--forest)]/20 bg-[var(--forest)]/10 text-[var(--forest)]"].join(" ")}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber-cta)]" />
      {children}
    </div>
  );
}

function HeroMedia({className}:{className:string}) {
 const {client}=useSite();
 const [allowed,setAllowed]=useState(false);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
   const q=window.matchMedia('(prefers-reduced-motion: reduce)');
   const update=()=>setAllowed(!q.matches);
   update();q.addEventListener('change',update);
   return ()=>q.removeEventListener('change',update);
 },[]);
 if(client.hero.video && allowed && !failed) return <video className={className} style={{objectPosition:'center 40%'}} src={client.hero.video} poster={client.hero.poster} autoPlay muted loop playsInline onError={()=>setFailed(true)}/>;
 return <img className={className} src={client.hero.poster} alt="" fetchPriority="high" style={{objectPosition:'center 40%'}}/>;
}

function serviceIcon(name:string) {
 if(/shelter|cellar/i.test(name)) return ShieldCheck;
 if(/prun|trim/i.test(name)) return Scissors;
 if(/stump/i.test(name)) return Sprout;
 if(/excavat/i.test(name)) return Construction;
 if(/dirt|grad/i.test(name)) return Truck;
 if(/storm/i.test(name)) return CloudLightning;
 if(/clear/i.test(name)) return Mountain;
 return Trees;
}
