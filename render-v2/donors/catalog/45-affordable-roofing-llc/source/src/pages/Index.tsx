import { useState } from "react";
import { Phone, Mail, MapPin, ShieldCheck, Hammer, CloudLightning, Wrench, Home, Search, PaintBucket, Layers, Droplets, ChevronRight, CheckCircle2, Clock, Award, Users, ArrowRight, Move3d, Facebook, BadgeCheck } from "lucide-react";
import { useClient, HeroMedia, Badges, BrandStyle, contactDraft } from "../wss/bridge";

function serviceIcon(name: string) {
  if (/inspect/i.test(name)) return ShieldCheck;
  if (/coat/i.test(name)) return PaintBucket;
  if (/storm/i.test(name)) return CloudLightning;
  if (/leak/i.test(name)) return Search;
  if (/tile|shingle|deck/i.test(name)) return Layers;
  if (/flat/i.test(name)) return Droplets;
  if (/install/i.test(name)) return Home;
  if (/replac/i.test(name)) return Hammer;
  return Wrench;
}
const Index = () => {
  const {client, plan, gallery: mediaGallery, featured, people} = useClient();
  const {identity, content, trust} = client;
  const PHONE = identity.phoneDisplay, PHONE_HREF = identity.phoneTel, EMAIL = identity.email;
  const logoAlpha = {url:identity.logoOnLight};
  const services = client.services.map(s => ({icon:serviceIcon(s.name),title:s.name,desc:s.description,href:s.href}));
  const gallery = mediaGallery.map((m,i) => ({src:{url:m.path},alt:`${identity.businessName} — project ${i+1}`}));
  const faqs = content.faqs;
  const footerServiceTags = client.services.map(s=>s.name);
  const steps: {n:string;t:string;d:string}[] = []; // No certified process-step contract yet.

  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = (data.get("name") || "").toString().trim().slice(0, 100);
    const phone = (data.get("phone") || "").toString().trim().slice(0, 30);
    const address = (data.get("address") || "").toString().trim().slice(0, 200);
    const service = (data.get("service") || "").toString().trim().slice(0, 80);
    const message = (data.get("message") || "").toString().trim().slice(0, 1500);

    window.location.href = contactDraft(EMAIL, {name,phone,address,service,message});
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 md:pb-0">
      <BrandStyle />
      {/* FAQ JSON-LD */}
      {faqs.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map(f => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a }
          }))
        }).replace(/</g, "\\u003c")
      }} />}

      {/* TOP NAV */}
      <header className="absolute top-0 left-0 right-0 z-40">
        <div className="container-x flex items-center justify-between py-5">
          <a href="#top" className="flex items-center">
            <img
              src={identity.logoOnDark}
              alt={`${identity.businessName} logo`}
              className="w-auto h-auto"
              style={{ maxWidth: "120px" }}
              width={120}
              height={120}
            />
          </a>
          <nav className="hidden lg:flex items-center gap-7 text-sm uppercase tracking-wider text-white/95">
            <a href="#services" className="hover:text-clay transition">Services</a>
            {steps.length > 0 && <a href="#process" className="hover:text-clay transition">Process</a>}
            {trust.areas.length > 0 && <a href="#area" className="hover:text-clay transition">Service Area</a>}
            {faqs.length > 0 && <a href="#faq" className="hover:text-clay transition">FAQ</a>}
            <a href="#contact" className="hover:text-clay transition">Contact</a>
          </nav>
          <a href={PHONE_HREF} className="inline-flex items-center gap-2 text-white font-semibold">
            <Phone className="h-4 w-4 text-clay" /> {PHONE}
          </a>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="relative min-h-[100svh] flex items-end overflow-hidden">
        <HeroMedia />
        <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

        <div className="relative container-x pb-24 pt-40 md:pt-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-clay/20 border border-clay/50 text-clay eyebrow rounded-sm">
              <CloudLightning className="h-3.5 w-3.5" /> {client.hero.eyebrow}
            </div>
            <h1 className="display text-white mt-6 text-5xl sm:text-6xl md:text-8xl">
              {client.hero.line1} <br/>
              <span className="text-clay">{client.hero.emphasis}</span><br/>
              <span className="text-white/95">{client.hero.line3}</span>
            </h1>
            <p className="mt-5 text-lg md:text-xl text-white/95 max-w-2xl">
              {client.hero.support}
            </p>

            {/* Credentials row */}
            <div className="mt-6 flex flex-wrap items-center gap-3 text-white">
              <Badges />
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href={PHONE_HREF} className="btn-clay">
                <Phone className="h-4 w-4" /> Call {PHONE}
              </a>
              <a href="#contact" className="btn-outline-bone">
                Contact us <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
              {content.values.slice(0,4).map(v => ({icon:ShieldCheck,label:v.title})).map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-white/95 text-sm">
                  <Icon className="h-4 w-4 text-clay shrink-0" /> {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="roof-divider" aria-hidden />

      {/* SERVICES (alt bg) */}
      <section id="services" className="relative py-24 md:py-32 alt-section">
        <div className="container-x">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
            <div>
              <div className="eyebrow text-clay">What We Do</div>
              <h2 className="display text-foreground text-4xl md:text-6xl mt-3">
                {identity.businessName}<br/>Services
              </h2>
              <div className="mt-3 text-sm font-semibold tracking-wider uppercase text-muted-foreground">
                <Badges />
              </div>
            </div>
            <p className="text-muted-foreground max-w-md md:text-lg">
              {content.serviceIntro}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map(({ icon: Icon, title, desc, href }) => (
              <article key={title} className="group relative bg-white border border-border p-6 rounded-sm hover:border-clay hover:shadow-md transition">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 grid place-items-center bg-clay/15 text-clay rounded-sm group-hover:bg-clay group-hover:text-white transition">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display text-2xl text-foreground tracking-wide">{href ? <a href={href}>{title}</a> : title}</h3>
                    <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{desc}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Recent Work — branded background, asymmetric padding */}
          {gallery.length > 0 && <div
            className="relative mt-14 rounded-sm overflow-hidden"
            style={{
              paddingTop: "calc(2.25rem * 1.2)",
              paddingBottom: "calc(2.25rem * 0.8)",
              paddingLeft: "1.5rem",
              paddingRight: "1.5rem",
              backgroundColor: "#FAFAF7",
              backgroundImage: `url(${logoAlpha.url})`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "bottom right",
              backgroundSize: "280px auto",
            }}
          >
            <div className="absolute inset-0 bg-white/60 pointer-events-none" aria-hidden />
            <div className="relative">
              <div className="flex items-end justify-between mb-6">
                <div>
                  <div className="eyebrow text-clay">Recent Work</div>
                  <h3 className="font-display text-foreground text-3xl md:text-4xl tracking-wide uppercase mt-2">Project gallery</h3>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {gallery.map((g, i) => (
                  <div key={i} className="relative overflow-hidden rounded-sm group bg-white border border-border aspect-[4/3]">
                    <img src={g.src.url} alt={g.alt} className="h-full w-full object-cover group-hover:scale-105 transition duration-700" loading="lazy" />
                  </div>
                ))}
              </div>
            </div>
          </div>}
        </div>
      </section>

      {/* PROBLEM / SOLUTION (white) */}
      <section className="relative py-24 md:py-32 overflow-hidden bg-white">

        <div className="absolute inset-0 bg-gradient-to-b from-white via-white/85 to-white" />
        <div className="container-x relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="eyebrow text-clay">About {identity.businessName}</div>
              <h2 className="display text-foreground text-4xl md:text-6xl mt-3">
                {content.whyHeadline || identity.businessName}
              </h2>
              <p className="mt-5 text-muted-foreground md:text-lg">
                {content.about}
              </p>
              <div className="mt-8 space-y-4">
                {content.values.map(v => [v.title,v.body]).map(([t, d]) => (
                  <div key={t} className="flex gap-4">
                    <div className="mt-1 h-6 w-6 shrink-0 grid place-items-center bg-clay text-white rounded-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-display text-foreground text-xl tracking-wide">{t}</div>
                      <div className="text-muted-foreground text-sm leading-relaxed">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {featured && <div className="relative">
              <img src={featured.path} alt={`${identity.businessName} project`} className="rounded-sm shadow-[var(--shadow-elevated)] w-full aspect-[4/3] object-cover" loading="lazy" />
              {content.seasonalNote && <div className="absolute -bottom-6 -left-6 bg-clay text-white p-6 rounded-sm max-w-xs shadow-[var(--shadow-clay)] hidden md:block"><div className="mt-2 text-sm font-medium">{content.seasonalNote}</div></div>}
            </div>}
          </div>
        </div>
      </section>

      {/* PROCESS (alt bg) */}
      {steps.length > 0 && <section id="process" className="py-24 md:py-32 alt-section border-y border-border">
        <div className="container-x">
          <div className="text-center max-w-2xl mx-auto">
            <div className="eyebrow text-clay">Our Process</div>
            <h2 className="display text-foreground text-4xl md:text-6xl mt-3">Our Process</h2>
          </div>
          <div className="mt-16 grid md:grid-cols-5 gap-4">
            {steps.map(s => (
              <div key={s.n} className="relative bg-white border border-border p-6 rounded-sm">
                <div className="font-display text-clay text-5xl">{s.n}</div>
                <div className="mt-3 font-display text-foreground text-2xl tracking-wide">{s.t}</div>
                <div className="mt-2 text-muted-foreground text-sm">{s.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* TRUST STRIP (white) */}
      {trust.badges.length > 0 && <section className="py-20 bg-white">
        <div className="container-x">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            {people && <img src={people.path} alt={`${identity.businessName} team`} className="rounded-sm w-full aspect-[4/3] object-cover shadow-[var(--shadow-elevated)]" loading="lazy" />}
            <div>
              <div className="eyebrow text-clay">Credentials</div>
              <h2 className="display text-foreground text-4xl md:text-5xl mt-3">{identity.businessName}</h2>

              <ul className="mt-6 grid sm:grid-cols-2 gap-3">
                {trust.badges.map(b=>b.label).map(x => (
                  <li key={x} className="flex items-center gap-3 text-foreground">
                    <CheckCircle2 className="h-5 w-5 text-clay" /> {x}
                  </li>
                ))}
              </ul>
              <div className="mt-6 inline-flex flex-wrap items-center gap-3 text-sm font-semibold tracking-wider uppercase text-muted-foreground">
                <Badges />
              </div>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href={PHONE_HREF} className="btn-clay"><Phone className="h-4 w-4" /> {PHONE}</a>
                <a href="#contact" className="btn-charcoal">Contact us</a>
              </div>
            </div>
          </div>
        </div>
      </section>}

      {/* SERVICE AREA (alt bg + image) */}
      {trust.areas.length > 0 && <section id="area" className="relative py-24 alt-section border-y border-border overflow-hidden">
        <div className="absolute inset-0 bg-[#F7F7F7]/70" aria-hidden />
        <div className="container-x relative">
          <div className="text-center max-w-3xl mx-auto">
            <div className="eyebrow text-clay">Service Area</div>
            <h2 className="display text-foreground text-4xl md:text-6xl mt-3">Service Area</h2>
            <p className="mt-5 text-muted-foreground">
              {plan?.content?.["service-area"]?.replace(/^\s*#{1,6}[^\n]*(?:\n|$)/, '').trim() || trust.areas.join(" · ")}
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {trust.areas.map(c => (
              <span key={c} className="px-4 py-2 bg-white border border-border text-foreground text-sm rounded-sm shadow-sm">
                <MapPin className="inline h-3.5 w-3.5 mr-1.5 text-clay" />{c}
              </span>
            ))}
          </div>
        </div>
      </section>}

      {/* FAQ (white) */}
      {faqs.length > 0 && <section id="faq" className="py-24 md:py-32 bg-white">
        <div className="container-x grid lg:grid-cols-[1fr_2fr] gap-12">
          <div>
            <div className="eyebrow text-clay">FAQ</div>
            <h2 className="display text-foreground text-4xl md:text-5xl mt-3">Your questions answered.</h2>
            <p className="mt-5 text-muted-foreground">Contact us with your questions.</p>
            <a href={PHONE_HREF} className="btn-clay mt-6"><Phone className="h-4 w-4" /> {PHONE}</a>
          </div>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <details key={i} className="group bg-[#F7F7F7] border border-border rounded-sm p-5 open:border-clay">
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4">
                  <span className="font-display text-foreground text-xl tracking-wide">{f.q}</span>
                  <ChevronRight className="h-5 w-5 text-clay transition group-open:rotate-90 shrink-0" />
                </summary>
                <p className="mt-3 text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>}

      {/* CONTACT (alt bg) */}
      <section id="contact" className="relative py-24 md:py-32 overflow-hidden alt-section">
        <div className="absolute inset-0 bg-gradient-to-br from-clay/10 via-transparent to-transparent" />
        <div className="container-x relative grid lg:grid-cols-2 gap-12">
          <div>
            <div className="eyebrow text-clay">Contact us</div>
            <h2 className="display text-foreground text-4xl md:text-6xl mt-3">{content.ctaHeadline || "Contact us"}</h2>
            <p className="mt-5 text-muted-foreground md:text-lg">
              {content.ctaBody}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              <Badges />
            </div>
            <div className="mt-8 space-y-4">
              {trust.mapUrl && <a className="btn-charcoal" href={trust.mapUrl}>Map and directions</a>}
              {trust.bookingUrl && <a className="btn-charcoal" href={trust.bookingUrl}>Booking</a>}
              <a href={PHONE_HREF} className="flex items-center gap-4 p-4 bg-white border border-border rounded-sm hover:border-clay transition">
                <div className="h-12 w-12 grid place-items-center bg-clay text-white rounded-sm"><Phone className="h-5 w-5" /></div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Call</div>
                  <div className="font-display text-foreground text-2xl tracking-wide">{PHONE}</div>
                </div>
              </a>
              {EMAIL && <a href={`mailto:${EMAIL}`} className="flex items-center gap-4 p-4 bg-white border border-border rounded-sm hover:border-clay transition">
                <div className="h-12 w-12 grid place-items-center bg-clay text-white rounded-sm"><Mail className="h-5 w-5" /></div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Email</div>
                  <div className="font-display text-foreground text-xl tracking-wide break-all">{EMAIL}</div>
                </div>
              </a>}
              <div className="flex items-center gap-4 p-4 bg-white border border-border rounded-sm">
                <div className="h-12 w-12 grid place-items-center bg-clay text-white rounded-sm"><MapPin className="h-5 w-5" /></div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Location</div>
                  <div className="font-display text-foreground text-xl tracking-wide">{identity.city}, {identity.state}</div>
                </div>
              </div>
              {trust.hours?.text && <div className="flex items-center gap-4 p-4 bg-white border border-border rounded-sm">
                <div className="h-12 w-12 grid place-items-center bg-clay text-white rounded-sm"><Clock className="h-5 w-5" /></div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Business Hours</div>
                  <div className="font-display text-foreground text-xl tracking-wide">{trust.hours?.text}</div>
                </div>
              </div>}
            </div>
          </div>

          {EMAIL && <form onSubmit={onSubmit} className="bg-white border border-border rounded-sm p-6 md:p-8 space-y-4 shadow-sm">
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="eyebrow text-muted-foreground">Name</span>
                <input required name="name" maxLength={100} className="mt-2 w-full bg-white border border-border px-4 py-3 rounded-sm text-foreground focus:border-clay focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow text-muted-foreground">Phone</span>
                <input required name="phone" type="tel" maxLength={30} className="mt-2 w-full bg-white border border-border px-4 py-3 rounded-sm text-foreground focus:border-clay focus:outline-none" />
              </label>
            </div>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Property Address</span>
              <input name="address" maxLength={200} className="mt-2 w-full bg-white border border-border px-4 py-3 rounded-sm text-foreground focus:border-clay focus:outline-none" />
            </label>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Service Needed</span>
              <select name="service" className="mt-2 w-full bg-white border border-border px-4 py-3 rounded-sm text-foreground focus:border-clay focus:outline-none">
                {client.services.map(service => <option key={service.name}>{service.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Tell us about your roof</span>
              <textarea name="message" rows={4} maxLength={1500} className="mt-2 w-full bg-white border border-border px-4 py-3 rounded-sm text-foreground focus:border-clay focus:outline-none resize-none" />
            </label>
            <button type="submit" className="btn-clay w-full">
              {submitted ? "Opening Email…" : "Prepare email"} <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-xs text-muted-foreground text-center">
              This opens a draft in your email app; nothing is sent by this website. Addressed to {EMAIL}. Prefer to call? Dial {PHONE}.
            </p>
          </form>}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-border py-12">
        <div className="container-x">
          <div className="grid md:grid-cols-3 gap-8 items-start">
            <div>
              <img
                src={logoAlpha.url}
                alt={`${identity.businessName} logo`}
                className="mb-3 h-auto w-auto"
                style={{ maxWidth: "120px" }}
                width={120}
                height={120}
              />
              <div className="text-foreground text-sm font-semibold mt-2">{identity.businessName}</div>
              <div className="mt-3 text-xs font-bold tracking-wider uppercase text-foreground">
                <Badges />
              </div>
              {trust.socials.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 px-3 py-2 border border-border rounded-sm text-foreground hover:border-clay hover:text-clay transition">Social profile</a>)}
            </div>
            <div className="text-sm text-muted-foreground space-y-2">
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-clay" /> <a href={PHONE_HREF} className="text-foreground hover:text-clay">{PHONE}</a></div>
              {EMAIL && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-clay" /> <a href={`mailto:${EMAIL}`} className="text-foreground hover:text-clay break-all">{EMAIL}</a></div>}
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-clay" /> <span className="text-foreground">{identity.city}, {identity.state}</span></div>
              {trust.hours?.text && <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-clay" /> <span className="text-foreground">{trust.hours?.text}</span></div>}

            </div>
            <div className="text-sm text-muted-foreground">
              <div className="eyebrow text-clay mb-3">Our Services</div>
              <p className="text-foreground">
                {client.services.map(service=>service.name).join(" · ")}
              </p>
            </div>
          </div>

          {/* Service tag boxes above copyright */}
          <div className="mt-10 pt-8 border-t border-border">
            <div className="eyebrow text-muted-foreground mb-4 text-center">Services</div>
            <div className="flex flex-wrap justify-center gap-2">
              {footerServiceTags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 bg-[#F7F7F7] border border-border text-foreground text-xs font-semibold tracking-wide rounded-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-8 text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} {identity.businessName}. All rights reserved. <Badges />
            </div>
          </div>
        </div>
      </footer>

      {/* MOBILE STICKY CTA */}
      <div className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-white/95 backdrop-blur border-t border-border p-3 flex gap-2 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <a href={PHONE_HREF} className="btn-clay flex-1 !py-3 !px-4 text-xs"><Phone className="h-4 w-4" /> Call Now</a>
        <a href="#contact" className="btn-safety flex-1 !py-3 !px-4 text-xs">Contact us</a>
      </div>
    </div>
  );
};

export default Index;
