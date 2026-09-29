import { useState } from "react";
import { SiteModel, Service } from "@/wss/bridge";
import HeroMedia from "@/wss/HeroMedia";
import {
  Phone, Mail, Clock, MapPin, Wrench, Droplets, Flame, ShowerHead,
  Home, ArrowRight, Check, MessageSquare, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const Index = ({ site, service }: {site: SiteModel; service?: Service}) => {
  const { client, hours: liveHours, photos: displayPhotos, badges, proofCards, steps } = site;
  const BUSINESS = client.identity.businessName;
  const CITY = client.identity.city;
  const STATE = client.identity.state;
  const AREA = site.area;
  const PHONE = client.identity.phoneDisplay;
  const PHONE_TEL = client.identity.phoneTel;
  const SMS_HREF = site.smsHref;
  const EMAIL = site.email;
  const EMAIL_HREF = `mailto:${EMAIL}`;
  const LOGO = client.identity.logoOnDark;
  const HERO_HEADLINE = service?.name || [client.hero.line1, client.hero.emphasis, client.hero.line3].join(" ");
  const ABOUT = client.content.about;
  const liveServices = (service ? [service] : client.services).map((s,index) => ({title:s.name,desc:s.description,href:s.href,icon:[Droplets,ShowerHead,Flame,Wrench,Home][index%5]}));
  const liveFaqs = service ? [] : client.content.faqs;
  const issues = liveServices.slice(0,5).map((s,index) => ({id:`service-${index}`,label:s.title,icon:s.icon}));
  const home = service ? "/" : "";
  const nav = [{href:`${home}#services`,label:"Services"}, ...(!service && displayPhotos.length ? [{href:"#gallery",label:"Gallery"}] : []), ...(steps.length ? [{href:`${home}#process`,label:"Approach"}] : []), {href:"#contact",label:"Contact"}, ...(liveFaqs.length ? [{href:"#faq",label:"FAQ"}] : [])];
  const [selected, setSelected] = useState(issues[0].id);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen text-foreground overflow-x-hidden">
      {site.accent && <style>{`:root,.lucky-hero,.lucky-chrome{--secondary:${site.accent};--accent:${site.accent};--water:${site.accent}}`}</style>}
      {/* Top utility bar */}
      <div className="lucky-chrome hidden md:block border-b border-border/50 bg-background/60 backdrop-blur">
        <div className="container flex justify-between items-center text-xs py-2 text-muted-foreground">
          <span>{BUSINESS} · {AREA}</span>
          <div className="flex items-center gap-5">
            {client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null && <a href={client.trust.aggregate.sourceUrl}>{client.trust.aggregate.rating} / 5 · {client.trust.aggregate.count} reviews</a>}
            {EMAIL && <a href={EMAIL_HREF} className="hover:text-foreground transition flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{EMAIL}</a>}
            {liveHours[0] && <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{[liveHours[0].d, liveHours[0].h].filter(Boolean).join(": ")}</span>}
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="lucky-chrome sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur-xl">
        <div className="container flex items-center justify-between gap-4 py-3">
          <a href={service ? "/" : "#top"} className="flex items-center gap-3 min-w-0">
            {LOGO && <img
              src={LOGO}
              alt={`${BUSINESS} logo`}
              className="h-14 sm:h-16 md:h-20 w-auto object-contain drop-shadow-[0_4px_18px_hsl(36_50%_55%/0.45)]"
            />}
            <div className="leading-tight min-w-0">
              <div className="font-display text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight truncate">
                {BUSINESS}
              </div>
              <div className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
                {AREA}
              </div>
            </div>
          </a>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            {nav.map(l => <a key={l.href} href={l.href} className="hover:text-foreground transition">{l.label}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            {PHONE && <a href={PHONE_TEL} className="hidden sm:block">
              <Button size="sm" className="bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold shadow-copper hover:opacity-95">
                <Phone className="h-4 w-4 mr-1.5" /> <span className="hidden sm:inline">{PHONE}</span>
              </Button>
            </a>}
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card/50 text-foreground hover:bg-card transition"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-border/60 bg-background/95 backdrop-blur">
            <nav className="container py-4 flex flex-col gap-1 text-base">
              {nav.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="py-2.5 px-3 rounded-lg hover:bg-card/60 transition">
                  {l.label}
                </a>
              ))}
              <a href={PHONE_TEL} onClick={() => setMenuOpen(false)} className="mt-2 inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold">
                <Phone className="h-4 w-4" /> Call {PHONE}
              </a>
            </nav>
          </div>
        )}
      </header>

      {/* HERO */}
      <section id="top" className="relative">
        <div className="lucky-hero relative hero-clip overflow-hidden bg-[hsl(222_55%_5%)]">
          {/* Workbench background image */}
          <HeroMedia poster={client.hero.poster} video={client.hero.video} />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-background/85 via-background/70 to-background/95" />

          {/* Animated water mesh */}
          <div aria-hidden className="absolute inset-0 water-mesh aurora-layer" />
          <div aria-hidden className="absolute inset-0 grid-bg opacity-50" />

          {/* Pressure rings */}
          <div aria-hidden className="absolute -top-32 -right-32 h-[640px] w-[640px] pointer-events-none max-w-[80vw]">
            <div className="absolute inset-0 rounded-full pressure-ring" />
            <div className="absolute inset-0 rounded-full pressure-ring" style={{ animationDelay: "1.4s" }} />
            <div className="absolute inset-0 rounded-full pressure-ring" style={{ animationDelay: "2.8s" }} />
          </div>
          <div aria-hidden className="absolute -bottom-40 -left-40 h-[520px] w-[520px] pointer-events-none max-w-[80vw]">
            <div className="absolute inset-0 rounded-full pressure-ring" style={{ animationDelay: "0.7s" }} />
            <div className="absolute inset-0 rounded-full pressure-ring" style={{ animationDelay: "2.1s" }} />
          </div>

          {/* Pipe routing SVG */}
          <svg aria-hidden viewBox="0 0 1600 900" className="absolute inset-0 w-full h-full opacity-30 mix-blend-screen pointer-events-none" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pipeGrad" x1="0" x2="1">
                <stop offset="0%" stopColor="hsl(232 80% 65%)" stopOpacity="0" />
                <stop offset="50%" stopColor="hsl(232 90% 75%)" stopOpacity="1" />
                <stop offset="100%" stopColor="hsl(220 90% 70%)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M-50 180 Q 400 180 500 320 T 1000 360 T 1700 240" fill="none" stroke="url(#pipeGrad)" strokeWidth="2" className="pipe-flow" />
            <path d="M-50 720 Q 300 720 480 600 T 980 560 T 1700 680" fill="none" stroke="url(#pipeGrad)" strokeWidth="2" className="pipe-flow" style={{ animationDelay: "1.5s" }} />
            <path d="M820 -20 L 820 940" stroke="hsl(232 80% 65% / 0.25)" strokeWidth="1" strokeDasharray="2 8" />
          </svg>

          {/* Corner axis ticks */}
          <div aria-hidden className="absolute top-4 left-4 text-[10px] font-mono uppercase tracking-[0.25em] text-secondary/70 hidden sm:block">
            01 · {CITY} {STATE && `· ${STATE}`}
          </div>
          <div aria-hidden className="absolute top-4 right-4 text-[10px] font-mono uppercase tracking-[0.25em] text-secondary/70 hidden sm:block">
            LOCATION · {AREA}
          </div>

          <div className="container relative grid lg:grid-cols-12 gap-10 lg:gap-12 pt-12 pb-32 md:pt-20 md:pb-40 lg:pt-28 lg:pb-48 items-center">
            <div className="min-w-0 lg:col-span-7 animate-fade-up">
              <div className="inline-flex items-center gap-2 rounded-full border border-secondary/40 bg-secondary/10 backdrop-blur px-3.5 py-1.5 text-[11px] uppercase tracking-[0.2em] text-secondary font-semibold">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
                </span>
                {client.hero.eyebrow}
              </div>

              <h1 className="mt-6 min-w-0 font-display font-semibold leading-[0.98] tracking-tight text-[2.5rem] sm:text-[3.5rem] md:text-[4.5rem] lg:text-[5.25rem] [overflow-wrap:anywhere]">
                <span className="block text-gradient-copper">{HERO_HEADLINE}</span>
                <span className="block mt-2 text-base sm:text-lg md:text-xl font-sans font-normal text-secondary/90 uppercase tracking-[0.3em]">
                  {AREA}
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">
                {service?.description || client.hero.support}
              </p>

              {/* Proof chips */}
              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  { icon: MapPin, label: AREA },
                  ...(liveServices.length ? [{ icon: Wrench, label: liveServices.slice(0, 3).map((service) => service.title).join(" · ") }] : []),
                ].map((c) => {
                  const Icon = c.icon;
                  return (
                    <span key={c.label} className="inline-flex items-center gap-1.5 rounded-full border border-secondary/25 bg-card/60 backdrop-blur px-3 py-1.5 text-xs font-medium text-foreground/90">
                      <Icon className="h-3.5 w-3.5 text-secondary" /> {c.label}
                    </span>
                  );
                })}
              </div>

              <div className="mt-7 md:mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
                {PHONE && <a href={PHONE_TEL} className="w-full sm:w-auto group">
                  <Button size="lg" className="relative w-full sm:w-auto h-14 px-8 text-base bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold shadow-copper hover:shadow-glow transition-all overflow-hidden">
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                    <Phone className="h-5 w-5 mr-2 relative" /> <span className="relative">Call {PHONE}</span>
                  </Button>
                </a>}
                {SMS_HREF && <a href={SMS_HREF} className="w-full sm:w-auto">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto h-14 px-7 text-base border-secondary/50 bg-secondary/10 hover:bg-secondary/20 text-foreground backdrop-blur">
                    <MessageSquare className="h-5 w-5 mr-2" /> Text the team
                  </Button>
                </a>}
              </div>

              {badges.length > 0 && <div className="mt-7 md:mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {badges.map(b => <span key={b.title} className="flex items-center gap-2"><Check className="h-4 w-4 text-secondary" />{b.title}</span>)}
              </div>}
            </div>

            {/* Rapid Plumbing Dispatch Panel */}
            <div className="lg:col-span-5 animate-fade-up" style={{ animationDelay: "0.15s" }}>
              <div className="relative">
                <div aria-hidden className="absolute -inset-10 bg-gradient-to-br from-secondary/40 via-primary/15 to-[hsl(220_90%_60%)]/40 blur-3xl animate-glow-pulse" />
                <div aria-hidden className="absolute -top-3 -right-3 h-full w-full rounded-3xl border border-secondary/30 bg-secondary/5 backdrop-blur rotate-1" />

                <div className="relative rounded-3xl overflow-hidden border border-secondary/30 shadow-elevated bg-card-glass -rotate-1 hover:rotate-0 transition-transform duration-500">
                  <div className="relative h-52 md:h-60">
                    {site.dispatch && <img src={site.dispatch.src} alt={site.dispatch.alt} className="w-full h-52 md:h-60 object-cover" width={1600} height={1067} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
                    <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-secondary border border-secondary/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" /> Service Desk
                    </div>
                    <div className="absolute top-3 right-3 text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/80 bg-background/60 backdrop-blur px-2 py-1 rounded-md border border-border">
                      UNIT 01
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-secondary/90 font-mono">Status</div>
                        <div className="font-display text-lg font-semibold text-foreground">Request service</div>
                      </div>
                      <div className="flex items-end gap-0.5 h-8">
                        {[6,10,5,12,8,14,9,11].map((h, i) => (
                          <span key={i} className="w-1 rounded-sm bg-gradient-to-t from-secondary/30 to-secondary animate-glow-pulse" style={{ height: `${h*2}px`, animationDelay: `${i*0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 md:p-6 border-t border-secondary/20">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.25em] text-secondary font-mono font-semibold">Service request</div>
                        <div className="font-display text-lg md:text-xl font-semibold mt-1">What's the issue?</div>
                      </div>
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-secondary/30 to-primary/20 flex items-center justify-center ring-1 ring-secondary/40">
                        <Wrench className="h-5 w-5 text-secondary" />
                      </div>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5 md:gap-2">
                      {issues.map((i) => {
                        const Icon = i.icon;
                        const active = selected === i.id;
                        return (
                          <button
                            key={i.id}
                            aria-pressed={active}
                            onClick={() => setSelected(i.id)}
                            className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 md:p-2.5 transition-all ${active ? "border-secondary bg-secondary/20 text-foreground shadow-[0_0_28px_-6px_hsl(var(--secondary)/0.7)]" : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-secondary/40"}`}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="text-[10px] md:text-[10.5px] font-medium">{i.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <a href={PHONE_TEL} className="mt-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-secondary/25 via-primary/15 to-secondary/25 border border-secondary/50 px-4 py-3 text-sm hover:from-secondary/35 hover:to-secondary/35 transition group">
                      <span className="font-medium">Discuss your {issues.find(i => i.id === selected)?.label.toLowerCase()}</span>
                      <span className="flex items-center gap-1.5 text-secondary font-semibold">
                        <Phone className="h-4 w-4" />
                        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition" />
                      </span>
                    </a>

                    <div className="mt-4 grid grid-cols-2 gap-3 pt-4 border-t border-border/60">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono">Location</div>
                        <div className="text-sm font-semibold mt-0.5">{AREA}</div>
                      </div>
                      <div><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono">Contact</div><div className="text-sm font-semibold mt-0.5">{EMAIL ? "Call or email" : "Call"}</div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Kinetic marquee strip */}
          <div aria-hidden className="absolute bottom-6 left-0 right-0 overflow-hidden pointer-events-none opacity-70">
            <div className="flex animate-marquee whitespace-nowrap text-secondary/60 font-mono text-[11px] uppercase tracking-[0.35em]">
              {Array.from({ length: 2 }).map((_, k) => (
                <div key={k} className="flex items-center gap-6 pr-6">
                  {[...liveServices.map((service) => service.title), AREA].filter(Boolean).map((w, i) => (
                    <span key={`${k}-${i}`} className="flex items-center gap-6">
                      <span>◇</span><span>{w}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TRUST */}
      {proofCards.length > 0 && <section className="border-y border-border/50 bg-card/30">
        <div className="container py-14 grid md:grid-cols-3 gap-8">
          {proofCards.map((t) => (
            <div key={t.title} className="flex gap-4">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] flex items-center justify-center">
                <Check className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <div className="font-display text-xl font-semibold">{t.title}</div>
                <p className="text-muted-foreground mt-1">{t.desc}</p>
                {t.sourceUrl && <a className="text-sm underline" href={t.sourceUrl}>Review source</a>}
              </div>
            </div>
          ))}
        </div>
      </section>}

      {/* SERVICES */}
      <section id="services" className="container py-20 md:py-28">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Services</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold leading-tight">
            Services from <span className="text-gradient-copper">{BUSINESS}</span>.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            {service ? service.shortLabel : client.content.serviceIntro}
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {liveServices.map((s) => {
            const Icon = s.icon;
            return (
              <div id={s.href ? `service-${s.href.slice(1)}` : undefined} key={s.title} className="group relative rounded-2xl border border-border bg-card-glass p-7 hover:border-primary/40 transition-all hover:-translate-y-1">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold">{s.href && !service ? <a href={s.href}>{s.title}</a> : s.title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
                <a href={PHONE_TEL} className="mt-5 inline-flex items-center text-sm text-secondary hover:text-foreground transition">
                  Call to discuss <ArrowRight className="h-4 w-4 ml-1.5 group-hover:translate-x-0.5 transition" />
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* GALLERY */}
      {!service && displayPhotos.length > 0 && <section id="gallery" className="border-y border-border/50 bg-card/20">
        <div className="container py-20 md:py-28">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Gallery</div>
            <h2 className="mt-3 text-4xl md:text-5xl font-semibold leading-tight">
              <span className="text-gradient-copper">{BUSINESS}</span> gallery.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Explore the gallery.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {displayPhotos.map((photo, i) => (
              <a key={photo.src} href={photo.src} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-card">
                <img
                  src={photo.src}
                  alt={photo.alt || `${BUSINESS} gallery image ${i + 1}`}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
              </a>
            ))}
          </div>
        </div>
      </section>}

      {/* PROCESS */}
      {steps.length > 0 && <section id="process" className="relative border-y border-border/50 bg-gradient-to-b from-card/40 to-background">
        <div className="container py-20 md:py-28">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-4">
              <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Our approach</div>
              <h2 className="mt-3 text-4xl md:text-5xl font-semibold leading-tight">
                <span className="text-gradient-copper">{client.content.whyHeadline || BUSINESS}</span>
              </h2>
              <p className="mt-5 text-muted-foreground text-lg">
                {ABOUT}
              </p>
              <a href={PHONE_TEL} className="mt-7 inline-block">
                <Button size="lg" className="bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold shadow-copper">
                  <Phone className="h-4 w-4 mr-2" /> Start with a call
                </Button>
              </a>
            </div>
            <ol className="lg:col-span-8 grid sm:grid-cols-2 gap-5">
              {steps.map((s) => (
                <li key={s.n} className="rounded-2xl border border-border bg-card-glass p-6">
                  <div className="font-display text-3xl text-gradient-copper">{s.n}</div>
                  <div className="mt-3 font-display text-xl font-semibold">{s.title}</div>
                  <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>}

      {/* CONTACT */}
      <section id="contact" className="container py-20 md:py-28">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Contact</div>
            <h2 className="mt-3 text-4xl md:text-5xl font-semibold leading-tight">
              Talk to {BUSINESS} in <span className="text-gradient-copper">{CITY}</span>.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              {site.contactCopy || "Share a short description of the issue and the service address when you contact the team."}
            </p>

            <div className="mt-8 space-y-4">
              {PHONE && <a href={PHONE_TEL} className="flex items-center gap-4 rounded-2xl border border-border bg-card-glass p-5 hover:border-primary/40 transition group">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] flex items-center justify-center shadow-copper">
                  <Phone className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Phone</div>
                  <div className="font-display text-2xl font-semibold">{PHONE}</div>
                </div>
                <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition" />
              </a>}
              {SMS_HREF && <a href={SMS_HREF} className="flex items-center gap-4 rounded-2xl border border-border bg-card-glass p-5 hover:border-secondary/40 transition group">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-secondary to-[hsl(220_80%_65%)] flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Text</div>
                  <div className="font-display text-lg font-semibold">Text the team</div>
                </div>
                <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition" />
              </a>}
              {EMAIL && <a href={EMAIL_HREF} className="flex items-center gap-4 rounded-2xl border border-border bg-card-glass p-5 hover:border-secondary/40 transition group">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-secondary to-[hsl(220_80%_65%)] flex items-center justify-center">
                  <Mail className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Email</div>
                  <div className="font-display text-base sm:text-lg font-semibold truncate">{EMAIL}</div>
                </div>
                <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition" />
              </a>}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-3xl border border-border bg-card-glass p-7 md:p-9 shadow-elevated">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-secondary" />
                <div className="font-display text-2xl font-semibold">Hours</div>
              </div>
              <div className="mt-5 divide-y divide-border">
                {liveHours.length ? liveHours.map((row) => (
                  <div key={row.d} className="flex justify-between py-3 text-sm">
                    <span className="text-muted-foreground">{row.d}</span>
                    <span className="font-medium">{row.h}</span>
                  </div>
                )) : <p className="py-3 text-sm text-muted-foreground">Contact {BUSINESS} to confirm current availability.</p>}
              </div>

              {client.trust.areas.length > 0 && <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 mt-0.5 text-secondary shrink-0" />
                <span>{client.trust.areas.join(" · ")}</span>
              </div>}
              {client.trust.mapUrl && <a href={client.trust.mapUrl} className="block mt-4 underline">Map and directions</a>}
              {client.trust.bookingUrl && <a href={client.trust.bookingUrl} className="block mt-4 underline">Booking options</a>}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      {liveFaqs.length > 0 && <section id="faq" className="border-y border-border/50 bg-card/30">
        <div className="container py-20 md:py-28 max-w-4xl">
          <div className="text-xs uppercase tracking-widest text-secondary font-semibold">FAQ</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold leading-tight">
            Common <span className="text-gradient-copper">questions</span>.
          </h2>
          <Accordion type="single" collapsible className="mt-10 space-y-3">
            {liveFaqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="rounded-2xl border border-border bg-card-glass px-6 data-[state=open]:border-primary/40">
                <AccordionTrigger className="text-left font-display text-lg font-semibold hover:no-underline py-5">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-5">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>}

      {/* CLOSING CTA */}
      <section className="container py-20 md:py-28">
        <div className="relative overflow-hidden rounded-3xl border border-border p-10 md:p-16 text-center bg-gradient-to-br from-card via-background to-card">
          <div className="absolute inset-0 grid-bg opacity-40" />
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-64 w-64 bg-primary/30 blur-3xl rounded-full" />
          <div className="relative">
            {LOGO && <img
              src={LOGO}
              alt={`${BUSINESS} logo`}
              className="mx-auto mb-6 w-[190px] sm:w-[220px] h-auto object-contain drop-shadow-[0_8px_30px_hsl(36_50%_55%/0.45)]"
              style={{ minWidth: "190px" }}
            />}
            <h2 className="mt-2 text-4xl md:text-6xl font-semibold leading-tight max-w-3xl mx-auto">
              <span className="text-gradient-copper">{client.content.ctaHeadline || BUSINESS}</span>
            </h2>
            <p className="mt-5 text-muted-foreground text-lg max-w-xl mx-auto">
              {client.content.ctaBody || `Contact ${BUSINESS}.`}
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              {PHONE && <a href={PHONE_TEL}>
                <Button size="lg" className="h-14 px-8 text-base bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold shadow-copper hover:shadow-glow">
                  <Phone className="h-5 w-5 mr-2" /> Call {PHONE}
                </Button>
              </a>}
              {SMS_HREF && <a href={SMS_HREF}>
                <Button size="lg" variant="outline" className="h-14 px-8 text-base border-secondary/50 bg-secondary/10 hover:bg-secondary/20">
                  <MessageSquare className="h-5 w-5 mr-2" /> Text the team
                </Button>
              </a>}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/50 bg-background">
        <div className="container py-14 grid gap-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              {LOGO && <img src={LOGO} alt={`${BUSINESS} logo`} className="h-14 w-auto object-contain" />}
              <div>
                <div className="font-display text-foreground font-semibold text-lg">{BUSINESS}</div>
                <div className="text-xs text-muted-foreground">Plumbing contractor · {AREA}</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {ABOUT}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {PHONE && <a href={PHONE_TEL} className="text-foreground hover:text-secondary transition">{PHONE}</a>}
              {EMAIL && <a href={EMAIL_HREF} className="text-muted-foreground hover:text-foreground transition">{EMAIL}</a>}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Services</div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {liveServices.slice(0,6).map((s) => (
                <li key={s.title}><a href={s.href || `${home}#services`} className="hover:text-foreground transition">{s.title}</a></li>
              ))}
            </ul>
          </div>

          {liveServices.length > 6 && <div>
            <div className="text-xs uppercase tracking-widest text-secondary font-semibold">Other Services</div>
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {liveServices.slice(6).map((s) => (
                <li key={s.title}><a href={s.href || `${home}#services`} className="hover:text-foreground transition">{s.title}</a></li>
              ))}
            </ul>
          </div>}
        </div>
        <div className="border-t border-border/50">
          <div className="container py-5 flex flex-col sm:flex-row gap-3 justify-between items-center text-xs text-muted-foreground">
            <div>© {new Date().getFullYear()} {BUSINESS} · {AREA}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {nav.map(l => <a key={l.href} href={l.href} className="hover:text-foreground transition">{l.label}</a>)}
              {client.trust.socials.map(url => <a key={url} href={url}>Social profile</a>)}
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile sticky call CTA */}
      {PHONE && <a href={PHONE_TEL} className="md:hidden fixed bottom-4 inset-x-4 z-50 flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-br from-primary to-[hsl(var(--copper-glow))] text-primary-foreground font-semibold shadow-copper">
        <Phone className="h-5 w-5" /> Call {PHONE}
      </a>}
    </div>
  );
};

export default Index;
