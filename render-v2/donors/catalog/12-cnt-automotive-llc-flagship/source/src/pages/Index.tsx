import { useState } from "react";
import { Phone, Mail, Wrench, Gauge, Cog, Droplet, Truck, Ship, Bike, MapPin, ChevronDown, ArrowRight, ShieldCheck, Settings, Search, ClipboardCheck, CheckCircle2, Zap } from "lucide-react";
import { type Site } from "@/lib/wss";
import HeroMedia from "@/components/HeroMedia";
import CertifiedCopy from "@/components/CertifiedCopy";

const Index = ({ site }: { site: Site }) => {
  const { client, gallery, portraits, location, hoursText, mapEmbed } = site;
  const { identity, content, hero, trust } = client;
  const PHONE = identity.phoneDisplay, TEL = identity.phoneTel, EMAIL = identity.email;
  const MAILTO = EMAIL ? `mailto:${EMAIL}` : undefined;
  const GBP = trust.mapUrl;
  const logo = identity.logoOnDark;
  const services = site.serviceCopy.map(s => ({ icon: Wrench, title: s.name, desc: s.summary }));
  const scopes = client.services.map(s => s.name);
  const scopeCopy = site.serviceCopy.map(s => s.detail);
  const faqs = content.faqs;
  // No structured process contract is present: retain its layout, omit unsupported promises.
  const process: { n: string; icon: typeof Wrench; title: string; desc: string }[] = [];

  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeScope, setActiveScope] = useState(0);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* NAV */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="container mx-auto px-4 flex items-center justify-between h-16">
          <a href="#home" className="flex items-center gap-3">
            <img src={logo} alt={`${identity.businessName} logo`} width={40} height={40} className="h-10 w-10 object-contain" />
            <div className="leading-tight">
              <div className="font-bold text-sm tracking-wider">{identity.businessName}</div>
              <div className="text-[10px] text-muted-foreground tracking-[0.2em]">{location}</div>
            </div>
          </a>
          <nav className="hidden md:flex gap-6 text-sm font-medium tracking-wide uppercase">
            <a href="#services" className="hover:text-primary transition">Services</a>
            {process.length > 0 && <a href="#process" className="hover:text-primary transition">Process</a>}
            {gallery.length > 0 && <a href="#gallery" className="hover:text-primary transition">Shop</a>}
            {faqs.length > 0 && <a href="#faq" className="hover:text-primary transition">FAQ</a>}
            <a href="#contact" className="hover:text-primary transition">Contact</a>
          </nav>
          <a href={TEL} className="hidden sm:inline-flex items-center gap-2 px-4 py-2 gradient-red rounded font-semibold text-sm uppercase tracking-wider hover:scale-105 transition">
            <Phone className="h-4 w-4" /> Call Now
          </a>
          <a href={TEL} className="sm:hidden inline-flex items-center justify-center h-11 w-11 gradient-red rounded" aria-label={`Call ${identity.businessName}`}>
            <Phone className="h-5 w-5" />
          </a>
        </div>
      </header>

      {/* HERO */}
      <section id="home" className="relative pt-28 pb-24 md:pt-36 md:pb-36 overflow-hidden bg-black">
        {/* Background image bay */}
        <div className="absolute inset-0">
          <HeroMedia poster={hero.poster} video={hero.video} />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60" />
        </div>

        {/* Carbon weave + grid layers */}
        <div className="absolute inset-0 carbon-weave opacity-30 mix-blend-overlay" />
        <div className="absolute inset-0 bg-grid-dense opacity-20" />

        {/* Irregular oblong garage panels */}
        <div className="absolute -left-24 top-24 w-[480px] h-32 hex-clip bg-gradient-to-r from-primary/20 via-primary/5 to-transparent border border-primary/30 rotate-[-6deg] hidden md:block" />
        <div className="absolute right-[-120px] top-[42%] w-[520px] h-40 blade-clip bg-gradient-to-l from-primary/25 to-transparent border-y border-primary/30 rotate-[4deg] hidden md:block" />
        <div className="absolute left-[-80px] bottom-16 w-[360px] h-24 hex-clip diagonal-stripes opacity-50 hidden md:block" />

        {/* Diagonal red beam */}
        <div className="absolute -top-20 right-0 w-[800px] h-[800px] rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full bg-accent/10 blur-3xl" />

        {/* Scanner sweep — desktop only */}
        <div className="scanner-sweep hidden md:block" />

        <div className="container mx-auto px-4 relative grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 order-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-primary/50 bg-black/60 backdrop-blur text-primary text-xs uppercase tracking-[0.25em] font-mono mb-6 pulse-glow">
              <span className="h-1.5 w-1.5 bg-primary rounded-full" />
              {hero.eyebrow}
            </div>
            {trust.aggregate?.rating != null && trust.aggregate?.count != null && <a href={trust.aggregate.sourceUrl} target="_blank" rel="noopener noreferrer" className="block font-mono text-xs text-primary mb-4">{trust.aggregate.rating}/5 · {trust.aggregate.count} reviews</a>}
            <h1 className="font-bold leading-[0.95] mb-6 drop-shadow-[0_4px_30px_rgba(0,0,0,0.9)]" style={{ fontSize: "clamp(2.5rem, 9vw, 7.5rem)" }}>
              <span className="chrome-text block">{hero.line1}</span>
              <span className="text-stroke block">{hero.emphasis}</span>
              <span className="text-primary block torque-underline">{hero.line3}</span>
            </h1>
            <p className="text-base md:text-lg text-foreground/80 max-w-xl mb-8 leading-relaxed">
              {hero.support}
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
              <a href={TEL} className="cta-shine inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[48px] gradient-red font-bold uppercase tracking-wider shadow-red hover:scale-105 transition rounded-sm">
                <Phone className="h-5 w-5" /> Call {identity.businessName}
                <Wrench className="h-3.5 w-3.5 opacity-70" />
              </a>
              <a href="#contact" className="cta-shine inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[48px] border border-primary/40 bg-black/60 backdrop-blur font-bold uppercase tracking-wider hover:border-primary hover:bg-black/80 transition rounded-sm">
                <Zap className="h-4 w-4 text-primary" /> Contact the Shop <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-10 hidden md:flex flex-wrap gap-x-6 gap-y-2 text-[10px] md:text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground">
              {services.slice(0,4).map(s => <span key={s.title}><span className="text-primary">▸ </span>{s.title}</span>)}
            </div>
          </div>

          {/* REPAIR PATH CONSOLE — hero widget */}
          <div className="lg:col-span-5 relative order-2 mt-8 lg:mt-0">
            <div className="relative border border-primary/40 bg-black/70 backdrop-blur-xl shadow-deep rounded-sm overflow-hidden">
              {/* console header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary/30 bg-gradient-to-r from-primary/20 via-black to-black font-mono text-[10px] uppercase tracking-[0.3em]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-primary">Repair Path Console</span>
                </div>
                <span className="text-muted-foreground">v1.0</span>
              </div>

              {/* status row */}
              <div className="grid grid-cols-3 border-b border-border text-[10px] font-mono uppercase tracking-wider">
                <div className="px-3 py-2 border-r border-border">
                  <div className="text-muted-foreground">Location</div>
                  <div className="text-foreground">{location}</div>
                </div>
                <div className="px-3 py-2 border-r border-border">
                  <div className="text-muted-foreground">Scope</div>
                  <div className="text-primary">{services.length} services</div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-muted-foreground">Contact</div>
                  <div className="text-accent">Direct line</div>
                </div>
              </div>

              {/* path cards grid */}
              <div className="grid grid-cols-2 gap-px bg-border/60 p-px">
                {services.slice(0,6).map((s, i) => ({ icon: s.icon, label: s.title, code: String(i+1).padStart(2, '0') })).map((card) => (
                  <div
                    key={card.code}
                    className="group relative bg-card/80 hover:bg-primary/10 transition p-4 cursor-default"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <card.icon className="h-5 w-5 text-primary group-hover:scale-110 transition" />
                      <span className="font-mono text-[9px] text-muted-foreground tracking-widest">{card.code}</span>
                    </div>
                    <div className="font-bold text-sm uppercase tracking-wide leading-tight">{card.label}</div>
                    <div className="absolute bottom-0 left-0 h-[2px] w-0 group-hover:w-full bg-gradient-to-r from-primary to-accent transition-all duration-500" />
                  </div>
                ))}
              </div>

              {/* footer call line */}
              <a href={TEL} className="cta-shine flex items-center justify-between px-4 py-3 border-t border-primary/40 bg-gradient-to-r from-black via-primary/10 to-black hover:bg-primary/20 transition font-mono text-xs uppercase tracking-widest">
                <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-primary" /> Direct Line</span>
                <span className="font-bold text-base font-sans">{PHONE}</span>
              </a>
            </div>

            {/* bolt accents */}
            <div className="absolute -top-2 -left-2 h-4 w-4 rounded-full border-2 border-primary bg-black" />
            <div className="absolute -top-2 -right-2 h-4 w-4 rounded-full border-2 border-primary bg-black" />
            <div className="absolute -bottom-2 -left-2 h-4 w-4 rounded-full border-2 border-primary bg-black" />
            <div className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-primary bg-black" />
          </div>
        </div>
      </section>


      {/* CTA STRIP */}
      <section className="bg-primary text-primary-foreground border-y-4 border-background">
        <div className="container mx-auto px-4 py-6 grid sm:grid-cols-2 gap-4 items-center">
          <a href={TEL} className="flex items-center gap-4 group">
            <div className="p-3 bg-background/20 rounded-full group-hover:bg-background/30 transition">
              <Phone className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest opacity-80">Click to Call</div>
              <div className="text-xl md:text-2xl font-bold">{PHONE}</div>
            </div>
          </a>
          {EMAIL && <a href={MAILTO} className="flex items-center gap-4 group sm:justify-end">
            <div className="p-3 bg-background/20 rounded-full group-hover:bg-background/30 transition">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest opacity-80">Email the Shop</div>
              <div className="text-lg md:text-xl font-bold break-all">{EMAIL}</div>
            </div>
          </a>}
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="py-24 relative">
        <div className="absolute inset-0 bg-grid opacity-20" />
        <div className="container mx-auto px-4 relative">
          <div className="grid md:grid-cols-12 gap-8 mb-16 items-end">
            <div className="md:col-span-7">
              <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Section 02 — Capabilities</div>
              <h2 className="text-4xl md:text-6xl font-bold leading-tight">Services<br />& Capabilities</h2>
            </div>
            <p className="md:col-span-5 text-muted-foreground">
              {content.serviceIntro}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
            {services.map((s, i) => (
              <div key={i} className="group bg-card p-8 hover:bg-secondary transition relative">
                <div className="absolute top-4 right-4 font-mono text-xs text-muted-foreground">0{i + 1}</div>
                <s.icon className="h-10 w-10 text-primary mb-4 group-hover:scale-110 transition" />
                <h3 className="text-xl font-bold mb-2"><a href={client.services[i].href || '#contact'}>{s.title}</a></h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REPAIR PATH CONSOLE WIDGET */}
      <section className="py-24 gradient-steel relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-dense opacity-20" />
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-12">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Repair Path Console</div>
            <h2 className="text-4xl md:text-5xl font-bold">What Can We Fix Today?</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Select a service to explore its scope.</p>
          </div>

          <div className="max-w-5xl mx-auto border border-primary/40 bg-card/80 backdrop-blur shadow-deep">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/60 font-mono text-xs uppercase tracking-widest">
              <div className="flex gap-2 items-center">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <span className="text-primary">REPAIR-CONSOLE / v1.0</span>
              </div>
              <span className="text-muted-foreground">{location}</span>
            </div>
            <div className="grid md:grid-cols-12">
              <div className="md:col-span-5 border-r border-border p-2 max-h-[420px] overflow-y-auto">
                {scopes.map((s, i) => (
                  <button
                    key={i}
                    aria-pressed={activeScope === i} onClick={() => setActiveScope(i)}
                    className={`w-full text-left px-4 py-3 font-mono text-sm uppercase tracking-wide flex items-center justify-between transition ${
                      activeScope === i ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                    }`}
                  >
                    <span>{String(i + 1).padStart(2, "0")} · {s}</span>
                    <ChevronDown className={`h-4 w-4 transition ${activeScope === i ? "-rotate-90" : ""}`} />
                  </button>
                ))}
              </div>
              <div className="md:col-span-7 p-8">
                <div className="font-mono text-xs uppercase tracking-widest text-primary mb-4">› SCOPE_DETAIL</div>
                <h3 className="text-3xl md:text-4xl font-bold mb-4">{scopes[activeScope]}</h3>
                <div className="text-muted-foreground mb-6"><CertifiedCopy text={scopeCopy[activeScope]} /></div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono mb-6">
                  <div className="border border-border p-3">
                    <div className="text-muted-foreground uppercase">Service</div>
                    <div className="text-foreground mt-1">{scopes[activeScope]}</div>
                  </div>
                  <div className="border border-border p-3">
                    <div className="text-muted-foreground uppercase">Coverage</div>
                    <div className="text-foreground mt-1">{location}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <a href={TEL} className="inline-flex items-center gap-2 px-4 py-3 gradient-red font-bold uppercase tracking-wider text-sm">
                    <Phone className="h-4 w-4" /> Discuss This Service
                  </a>
                  {EMAIL && <a href={MAILTO} className="inline-flex items-center gap-2 px-4 py-3 border border-border font-bold uppercase tracking-wider text-sm hover:border-primary">
                    Email the Shop
                  </a>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS */}
      {process.length > 0 && <section id="process" className="py-24 relative">
        <div className="container mx-auto px-4">
          <div className="mb-16 max-w-2xl">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Section 04 — Process</div>
            <h2 className="text-4xl md:text-6xl font-bold">Our Process</h2>
          </div>
          <div className="grid md:grid-cols-5 gap-px bg-border">
            {process.map((p, i) => (
              <div key={i} className="bg-card p-6 relative group hover:bg-secondary transition">
                <div className="font-mono text-3xl font-bold text-primary/30 group-hover:text-primary transition mb-4">{p.n}</div>
                <p.icon className="h-8 w-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* GALLERY */}
      {gallery.length > 0 && <section id="gallery" className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-12 gap-6 mb-12">
            <div className="md:col-span-7">
              <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Section 05 — Shop Floor</div>
              <h2 className="text-4xl md:text-6xl font-bold">Inside The Bay.</h2>
            </div>
            <p className="md:col-span-5 text-muted-foreground self-end">
              {identity.businessName}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {gallery.map(({path: src}, i) => (
              <div key={i} className={`relative overflow-hidden border border-border group ${i === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"}`}>
                <img src={src} alt={`${identity.businessName} gallery image ${i + 1}`} loading="lazy" decoding="async" width={i === 0 ? 800 : 400} height={i === 0 ? 800 : 400} className="w-full h-full object-cover group-hover:scale-110 transition duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition" />
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* ABOUT */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-grid opacity-15" />
        <div className="container mx-auto px-4 relative grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// About {identity.businessName}</div>
            <h2 className="text-4xl md:text-6xl font-bold mb-6">{content.whyHeadline || identity.businessName}</h2>
            <div className="text-muted-foreground mb-8"><CertifiedCopy text={site.copy.about} /></div>
            <div className="space-y-4">
              {content.values.map(f => ({t: f.title, d: f.body})).map((f, i) => (
                <div key={i} className="flex gap-4 p-4 border border-border bg-card hover:border-primary/50 transition">
                  <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold uppercase tracking-wide">{f.t}</div>
                    <div className="text-sm text-muted-foreground">{f.d}</div>
                  </div>
                </div>
              ))}
              {trust.badges.map(badge => <div key={badge.label} className="flex gap-4 p-4 border border-border bg-card"><ShieldCheck className="h-6 w-6 text-primary" /><div><div className="font-bold uppercase tracking-wide">{badge.label}</div><p className="text-sm text-muted-foreground">{badge.sublabel}</p>{badge.meta && <p className="font-mono text-xs">{badge.meta}</p>}</div></div>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {portraits.map((photo, i) => <img key={photo.path} src={photo.path} alt={`${identity.businessName} image ${i+1}`} loading="lazy" decoding="async" width={600} height={800} className={`aspect-[3/4] object-cover border border-border ${i === 1 ? 'mt-12' : ''}`} />)}
          </div>
        </div>
      </section>

      {trust.reviews.length > 0 && <section aria-label="Customer reviews" className="py-24 gradient-steel"><div className="container mx-auto px-4"><div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Customer Reviews</div><div className="grid md:grid-cols-3 gap-4">{trust.reviews.map((review,i) => <blockquote key={i} className="p-6 border border-border bg-card"><p>{review.text}</p><footer className="mt-4 font-mono text-sm"><a href={review.sourceUrl} target="_blank" rel="noopener noreferrer">{review.author}</a>{review.rating !== null && <span> · {review.rating}/5</span>}</footer></blockquote>)}</div></div></section>}

      {/* MAP / GBP */}
      <section id="map" className="py-24 gradient-steel">
        <div className="container mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Find Us</div>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">{location}</h2>
            <p className="text-muted-foreground mb-6">
              {identity.businessName}
            </p>
            <div className="space-y-3 mb-6 font-mono text-sm">
              <div className="flex gap-3"><MapPin className="h-5 w-5 text-primary" /> {location}</div>
              <div className="flex gap-3"><Phone className="h-5 w-5 text-primary" /> {PHONE}</div>
              {EMAIL && <a href={MAILTO} className="flex gap-3"><Mail className="h-5 w-5 text-primary" /> {EMAIL}</a>}
            </div>
            {hoursText && <><div className="text-xs text-muted-foreground mb-4 font-mono uppercase tracking-widest">Hours</div><div className="text-sm whitespace-pre-line">{hoursText}</div></>}
            {GBP && <a href={GBP} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-6 px-5 py-3 gradient-red font-bold uppercase tracking-wider text-sm">
              <MapPin className="h-4 w-4" /> View on Google
            </a>}
          </div>
          {mapEmbed && <div className="border border-border bg-card overflow-hidden shadow-deep">
            <iframe title={`${identity.businessName} on Google Maps`} src={mapEmbed} className="w-full h-[460px] grayscale contrast-125" loading="lazy" />
          </div>}
        </div>
      </section>

      {/* SERVICE AREA */}
      {(trust.areas.length > 0 || site.copy.serviceArea) && <section id="service-area" className="py-20 border-y border-border">
        <div className="container mx-auto px-4">
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4 text-center">// Service Area</div>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8">Service Area</h2>
          {site.copy.serviceArea && <div className="max-w-3xl mx-auto mb-8 text-muted-foreground"><CertifiedCopy text={site.copy.serviceArea} /></div>}
          <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
            {trust.areas.map((c) => (
              <span key={c} className="px-4 py-2 border border-border bg-card font-mono text-sm uppercase tracking-wider hover:border-primary transition">{c}</span>
            ))}
          </div>
        </div>
      </section>}

      {/* FAQ */}
      {faqs.length > 0 && <section id="faq" className="py-24">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="text-center mb-12">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// FAQ</div>
            <h2 className="text-4xl md:text-5xl font-bold">Common Questions</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i} className="border border-border bg-card">
                <button
                  aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="font-bold uppercase tracking-wide text-sm md:text-base">{f.q}</span>
                  <ChevronDown className={`h-5 w-5 text-primary transition ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 text-muted-foreground border-t border-border pt-4">{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* FINAL CTA */}
      <section id="contact" className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 gradient-red" />
        <div className="absolute inset-0 diagonal-stripes opacity-20" />
        <div className="container mx-auto px-4 relative text-center text-primary-foreground">
          <h2 className="text-5xl md:text-7xl font-bold mb-6 leading-none">{content.ctaHeadline || `Contact ${identity.businessName}`}</h2>
          <div className="text-lg md:text-xl mb-8 opacity-90 max-w-2xl mx-auto"><CertifiedCopy text={site.copy.contact} /></div>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={TEL} className="inline-flex items-center gap-2 px-8 py-4 bg-background text-foreground font-bold uppercase tracking-wider hover:bg-card transition">
              <Phone className="h-5 w-5" /> {PHONE}
            </a>
            {EMAIL && <a href={MAILTO} className="inline-flex items-center gap-2 px-8 py-4 border-2 border-background font-bold uppercase tracking-wider hover:bg-background hover:text-foreground transition">
              <Mail className="h-5 w-5" /> Email the Shop
            </a>}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-background border-t border-border py-12">
        <div className="container mx-auto px-4 grid md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <img src={logo} alt={`${identity.businessName} logo`} className="h-12 w-12 object-contain" />
              <div>
                <div className="font-bold tracking-wider">{identity.businessName}</div>
                <div className="text-xs text-muted-foreground tracking-widest">{location}</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              {identity.businessName}
            </p>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Contact</div>
            <a href={TEL} className="block text-sm hover:text-primary">{PHONE}</a>
            {EMAIL && <a href={MAILTO} className="block text-sm hover:text-primary break-all">{EMAIL}</a>}
            <div className="text-sm text-muted-foreground mt-2">{location}</div>
            {trust.bookingUrl && <a className="block mt-3 text-primary" href={trust.bookingUrl}>Booking options</a>}
            {trust.socials.map((url,i) => <a key={url} className="block mt-2 text-sm" href={url} target="_blank" rel="noopener noreferrer">Social profile {i+1}</a>)}
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Services</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              {client.services.map(service => <li key={service.name}><a href={service.href || '#services'}>{service.name}</a></li>)}
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 mt-10 pt-6 border-t border-border text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} {identity.businessName}. All rights reserved.</span>
          <span className="font-mono uppercase tracking-widest">{location}</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
