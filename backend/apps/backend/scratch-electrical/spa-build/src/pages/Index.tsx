import { useState } from "react";
import { fact } from "@/lib/facts";
import heroPoster from "@/assets/hero-electrical.jpg";
import w1 from "@/assets/gallery/work-1.jpg";
import w2 from "@/assets/gallery/work-2.jpg";
import w3 from "@/assets/gallery/work-3.jpg";
import w4 from "@/assets/gallery/work-4.jpg";
import w5 from "@/assets/gallery/work-5.jpg";
import w6 from "@/assets/gallery/work-6.jpg";
import w7 from "@/assets/gallery/work-7.jpg";
import w8 from "@/assets/gallery/work-8.jpg";
import {
  Phone,
  Mail,
  MessageSquare,
  Zap,
  ShieldCheck,
  Star,
  Home,
  Building2,
  Gauge,
  PlugZap,
  Battery,
  Lightbulb,
  Wrench,
  Cable,
  ClipboardList,
  Search,
  Hammer,
  MessageCircle,
  MapPin,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";

const BUSINESS_NAME = fact("BUSINESS_NAME");
const PHONE = fact("PHONE");
const PHONE_DIGITS = fact("PHONE_DIGITS");
const TEL_HREF = PHONE_DIGITS ? "tel:+1" + PHONE_DIGITS : "";
const SMS_HREF = PHONE_DIGITS ? "sms:+1" + PHONE_DIGITS : "";
const EMAIL = fact("EMAIL");
const CITY = fact("CITY");
const STATE = fact("STATE");
const COUNTY = fact("COUNTY");
const PROFILE_URL = fact("PROFILE_URL");
const LICENSE = fact("LICENSE");
const LOGO_URL = fact("LOGO_URL");
const RATING = fact("RATING");
const REVIEW_COUNT = fact("REVIEW_COUNT");
const HERO_HEADLINE = fact("HERO_HEADLINE");
const HERO_LINE_A = fact("HERO_LINE_A");
const HERO_LINE_B = fact("HERO_LINE_B");

const PLACE = CITY + ", " + STATE;

// Reduced motion never arms the hero video — the ladder runtime in index.html
// carries the same guard; this one decides whether the element mounts at all.
const heroReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gallery = [w1, w2, w3, w4, w5, w6, w7, w8];

const services = [
  { icon: Home, title: "Residential Electrician", desc: "Home wiring, repairs, outlets, lighting and safety upgrades, done neatly and to code." },
  { icon: Building2, title: "Commercial Electrician", desc: "Storefronts, offices and light commercial spaces — reliable power without the downtime." },
  { icon: Gauge, title: "Panel Upgrades", desc: "Modern service panels and breakers sized for today's electrical loads." },
  { icon: PlugZap, title: "EV Charger Installation", desc: "Level 2 EV chargers wired correctly the first time, indoors or out." },
  { icon: Battery, title: "Generator Installation", desc: "Standby and portable generator setups so an outage doesn't stop everything." },
  { icon: Lightbulb, title: "Fixture Installation", desc: "Lighting, fans, smart switches and fixtures installed cleanly and code-correct." },
  { icon: Wrench, title: "Electrical Troubleshooting", desc: "Tracing the real cause of flickers, trips and dead circuits — not just the symptom." },
  { icon: Cable, title: "Electrical Wiring", desc: "New circuits, rewires, additions and remodels with durable workmanship." },
  { icon: Zap, title: "General Electrical Services", desc: "Residential and commercial electrical work, from small repairs to full installs." },
];

const steps = [
  { icon: MessageCircle, title: "Request Service", desc: "Reach out with what's going on. The details get heard first." },
  { icon: Search, title: "Diagnose & Plan", desc: "The work is assessed and the options explained before anything starts." },
  { icon: Hammer, title: "Complete Work Carefully", desc: "Tidy, safety-first execution with respect for your home or business." },
  { icon: ClipboardList, title: "Follow-Up", desc: "Clear communication on what was done and what to watch for next." },
];

const focusTiles = [
  { icon: Gauge, label: "Service Panels" },
  { icon: PlugZap, label: "EV Charging" },
  { icon: Battery, label: "Generators" },
  { icon: Lightbulb, label: "Lighting & Fixtures" },
  { icon: Cable, label: "Wiring & Circuits" },
  { icon: Wrench, label: "Troubleshooting" },
];

const faqs = [
  {
    q: "What area do you serve?",
    a: COUNTY
      ? "We're based around " + PLACE + " and serve homes and businesses throughout the " + COUNTY + " area."
      : "We're based around " + PLACE + " and serve homes and businesses in the surrounding area.",
  },
  {
    q: "Do you handle both residential and commercial work?",
    a: "Yes — from single-family homes to light commercial spaces, with the same attention to safety and detail.",
  },
  {
    q: "Can you upgrade an electrical panel or install an EV charger?",
    a: "Panel upgrades, EV chargers, generators, fixtures and troubleshooting are core electrical services.",
  },
  {
    q: "How do I request service?",
    a: PHONE
      ? "Call or text " + PHONE + " and we'll get back to you quickly."
      : EMAIL
        ? "Email " + EMAIL + " and we'll get back to you quickly."
        : "Use the contact options on this page and we'll get back to you quickly.",
  },
];

const Section = ({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) => (
  <section id={id} className={`scroll-mt-24 py-20 px-6 ${className}`}>
    <div className="max-w-6xl mx-auto">{children}</div>
  </section>
);

const Index = () => {
  const [navOpen, setNavOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const nav = [
    { href: "#services", label: "Services" },
    { href: "#process", label: "Process" },
    { href: "#about", label: "About" },
    { href: "#gallery", label: "Gallery" },
    { href: "#faq", label: "FAQ" },
    { href: "#contact", label: "Contact" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/90 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 pt-3 pb-2 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-3">
            {LOGO_URL ? (
              <img src={LOGO_URL} alt={BUSINESS_NAME} className="h-10 sm:h-12 w-auto object-contain" />
            ) : (
              <span className="font-bold text-lg sm:text-xl text-gradient-silver">{BUSINESS_NAME}</span>
            )}
          </a>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-primary transition-colors">{n.label}</a>
            ))}
          </nav>
          {PHONE && (
            <a
              href={SMS_HREF}
              className="hidden sm:inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-2 rounded-md hover:shadow-glow transition-shadow text-sm"
            >
              <MessageSquare className="h-4 w-4" /> Text An Expert
            </a>
          )}
          <button
            aria-label="Toggle menu"
            className="md:hidden p-2 text-foreground"
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {/* Location tagline row */}
        <div className="border-t border-border/60 bg-background/95">
          <div className="max-w-6xl mx-auto px-6 py-1.5 flex items-center justify-center md:justify-between gap-3 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              {PLACE}{COUNTY ? <span className="hidden sm:inline">&middot; {COUNTY}</span> : null}
            </span>
            <span className="hidden md:flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Licensed electrical work
            </span>
          </div>
        </div>
        {navOpen && (
          <div className="md:hidden border-t border-border bg-background">
            <nav className="flex flex-col px-6 py-4 gap-3 text-sm">
              {nav.map((n) => (
                <a key={n.href} href={n.href} onClick={() => setNavOpen(false)} className="text-muted-foreground hover:text-primary">{n.label}</a>
              ))}
              {PHONE && (
                <a href={SMS_HREF} className="inline-flex items-center gap-2 text-primary font-semibold">
                  <MessageSquare className="h-4 w-4" /> Text An Expert
                </a>
              )}
              {PHONE && (
                <a href={TEL_HREF} className="inline-flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" /> {PHONE}
                </a>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-hero">
        <div className="absolute inset-0 grid-lines opacity-60 pointer-events-none" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary mb-6">
              <Zap className="h-4 w-4" /> {PLACE}{COUNTY ? <span>&middot; {COUNTY}</span> : null}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] mb-6">
              {HERO_LINE_A && HERO_LINE_B ? (
                <>
                  <span className="text-gradient-silver">{HERO_LINE_A}</span>
                  <br />
                  <span className="text-gradient-bolt">{HERO_LINE_B}</span>
                </>
              ) : (
                <span className="text-gradient-silver">{HERO_HEADLINE}</span>
              )}
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mb-8">
              {BUSINESS_NAME} delivers electrical work for homes and businesses in the {PLACE} area
              — panel upgrades, EV chargers, generators, fixtures, wiring and troubleshooting.
            </p>
            <div className="flex flex-wrap gap-3">
              {PHONE && (
                <a
                  href={TEL_HREF}
                  data-cta="hero-call"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:shadow-glow transition-shadow"
                >
                  <Phone className="h-5 w-5" /> Call {PHONE}
                </a>
              )}
              {PHONE && (
                <a
                  href={SMS_HREF}
                  data-cta="hero-quote"
                  className="inline-flex items-center gap-2 border border-border text-foreground font-semibold px-6 py-3 rounded-md hover:border-primary hover:text-primary transition-colors"
                >
                  <MessageSquare className="h-5 w-5" /> Text An Expert
                </a>
              )}
              {!PHONE && (
                <a
                  href="#contact"
                  data-cta="hero-quote"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:shadow-glow transition-shadow"
                >
                  <MessageSquare className="h-5 w-5" /> Request Service
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-6 mt-10 text-sm text-muted-foreground">
              {RATING && (
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-primary" /> {RATING}{REVIEW_COUNT ? <span>&middot; {REVIEW_COUNT} reviews</span> : null}
                </div>
              )}
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Safety-First Workmanship</div>
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> {PLACE} Area</div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
            <div className="relative w-full max-w-md mx-auto rounded-2xl shadow-card ring-1 ring-border overflow-hidden aspect-[4/5]">
              <img
                src={heroPoster}
                alt="Electrical service panel work"
                className="absolute inset-0 h-full w-full object-cover"
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
                  aria-label="Electrical work in progress"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Trust band */}
      <div className="border-y border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center text-sm">
          {[
            { icon: Home, label: "Residential & Commercial" },
            { icon: ShieldCheck, label: "Careful Workmanship" },
            { icon: Wrench, label: "Troubleshooting & Upgrades" },
            { icon: MessageCircle, label: "Clear Communication" },
          ].map((b) => (
            <div key={b.label} className="flex flex-col items-center gap-2">
              <b.icon className="h-5 w-5 text-primary" />
              <span className="text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Local & Accountable */}
      <Section id="local">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
            <img
              src={w6}
              alt="Electrical panel installation"
              className="relative w-full max-w-md mx-auto rounded-2xl shadow-card ring-1 ring-border object-cover aspect-[4/3]"
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">Local &amp; Accountable</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver mb-5">
              A local crew for {PLACE}.
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {BUSINESS_NAME} works in and around {PLACE}. Every job gets the same approach:
              listen first, explain the options, do the work carefully, and stand behind it.
            </p>
          </div>
        </div>
      </Section>

      {/* Services */}
      <Section id="services" className="bg-card/40 border-y border-border">
        <div className="mb-12 text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">What we do</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver">Electrical Services</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            A full range of electrical services for {CITY} homes and businesses — handled with
            the same attention to safety and detail every time.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {services.map((s) => (
            <div
              key={s.title}
              className="group p-6 rounded-xl bg-card border border-border hover:border-primary/60 transition-colors shadow-card"
            >
              <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Process */}
      <Section id="process">
        <div className="mb-12 text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">How it works</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver">Our Process</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <div key={s.title} className="relative p-6 rounded-xl bg-card border border-border">
              <div className="absolute -top-3 -left-3 h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center text-sm shadow-glow">
                {i + 1}
              </div>
              <s.icon className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-1.5">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Service Focus visual grid */}
      <Section id="focus" className="bg-card/40 border-y border-border">
        <div className="mb-10 text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">Service focus</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver">Where We Specialize</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {focusTiles.map((t) => (
            <div
              key={t.label}
              className="aspect-square rounded-xl bg-background border border-border flex flex-col items-center justify-center gap-3 p-4 hover:border-primary/60 hover:shadow-glow transition-all"
            >
              <t.icon className="h-8 w-8 text-primary" />
              <span className="text-xs sm:text-sm font-medium text-center text-muted-foreground">{t.label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* About — In one paragraph */}
      <Section id="about">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="relative order-2 lg:order-1">
            <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
            <img
              src={w5}
              alt="Electrical wiring work"
              className="relative w-full max-w-sm mx-auto rounded-2xl shadow-card ring-1 ring-border object-cover aspect-square"
            />
          </div>
          <div className="order-1 lg:order-2">
            <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">In one paragraph</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver mb-5">
              Electrical work in {PLACE}, done carefully
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {BUSINESS_NAME} handles electrical repairs and upgrades for homes and businesses in
              the {PLACE} area — from everyday fixes to panel upgrades, fixtures, EV charging,
              generators and troubleshooting. Every job gets careful attention to safety,
              workmanship and clear communication.
            </p>
            {LICENSE && (
              <div className="mt-6 p-4 rounded-lg border border-primary/30 bg-primary/5">
                <p className="text-sm font-semibold text-primary uppercase tracking-wider">Credentials</p>
                <p className="text-sm text-muted-foreground">{LICENSE}</p>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Gallery */}
      <Section id="gallery" className="bg-card/40 border-y border-border">
        <div className="mb-10 text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">The work</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver">This Kind of Work</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Panels, wiring, lighting and installs — the everyday work of a careful electrician.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {gallery.map((img, i) => (
            <div
              key={i}
              className="aspect-square overflow-hidden rounded-lg border border-border bg-background"
            >
              <img
                src={img}
                alt={`Electrical work photo ${i + 1}`}
                loading="lazy"
                className="h-full w-full object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq">
        <div className="mb-10 text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">FAQ</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver">Frequently Asked</h2>
        </div>
        <div className="max-w-3xl mx-auto space-y-3">
          {faqs.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={i} className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => setOpenFaq(open ? null : i)}
                  className="w-full flex items-center justify-between text-left px-5 py-4 hover:bg-muted/40 transition-colors"
                  aria-expanded={open}
                >
                  <span className="font-medium">{f.q}</span>
                  <ChevronDown className={`h-4 w-4 text-primary transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{f.a}</div>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* CTA */}
      <section id="ready" className="scroll-mt-24 py-20 px-6 border-y border-border" style={{ backgroundColor: "#000000" }}>
        <div className="max-w-4xl mx-auto text-center">
          {LOGO_URL && (
            <img
              src={LOGO_URL}
              alt={BUSINESS_NAME}
              className="mx-auto mb-8 w-40 sm:w-52 h-auto object-contain"
            />
          )}
          <h2 className="text-3xl sm:text-5xl font-bold text-gradient-silver mb-6">
            Ready when you need power done right.
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
            Serving the {PLACE} area. Reach out — we'll take it from there.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {PHONE && (
              <a
                href={SMS_HREF}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:shadow-glow transition-shadow"
              >
                <MessageSquare className="h-5 w-5" /> Text An Expert
              </a>
            )}
            {PHONE && (
              <a
                href={TEL_HREF}
                className="inline-flex items-center gap-2 border border-border text-foreground font-semibold px-6 py-3 rounded-md hover:border-primary hover:text-primary transition-colors"
              >
                <Phone className="h-5 w-5" /> Call {PHONE}
              </a>
            )}
            {!PHONE && (
              <a
                href="#contact"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:shadow-glow transition-shadow"
              >
                <MessageSquare className="h-5 w-5" /> Request Service
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Contact */}
      <Section id="contact" className="bg-hero">
        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-primary mb-3">Contact</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gradient-silver mb-5">
              Let's get your project powered.
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md">
              Serving the {PLACE} area. Reach out and we'll take care of the rest.
            </p>
            <div className="space-y-4">
              {PHONE && (
                <a href={SMS_HREF} className="flex items-center gap-3 group">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <MessageSquare className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Text us</div>
                    <div className="font-semibold">{PHONE}</div>
                  </span>
                </a>
              )}
              {PHONE && (
                <a href={TEL_HREF} className="flex items-center gap-3 group" data-cta="dock-call">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Phone className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Call us</div>
                    <div className="font-semibold">{PHONE}</div>
                  </span>
                </a>
              )}
              {EMAIL && (
                <a href={`mailto:${EMAIL}`} className="flex items-center gap-3 group">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Mail className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Email us</div>
                    <div className="font-semibold break-all">{EMAIL}</div>
                  </span>
                </a>
              )}
              {PROFILE_URL && (
                <a href={PROFILE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 group">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Service area</div>
                    <div className="font-semibold">{PLACE}{COUNTY ? <span>&middot; {COUNTY}</span> : null}</div>
                  </span>
                </a>
              )}
              {!PROFILE_URL && (
                <div className="flex items-center gap-3">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Service area</div>
                    <div className="font-semibold">{PLACE}{COUNTY ? <span>&middot; {COUNTY}</span> : null}</div>
                  </span>
                </div>
              )}
              {LICENSE && (
                <div className="flex items-center gap-3">
                  <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <span>
                    <div className="text-xs text-muted-foreground">Credentials</div>
                    <div className="font-semibold">{LICENSE}</div>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="relative rounded-2xl border border-border bg-card p-8 shadow-card">
            <h3 className="font-semibold text-xl mb-2">Request Service</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Prefer to write? Include your address, the issue and the best time to reach you.
            </p>
            <div className="flex flex-col gap-3">
              {PHONE && (
                <a
                  href={SMS_HREF}
                  data-cta="dock-quote"
                  className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:shadow-glow transition-shadow"
                >
                  <MessageSquare className="h-5 w-5" /> Text An Expert
                </a>
              )}
              {EMAIL && (
                <a
                  href={`mailto:${EMAIL}?subject=Service%20Request`}
                  className="inline-flex items-center justify-center gap-2 border border-border font-semibold px-6 py-3 rounded-md hover:border-primary hover:text-primary transition-colors"
                >
                  <Mail className="h-5 w-5" /> Email {BUSINESS_NAME}
                </a>
              )}
              {!PHONE && !EMAIL && (
                <p className="text-sm text-muted-foreground">
                  Contact details for this business are being verified.
                </p>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
            <span><span className="text-gradient-silver font-semibold">{BUSINESS_NAME}</span> &middot; {PLACE}</span>
            {LICENSE && <span className="hidden sm:inline text-border">|</span>}
            {LICENSE && <span>{LICENSE}</span>}
          </div>
          <div>&copy; {new Date().getFullYear()} {BUSINESS_NAME}. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
