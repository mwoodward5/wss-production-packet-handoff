import { useMemo, useState } from "react";
import { Phone, Mail, MapPin, Leaf, Scissors, TreePine, Hammer, Sparkles, Sun, Snowflake, CloudRain, ChevronDown, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import grassTexture from "@/assets/grass-texture.jpg";
import { clientData, sitePlan } from "@/client-data";

const PHONE_DISPLAY = clientData.phoneDisplay;
const PHONE_TEL = clientData.phoneTel;
const EMAIL = clientData.email;
const EMAIL_HREF = EMAIL ? `mailto:${EMAIL}` : PHONE_TEL;

const serviceIcons = [TreePine, Leaf, CloudRain, CloudRain, Sparkles, Hammer];
const services = clientData.services.map((service, index) => ({
  icon: serviceIcons[index % serviceIcons.length],
  title: service.name,
  shortLabel: service.shortLabel,
  desc: service.description,
}));
const gallery = clientData.gallery;
const serviceHighlights = clientData.services.slice(0, 4).map((service, index) => ({
  icon: serviceIcons[index % serviceIcons.length],
  name: service.shortLabel,
  body: service.description,
}));
const faqs = clientData.faqs;

const ServicePlanner = () => {
  const [focus, setFocus] = useState<string[]>([services[0]?.title].filter(Boolean) as string[]);

  const toggle = (name: string) =>
    setFocus((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));

  const selected = useMemo(
    () => focus.map((name) => services.find((service) => service.title === name)).filter(Boolean),
    [focus],
  );

  const Pill = ({ active, children, onClick }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <Button
      onClick={onClick}
      type="button"
      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-soft"
          : "bg-background text-foreground border-border hover:border-primary/40"
      }`}
    >
      {children}
    </Button>
  );

  return (
    <div className="rounded-3xl bg-card shadow-deep border border-border/60 overflow-hidden">
      <div className="grid lg:grid-cols-5">
        <div className="lg:col-span-3 p-8 md:p-10 space-y-7">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Property Care Planner</p>
            <h3 className="font-display text-3xl md:text-4xl mt-2 text-balance">
              Build a plan around your property.
            </h3>
            <p className="text-muted-foreground mt-3">
              Choose the verified services you would like to discuss with {clientData.businessName}.
            </p>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground/80">Services</p>
            <div className="flex flex-wrap gap-2">
              {services.map((service) => (
                <Pill key={service.title} active={focus.includes(service.title)} onClick={() => toggle(service.title)}>
                  {service.shortLabel}
                </Pill>
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-leaf-gradient text-primary-foreground p-8 md:p-10 flex flex-col">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80">Your plan</p>
          <p className="font-display text-2xl mt-2">{selected.length ? "Services to discuss" : "Choose a service"}</p>
          <ul className="mt-6 space-y-3 flex-1">
            {selected.map((service) => (
              <li key={service!.title} className="flex items-start gap-3 text-sm">
                <Check className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{service!.shortLabel}</span>
              </li>
            ))}
          </ul>
          <a href={PHONE_TEL} className="mt-6 inline-flex items-center justify-center gap-2 bg-background text-foreground rounded-full px-5 py-3 font-semibold hover:bg-cream transition-colors">
            Call {PHONE_DISPLAY} <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
};

const TrustModuleSlots = () => {
  if (!clientData.trustModules.length) return null;
  return (
    <section id="trust" className="relative overflow-hidden bg-noir grain py-24 md:py-32 text-glass">
      <div className="relative mx-auto max-w-7xl px-4 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary-glow">Verified trust</p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {clientData.trustModules.map((id) => (
            <div key={id} className="wss-kit-slot glass-panel p-6" data-wss-module={id} />
          ))}
        </div>
      </div>
    </section>
  );
};

const RichRoutePage = () => {
  const slug = window.location.pathname.split("/").filter(Boolean).join("/");
  const service = sitePlan?.services.find((item) => item.slug === slug);
  const page = sitePlan?.pages.find((item) => item.slug === slug);
  const title = service?.h1 || service?.name || page?.title || "Page";
  const raw = service?.longDescMd || (sitePlan?.content?.[slug] ?? "");
  const paragraphs = String(raw).split("\n\n").map((part) => part.replace(/^#+/, "").trim()).filter(Boolean);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed top-0 inset-x-0 z-50 bg-noir/75 backdrop-blur-2xl border-b border-glass/10 text-glass">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center"><img src={clientData.logoOnDark} alt={clientData.businessName} className="h-10 w-auto" /></a>
          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold uppercase tracking-[0.16em] text-glass/70">
            <a href="/services" className="hover:text-primary-glow transition-colors">Services</a>
            <a href="/gallery" className="hover:text-primary-glow transition-colors">Work</a>
            <a href="/about" className="hover:text-primary-glow transition-colors">About</a>
            <a href="/contact" className="hover:text-primary-glow transition-colors">Contact</a>
          </nav>
          <a href={PHONE_TEL} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold"><Phone className="w-4 h-4" /> Call</a>
        </div>
      </header>
      <section className="relative pt-16 min-h-[58svh] flex items-end overflow-hidden bg-noir grain text-glass">
        <img src={clientData.hero.poster} alt="" className="absolute inset-0 w-full h-full object-cover media-zoom" />
        <div className="absolute inset-0 bg-hero-gradient" /><div className="absolute inset-0 bg-gradient-to-t from-noir via-noir/35 to-noir/30" />
        <div className="relative max-w-7xl mx-auto w-full px-4 md:px-8 pb-16 md:pb-24">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary-glow">{clientData.city}, {clientData.state}</p>
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[0.92] mt-4 max-w-5xl">{title}</h1>
        </div>
      </section>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-16 md:py-24">
        {slug === "gallery" ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{clientData.gallery.map((photo) => <img key={photo.sha256} src={photo.src} alt={photo.alt} className="w-full aspect-[4/3] object-cover rounded-2xl" />)}</div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-10">
            <article className="space-y-6">{paragraphs.length ? paragraphs.map((text, i) => i === 0 ? <p key={i} className="text-xl leading-relaxed">{text}</p> : <p key={i} className="text-muted-foreground leading-relaxed">{text}</p>) : <p className="text-xl">{clientData.serviceIntro}</p>}</article>
            <aside className="glass-panel bg-noir text-glass p-7 self-start sticky top-24"><p className="text-xs uppercase tracking-[0.2em] text-primary-glow">Talk with {clientData.businessName}</p><p className="font-display text-3xl mt-3">Plan your property.</p><a href={PHONE_TEL} className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-5 py-3 font-semibold"><Phone className="w-4 h-4" /> {PHONE_DISPLAY}</a></aside>
          </div>
        )}
      </main>
      <TrustModuleSlots />
      <footer className="bg-noir text-glass px-4 md:px-8 py-12"><div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-6"><img src={clientData.logoOnDark} alt={clientData.businessName} className="h-12 w-auto" /><p>{clientData.city}, {clientData.state}</p><a href={PHONE_TEL}>{PHONE_DISPLAY}</a></div></footer>
    </div>
  );
};

const Index = () => {
  if (window.location.pathname !== "/" && window.location.pathname !== "/index.html") return <RichRoutePage />;
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky top bar */}
      <header className="fixed top-0 inset-x-0 z-50 bg-noir/75 backdrop-blur-2xl border-b border-glass/10 text-glass">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src={clientData.logoOnDark} alt={clientData.businessName} className="h-10 w-auto" />
          </a>
          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold uppercase tracking-[0.16em] text-glass/70">
            <a href="#services" className="hover:text-primary-glow transition-colors">Services</a>
            <a href="#gallery" className="hover:text-primary-glow transition-colors">Work</a>
            <a href="#planner" className="hover:text-primary-glow transition-colors">Planner</a>
          </nav>
          <a href={PHONE_TEL} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Phone className="w-4 h-4" /> <span className="hidden sm:inline">{PHONE_DISPLAY}</span><span className="sm:hidden">Call</span>
          </a>
        </div>
      </header>

      <section id="top" className="relative pt-16 min-h-[100svh] flex items-center overflow-hidden bg-noir grain">
        {/* Cinematic background image with depth-of-field */}
        <img
          src={clientData.hero.poster}
          alt={`${clientData.businessName} project scene`}
          className="absolute inset-0 w-full h-full object-cover media-zoom"
          width={1920}
          height={1280}
        />
        {clientData.hero.video ? (
          <video className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" autoPlay muted loop playsInline poster={clientData.hero.poster} aria-label={`${clientData.businessName} project video`}>
            <source src={clientData.hero.video} type="video/mp4" />
          </video>
        ) : null}
        {/* Morning light wash */}
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute inset-0 bg-gradient-to-t from-noir/90 via-transparent to-noir/30" />

        {/* Topographic contour lines */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.18] mix-blend-screen pointer-events-none" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <radialGradient id="topo" cx="60%" cy="40%" r="70%">
              <stop offset="0%" stopColor="hsl(96 60% 70%)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="hsl(96 60% 70%)" stopOpacity="0" />
            </radialGradient>
          </defs>
          {Array.from({ length: 12 }).map((_, i) => (
            <ellipse key={i} cx="950" cy="500" rx={120 + i * 95} ry={70 + i * 55} fill="none" stroke="url(#topo)" strokeWidth="1" />
          ))}
        </svg>

        {/* Leaf-vein texture overlay */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.08] pointer-events-none" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g stroke="hsl(96 50% 80%)" fill="none" strokeWidth="0.6">
            <path d="M0 600 Q 200 400 400 300 T 800 0" />
            <path d="M50 600 Q 220 380 420 280 T 800 -20" />
            {Array.from({ length: 14 }).map((_, i) => (
              <path key={i} d={`M${100 + i * 50} ${600 - i * 25} Q ${180 + i * 50} ${500 - i * 25} ${260 + i * 50} ${480 - i * 25}`} />
            ))}
          </g>
        </svg>

        {/* Soft landscape-plan grid overlay */}
        <svg className="absolute right-0 bottom-0 w-[55%] h-[55%] opacity-[0.12] pointer-events-none" viewBox="0 0 400 400" aria-hidden="true">
          <defs>
            <pattern id="plan" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="400" height="400" fill="url(#plan)" />
          <circle cx="120" cy="240" r="60" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="1" strokeDasharray="3 3" />
          <path d="M40 320 Q 180 200 360 280" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="1" />
        </svg>

        <div className="absolute left-[4%] bottom-0 hidden lg:block h-36 w-px editorial-rule" />
        <div className="relative max-w-[1440px] mx-auto px-4 md:px-8 py-16 md:py-24 grid lg:grid-cols-12 gap-8 items-center w-full">
          <div className="lg:col-span-7 text-glass reveal-up">
            <span className="inline-flex items-center gap-2 border-l-2 border-primary-glow pl-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary-glow">
              <Leaf className="w-3.5 h-3.5" /> {clientData.hero.eyebrow}
            </span>
            <h1 className="font-display text-6xl md:text-8xl lg:text-[7.5rem] mt-7 leading-[0.82] text-balance [text-shadow:0_12px_50px_hsl(var(--noir)/0.7)]">
              {clientData.hero.line1}<br /><span className="italic font-normal text-primary-glow">{clientData.hero.emphasis}</span><br />{clientData.hero.line3}
            </h1>
            <div className="editorial-rule h-px w-44 mt-8" />
            <p className="mt-6 text-base md:text-lg max-w-xl text-glass/78 leading-relaxed">
              {clientData.hero.support}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={PHONE_TEL} className="glass-shine inline-flex items-center gap-2 bg-primary-glow text-noir px-7 py-4 text-sm font-bold uppercase tracking-[0.12em] shadow-soft hover:bg-glass transition-all">
                <Phone className="w-4 h-4 relative" /> <span className="relative">Call {PHONE_DISPLAY}</span>
              </a>
              <a href={EMAIL_HREF} className="inline-flex items-center gap-2 border border-glass/25 bg-noir/20 backdrop-blur-xl text-glass px-7 py-4 text-sm font-bold uppercase tracking-[0.12em] hover:bg-glass/10 transition-all">
                <Mail className="w-4 h-4 relative" /> <span className="relative">Request an estimate</span>
              </a>
            </div>
          </div>

          {/* Property Care Planner widget */}
          <div className="lg:col-span-5 reveal-up reveal-delay">
            <div className="glass-panel glass-shine relative p-6 md:p-8 border-l-2 border-l-primary-glow">
              <div className="text-primary-glow text-[10px] font-bold tracking-[0.24em] uppercase">01 / Property Care Planner</div>
              <h2 className="font-display text-3xl text-glass mt-4">Shape your property plan.</h2>
              <p className="text-glass/65 text-sm mt-2 mb-6">
                A starting blueprint for your lawn & landscape — pick the care your property needs.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {services.slice(0, 6).map(({ icon: I, shortLabel: label }) => (
                   <div key={label} className="group flex items-center gap-2.5 bg-noir/35 hover:bg-primary-glow/15 border border-glass/10 px-3 py-3 transition-all cursor-default">
                     <span className="w-8 h-8 border border-primary-glow/35 flex items-center justify-center shrink-0">
                       <I className="w-4 h-4 text-primary-glow" />
                    </span>
                    <span className="text-primary-foreground text-sm font-medium leading-tight">{label}</span>
                  </div>
                ))}
              </div>
               <div className="mt-3 flex items-center gap-2.5 bg-copper/25 border border-copper/40 px-3 py-3">
                 <span className="w-8 h-8 bg-copper flex items-center justify-center shrink-0">
                  <Sun className="w-4 h-4 text-accent-foreground" />
                </span>
                <span className="text-primary-foreground text-sm font-medium">{clientData.seasonalNote}</span>
              </div>
               <a href="#planner" className="mt-6 pt-5 border-t border-glass/10 flex items-center justify-between text-glass text-xs font-bold uppercase tracking-[0.15em] hover:text-primary-glow transition-colors">
                Build my full plan <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="absolute bottom-5 right-6 hidden lg:flex items-center gap-3 text-glass/45 text-[10px] font-semibold uppercase tracking-[0.25em] [writing-mode:vertical-rl]">Explore <span className="h-20 w-px editorial-rule" /></div>
      </section>

      <div className="overflow-hidden bg-noir border-y border-glass/10 py-4 text-glass">
        <div className="marquee-track flex w-max items-center whitespace-nowrap text-xs font-semibold uppercase tracking-[0.22em]">
          {[0, 1].map((copy) => <div key={copy} className="flex items-center">{services.slice(0, 6).map((service) => <span key={`${copy}-${service.shortLabel}`} className="flex items-center"><Sparkles className="mx-7 h-3 w-3 text-primary-glow" />{service.shortLabel}</span>)}</div>)}
        </div>
      </div>

      {/* CTA STRIP */}
      <section className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 grid sm:grid-cols-3 gap-4 items-center">
          <a href={PHONE_TEL} className="flex items-center gap-3 group">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><Phone className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Call</p>
              <p className="font-semibold group-hover:underline">{PHONE_DISPLAY}</p>
            </div>
          </a>
          <a href={clientData.website} className="flex items-center gap-3 group">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><Leaf className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Website</p>
              <p className="font-semibold group-hover:underline">{clientData.businessName}</p>
            </div>
          </a>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><MapPin className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Service area</p>
              <p className="font-semibold">{clientData.city}, {clientData.state}</p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="py-24 md:py-32 bg-earth-gradient">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">What we do</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">
              Landscaping and lawn care, done with care.
            </h2>
            <p className="mt-5 text-muted-foreground text-lg">
              {clientData.serviceIntro}
            </p>
          </div>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map(({ icon: Icon, title, desc }) => (
              <div id={title === "Lawn Mowing" ? "lawn-care" : title === "Landscape Design" ? "landscape" : undefined} key={title} className="service-card group scroll-mt-24 bg-card p-7 border border-border/60 hover:shadow-soft transition-all duration-500 hover:-translate-y-2">
                <div className="w-12 h-12 border border-primary/25 bg-secondary text-primary flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GALLERY / TRANSFORMATION */}
      <section id="gallery" className="py-24 md:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
            <div className="max-w-xl">
              <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Photo gallery</p>
              <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Real photos from {clientData.businessName}.</h2>
            </div>
            <p className="text-muted-foreground max-w-md">
              Verified client photos are shown with their original source roles preserved.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {gallery.map((g, i) => (
              <div
                key={g.src}
                className={`relative overflow-hidden bg-muted ${
                  i === 0 ? "col-span-2 row-span-2 aspect-square md:aspect-[4/5]" : "aspect-square"
                }`}
              >
                <img
                  src={g.src}
                  alt={g.alt}
                  loading="lazy"
                  className="w-full h-full object-cover grayscale-[15%] hover:grayscale-0 hover:scale-110 transition-all duration-1000"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY GREENFRONT */}
      <section className="py-24 md:py-32 bg-foreground text-background relative overflow-hidden">
        <img src={grassTexture} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-15" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary-glow uppercase">About {clientData.businessName}</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">
              {clientData.whyHeadline}
            </h2>
            <p className="mt-6 text-background/80 text-lg leading-relaxed">
              {clientData.about}
            </p>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {clientData.values.map(({ title: t, body: d }) => (
                <div key={t} className="border border-background/15 rounded-2xl p-5">
                  <p className="font-display text-lg">{t}</p>
                  <p className="text-sm text-background/70 mt-1">{d}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <img
              src={clientData.aboutPhoto?.src || gallery[0]?.src}
              alt={clientData.aboutPhoto?.alt || `${clientData.businessName} client photo`}
              loading="lazy"
              className="rounded-3xl shadow-deep w-full object-cover aspect-[4/5]"
            />
            {clientData.founded && (
            <div className="absolute -bottom-6 -left-6 hidden md:block bg-primary-glow text-foreground rounded-2xl p-5 shadow-deep max-w-[220px]">
              <p className="font-display text-2xl leading-tight">Since {clientData.founded}</p>
              <p className="text-sm">Founded</p>
            </div>
            )}
          </div>
        </div>
      </section>

      {/* SEASONAL PLANNER */}
      <section id="planner" className="py-24 md:py-32 bg-earth-gradient">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Custom widget</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Property Care Planner</h2>
            <p className="mt-5 text-muted-foreground text-lg">
              Choose the verified services you would like to discuss.
            </p>
          </div>
          <ServicePlanner />

          <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {serviceHighlights.map(({ icon: Icon, name, body }) => (
              <div key={name} className="service-card bg-card p-6 border-t-2 border-t-primary-glow border-x border-b border-border/60 hover:-translate-y-2 transition-transform duration-500">
                <Icon className="w-6 h-6 text-primary mb-3" />
                <p className="font-display text-xl">{name}</p>
                <p className="text-sm text-muted-foreground mt-2">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <TrustModuleSlots />

      {/* FAQ */}
      {faqs.length > 0 && (
      <section id="faq" className="py-24 md:py-32 bg-secondary/40">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase text-center">Questions</p>
          <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance text-center">Good to know.</h2>
          <Accordion type="single" collapsible className="mt-12 space-y-3">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="bg-card rounded-2xl border border-border/60 px-6">
                <AccordionTrigger className="font-display text-lg text-left hover:no-underline">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
      )}
      {/* FINAL CTA */}
      <section className="py-24 md:py-32 bg-leaf-gradient text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <img src={grassTexture} alt="" aria-hidden className="w-full h-full object-cover" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 md:px-8 text-center">
          <h2 className="font-display text-4xl md:text-7xl text-balance leading-tight">
            {clientData.ctaHeadline}
          </h2>
          <p className="mt-6 text-lg md:text-xl opacity-90 max-w-2xl mx-auto">
            {clientData.ctaBody}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href={PHONE_TEL} className="inline-flex items-center gap-2 bg-background text-foreground rounded-full px-7 py-4 font-semibold shadow-deep hover:bg-cream transition-colors">
              <Phone className="w-4 h-4" /> Call {PHONE_DISPLAY}
            </a>
            <a href="#services" className="inline-flex items-center gap-2 bg-foreground/10 backdrop-blur border border-primary-foreground/30 rounded-full px-7 py-4 font-semibold hover:bg-foreground/20 transition-colors">
              <Leaf className="w-4 h-4" /> Explore services
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-foreground text-background py-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8 grid md:grid-cols-3 gap-8 items-start">
          <div className="flex items-center gap-3">
            <img src={clientData.logoOnLight} alt={clientData.businessName} className="h-12 w-auto bg-background rounded-xl p-1.5" />
            <div>
              <p className="text-sm text-background/60">{clientData.city}, {clientData.state}</p>
            </div>
          </div>
          <div className="text-sm space-y-2 text-background/80">
            <a href={PHONE_TEL} className="flex items-center gap-2 hover:text-primary-glow"><Phone className="w-4 h-4" /> {PHONE_DISPLAY}</a>
            <a href={clientData.website} className="flex items-center gap-2 hover:text-primary-glow"><Leaf className="w-4 h-4" /> Official website</a>
            <p className="flex items-center gap-2"><MapPin className="w-4 h-4" /> {clientData.city}, {clientData.state}</p>
          </div>
          <p className="text-xs text-background/50 md:text-right">
            © {new Date().getFullYear()} {clientData.businessName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;