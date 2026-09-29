import { useEffect, useRef, useState } from "react";
import { site, plan, gallery, secondaryHero, pageCopy, hoursText, brandStyle, type WorkItem } from "@/lib/wss-bridge";
import { Cursor } from "@/components/houck/Cursor";
import { Reveal } from "@/components/houck/Reveal";
import { ThemeToggle } from "@/components/houck/ThemeToggle";
import { CountUp } from "@/components/houck/CountUp";

export default function Index({path = "/"}: {path?:string}) {
  if(path !== "/") return <DetailPage path={path}/>;
  return (
    <div style={brandStyle()} className="grain min-h-screen bg-background text-foreground antialiased">
      <Cursor />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Services />
        <Why />
        {gallery().length > 0 && <Work />}
        {/* Process layout retained below; certified step contract unavailable. */}
        {site.trust.areas.length > 0 && <Area />}
        {site.content.faqs.length > 0 && <Faq />}
        <Contact />
      </main>
      <Footer />
    </div>
  );
}

/* =================================================================== */
/*  NAV                                                                  */
/* =================================================================== */

const NAV = [
  ["Services", "#services"],
  ["Work", "#work"],
  ["Area", "#area"],
  ["FAQ", "#faq"],
  ["Contact", "#contact"],
] as const;

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "border-b border-border/60 bg-ink/85 backdrop-blur-xl shadow-[0_1px_0_var(--border)]"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-3 md:px-10">
        <a href="/#top" className="group flex items-center gap-4" data-cursor="hover" aria-label={site.identity.businessName}>
          <span className="relative grid h-[72px] w-[72px] place-items-center rounded-xl border border-border bg-graphite shadow-[var(--paper-shadow)] transition-transform duration-500 group-hover:-rotate-3">
            <img src={site.identity.logoOnLight} alt={site.identity.businessName} className="h-[60px] w-[60px] object-contain dark:hidden" />
            <img src={site.identity.logoOnDark} alt={site.identity.businessName} className="hidden h-[60px] w-[60px] object-contain dark:block" />
            <span className="pointer-events-none absolute -bottom-[3px] left-3 right-3 h-px bg-brass" />
          </span>
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-[28px] tracking-tight text-bone">
              {site.identity.businessName}
            </span>
            <span className="mt-1 font-mono-tight text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              {site.identity.city}, {site.identity.state}
            </span>
          </span>
        </a>
        <nav className="hidden items-center gap-7 lg:flex">
          {NAV.filter(([, href]) => href !== "#work" || gallery().length > 0).filter(([, href]) => href !== "#faq" || site.content.faqs.length > 0).filter(([, href]) => href !== "#area" || site.trust.areas.length > 0).map(([label, href]) => (
            <a
              key={href}
              href={'/' + href}
              className="group relative font-mono-tight text-xs uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-bone"
              data-cursor="hover"
            >
              {label}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-brass transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a
            href={site.identity.phoneTel}
            className="group inline-flex items-center gap-2 rounded-full border border-brass/50 bg-brass/10 px-4 py-2 font-mono-tight text-xs tracking-[0.18em] text-brass transition-all hover:border-brass hover:bg-brass hover:text-[var(--primary-foreground)]"
            data-cursor="hover"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brass group-hover:bg-[var(--primary-foreground)]" />
            {site.identity.phoneDisplay}
          </a>
        </div>
      </div>
    </header>
  );
}

/* =================================================================== */
/*  HERO                                                                 */
/* =================================================================== */

function ReportRuler() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPct(max <= 0 ? 0 : Math.min(100, Math.round((window.scrollY / max) * 100)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="relative w-full border-t border-border bg-background/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-4 font-mono-tight text-[10px] uppercase tracking-[0.32em] text-muted-foreground md:px-10">
        <span className="text-bone/80">{site.identity.businessName}</span>
        <span className="hidden md:inline">{site.identity.city}, {site.identity.state}</span>
        <span className="flex items-center gap-3">
          <span className="hidden h-px w-12 bg-brass/40 md:inline-block" />
          <span className="tabular-nums">
            Scroll <span className="text-brass">{String(pct).padStart(3, "0")}%</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section
      id="top"
      className="relative isolate overflow-hidden bg-background pb-0 pt-28 md:pt-32"
    >
      {/* Full-width hero backdrop photo */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20">
        <img
          src={site.hero.poster}
          alt=""
          className="h-full w-full object-cover opacity-[0.18] dark:opacity-[0.28]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/85 to-background" />
      </div>
      {/* Ambient blueprint grid + brass haze */}
      <div aria-hidden className="blueprint-grid pointer-events-none absolute inset-0 -z-10 opacity-70" />
      <div
        aria-hidden
        className="blob-drift pointer-events-none absolute -top-40 right-[-10%] -z-10 h-[600px] w-[600px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, oklch(0.78 0.13 78 / 0.18), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="blob-drift-slow pointer-events-none absolute -bottom-32 left-[-15%] -z-10 h-[520px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, oklch(0.56 0.16 38 / 0.12), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="blob-drift-slow pointer-events-none absolute top-1/3 left-1/4 -z-10 h-[380px] w-[380px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, oklch(0.82 0.13 78 / 0.10), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[1440px] px-6 pb-24 md:px-10 lg:pb-28">
        {/* Editorial issue line */}
        <Reveal>
          <header className="flex items-center gap-4 pb-12 font-mono-tight text-[10px] uppercase tracking-[0.32em] text-muted-foreground md:pb-16">
            <span className="rounded-full border border-brass/50 bg-brass/10 px-3 py-1 text-brass whitespace-nowrap">
              {site.hero.eyebrow}
            </span>
            <span className="h-px flex-1 bg-border" />
            <span className="whitespace-nowrap">{site.identity.city}, {site.identity.state}</span>
          </header>
        </Reveal>

        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          {/* LEFT — editorial copy */}
          <div className="lg:col-span-7">
            <Reveal as="h1" className="font-display block leading-[0.95] text-bone text-balance" style={{ fontSize: "var(--fs-display)", letterSpacing: "-0.025em", paddingBottom: "0.12em" }}>
              {site.hero.line1}
              <br />
              <span className="relative inline-block italic font-light">
                <span className="shimmer-text">{site.hero.emphasis}</span>
                <span aria-hidden className="draw-line absolute -bottom-1 left-0 h-[3px] w-full bg-brass/60" />
              </span>
              <br />
              {site.hero.line3}
            </Reveal>

            <Reveal delay={140}>
              <p className="mt-8 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                {site.hero.support}
              </p>
            </Reveal>

            <Reveal delay={260}>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
                <a
                  href="#contact"
                  data-cursor="hover"
                  className="btn-shimmer group relative inline-flex items-center gap-4 overflow-hidden bg-bone px-8 py-4 font-mono-tight text-[11px] uppercase tracking-[0.22em] text-[var(--ink)] shadow-[0_18px_40px_-18px_var(--bone)] transition-all duration-500 hover:-translate-y-0.5 hover:bg-brass hover:text-[var(--primary-foreground)] hover:shadow-[0_28px_50px_-18px_oklch(0.62_0.14_60/0.55)]"
                >
                  <span className="relative z-10">Request Service</span>
                  <svg className="relative z-10 h-4 w-4 transition-transform duration-500 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
                <a
                  href={site.identity.phoneTel}
                  data-cursor="hover"
                  className="group flex flex-col"
                >
                  <span className="font-mono-tight text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
                    Direct line
                  </span>
                  <span className="relative mt-1 inline-block font-display text-lg text-bone transition-colors group-hover:text-brass">
                    {site.identity.phoneDisplay}
                    <span aria-hidden className="absolute -bottom-0.5 left-0 h-[2px] w-full origin-left scale-x-100 bg-brass transition-transform duration-500 group-hover:scale-x-110" />
                  </span>
                </a>
              </div>
            </Reveal>
          </div>

          {/* RIGHT — tactile image plate */}
          <Reveal delay={200} className="lg:col-span-5">
            <div
              className="relative mx-auto w-full max-w-[460px]"
              style={{ perspective: "1200px" }}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width - 0.5;
                const y = (e.clientY - r.top) / r.height - 0.5;
                e.currentTarget.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
                e.currentTarget.style.setProperty("--ry", `${(x * 8).toFixed(2)}deg`);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.setProperty("--rx", "0deg");
                e.currentTarget.style.setProperty("--ry", "0deg");
              }}
            >
              <div className="relative aspect-[4/5] w-full">
                {/* Brass paper tape */}
                <span
                  aria-hidden
                  className="tape-tilt absolute left-1/2 top-0 z-30 h-8 w-24 -translate-x-1/2 -translate-y-3"
                />

                {/* Primary plate */}
                <figure
                  className="glare-on-hover paper-card group relative h-full w-full overflow-hidden p-3 transition-transform duration-700 hover:rotate-0"
                  style={{
                    transform: "rotate(1.5deg) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))",
                    transformStyle: "preserve-3d",
                    transition: "transform 400ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden">
                    <HeroMedia />
                  </div>
                  <figcaption className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-between gap-3 font-mono-tight text-[10px] uppercase tracking-[0.28em]">
                    <span className="rounded-sm bg-ink/80 px-2 py-1 text-bone/90">
                      Field Record
                    </span>
                    <span className="rounded-sm bg-ink/80 px-2 py-1 text-brass tabular-nums">
                      {site.identity.city}
                    </span>
                  </figcaption>
                </figure>

                {secondaryHero() && <div aria-hidden className="paper-card float-bob absolute -bottom-10 -left-10 hidden h-48 w-40 overflow-hidden p-2 transition-transform duration-700 hover:rotate-0 md:block" style={{["--bob-rot" as never]:"-6deg"}} data-cursor="hover">
                  <img src={secondaryHero()} alt="" loading="lazy" className="h-[78%] w-full object-cover" />
                </div>}
                {/* Certified seal */}
                {site.trust.badges[0] && <div className="brass-pulse absolute -top-6 -right-6 z-40 grid h-28 w-28 place-items-center rounded-full border border-brass/30 bg-background">
                  <div className="slow-spin absolute inset-1 rounded-full border border-dashed border-brass/40" />
                  <div className="relative grid h-[88%] w-[88%] place-items-center rounded-full text-center">
                    <div>
                      <div className="font-mono-tight text-[8px] uppercase tracking-[0.18em] text-muted-foreground">{site.identity.businessName}</div>
                      <div className="font-display text-[11px] font-bold text-terracotta leading-tight tracking-tight">{site.trust.badges[0]?.label}</div>
                      <div className="font-mono-tight text-[8px] uppercase tracking-[0.18em] text-muted-foreground">{site.trust.badges[0]?.sublabel}</div>
                    </div>
                  </div>
                </div>}
              </div>
            </div>
          </Reveal>
        </div>

        {/* Unified stats rail */}
        {proofStats().length > 0 && <Reveal delay={360}>
          <ul className="mt-20 grid grid-cols-2 gap-x-10 gap-y-8 border-t border-border pt-10 sm:grid-cols-4 md:mt-24">
            {proofStats().map(({ n, t }) => (
              <li key={t} className="group">
                <div className="font-display text-3xl text-bone transition-colors group-hover:text-brass md:text-4xl">
                  {typeof n === "number" ? <CountUp to={n} /> : <span className="inline-block transition-transform group-hover:scale-110">{n}</span>}
                </div>
                <div className="mt-2 font-mono-tight text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{t}</div>
              </li>
            ))}
          </ul>
        </Reveal>}
      </div>

      <ReportRuler />
    </section>
  );
}

function ServiceTicket() {
  const [service, setService] = useState(site.services[0].name);
  const [urgency, setUrgency] = useState("This week");
  const services = site.services.map(s=>s.name);
  const urgencies = ["Today", "This week", "Flexible"];

  return (
    <div className="relative rounded-2xl border border-border bg-graphite/80 p-7 shadow-2xl shadow-ink/60 backdrop-blur-xl">
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-brass/30 via-transparent to-transparent opacity-60" />
      <div className="relative">
        <div className="flex items-center justify-between font-mono-tight text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          <span className="text-brass">Service Ticket</span>
          <span className="tabular-nums">Draft</span>
        </div>
        <p className="font-display mt-3 text-2xl text-bone">Prepare a service inquiry.</p>

        <form
          onSubmit={event => {event.preventDefault(); const values = new FormData(event.currentTarget); window.location.href = "mailto:" + site.identity.email + "?subject=" + encodeURIComponent(service) + "&body=" + encodeURIComponent(Array.from(values.entries()).map(([key,value])=>key+": "+value).join("\n"));}}
          method="post"
          encType="text/plain"
          className="mt-6 space-y-5"
        >
          <Field label="Service">
            <div className="flex flex-wrap gap-2">
              {services.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setService(s)}
                  data-cursor="hover"
                  className={`rounded-full border px-3 py-1.5 font-mono-tight text-[10px] uppercase tracking-[0.18em] transition-all ${
                    service === s
                      ? "border-brass bg-brass text-ink"
                      : "border-border bg-transparent text-muted-foreground hover:border-brass/60 hover:text-bone"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input type="hidden" name="service" value={service} />
          </Field>

          <Field label="Urgency">
            <div className="flex gap-2">
              {urgencies.map((u) => (
                <button
                  type="button"
                  key={u}
                  onClick={() => setUrgency(u)}
                  data-cursor="hover"
                  className={`flex-1 rounded-md border px-3 py-2 font-mono-tight text-[10px] uppercase tracking-[0.18em] transition-all ${
                    urgency === u
                      ? "border-brass bg-brass/10 text-brass"
                      : "border-border text-muted-foreground hover:border-brass/60 hover:text-bone"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            <input type="hidden" name="urgency" value={urgency} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                name="name"
                required
                className="w-full rounded-md border border-border bg-ink/40 px-3 py-2.5 font-sans text-sm text-bone outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brass"
                placeholder="Jane Owner"
              />
            </Field>
            <Field label="ZIP">
              <input
                name="zip"
                required
                inputMode="numeric"
                pattern="[0-9]{5}"
                className="w-full rounded-md border border-border bg-ink/40 px-3 py-2.5 font-mono-tight text-sm text-bone outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brass"
                placeholder="ZIP code"
              />
            </Field>
          </div>

          <Field label="Phone">
            <input
              name="phone"
              required
              type="tel"
              className="w-full rounded-md border border-border bg-ink/40 px-3 py-2.5 font-mono-tight text-sm text-bone outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brass"
              placeholder="Your phone number"
            />
          </Field>

          <button
            type="submit"
            data-cursor="hover"
            className="group flex w-full items-center justify-between rounded-md bg-brass px-5 py-3.5 font-mono-tight text-xs uppercase tracking-[0.22em] text-ink transition-all hover:bg-brass-deep hover:text-bone"
          >
            <span>Open email draft</span>
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>

          <p className="text-center font-mono-tight text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Opens your email app · You review and send
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono-tight text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/* =================================================================== */
/*  MARQUEE                                                              */
/* =================================================================== */

function Marquee() {
  const words = site.services.map(s=>s.name);
  const set = [...words, ...words];
  return (
    <section
      aria-hidden
      className="relative overflow-hidden border-y border-border/70 bg-ink py-6 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
    >
      <div className="marquee">
        {set.map((w, i) => (
          <span
            key={i}
            className="font-display flex items-center gap-10 whitespace-nowrap pl-10 text-3xl text-muted-foreground md:text-5xl"
          >
            {w}
            <span className="h-1.5 w-1.5 rounded-full bg-brass" />
          </span>
        ))}
      </div>
    </section>
  );
}

/* =================================================================== */
/*  SERVICES                                                             */
/* =================================================================== */

function Services() {
 const SERVICES = site.services.map((s,i)=>({n:String(i+1).padStart(2,"0"),name:s.name,blurb:s.description,tags:[],img:"",href:s.href}));
  return (
    <section id="services" className="relative bg-background py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="01" label="Services" />
        <Reveal as="h2" className="font-display mt-6 max-w-4xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
          Services <span className="italic text-brass">for your property.</span>
        </Reveal>
        <Reveal as="p" delay={120} className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
          {site.content.serviceIntro}
        </Reveal>

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s, i) => (
            <Reveal key={s.name} delay={i * 80} className="contents">
              <ServiceCard {...s} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceCard({
  n,
  name,
  blurb,
  tags,
  img, href,
}: {
  n: string;
  name: string;
  blurb: string;
  tags: string[];
  img: string; href:string;
}) {
  return (
    <a
      href={href || "#contact"}
      data-cursor="hover"
      className="group relative flex flex-col overflow-hidden bg-background p-8 transition-colors duration-500 hover:bg-graphite md:p-10"
    >
      <div className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-700 group-hover:opacity-60">
        {img && <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/20" />
      </div>

      <div className="flex items-baseline justify-between font-mono-tight text-[11px] uppercase tracking-[0.3em] text-brass">
        <span>{n}</span>
        <span className="text-muted-foreground transition-colors group-hover:text-brass">↗</span>
      </div>

      <h3 className="font-display mt-10 text-3xl text-bone md:text-4xl">{name}</h3>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground md:text-base">{blurb}</p>

      <ul className="mt-10 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li
            key={t}
            className="rounded-full border border-border bg-ink/40 px-3 py-1 font-mono-tight text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors group-hover:border-brass/50 group-hover:text-bone"
          >
            {t}
          </li>
        ))}
      </ul>

      <div className="mt-12 flex items-center gap-3 font-mono-tight text-[11px] uppercase tracking-[0.22em] text-bone">
        <span className="h-px w-6 bg-brass transition-all duration-500 group-hover:w-12" />
        Plan this
      </div>
    </a>
  );
}

/* =================================================================== */
/*  WHY                                                                  */
/* =================================================================== */

function Why() {
 const WHY = site.content.values.map((x,i)=>({...x,n:String(i+1).padStart(2,"0")}));
  return (
    <section className="relative overflow-hidden bg-graphite py-28 md:py-40">
      <div className="absolute inset-0 -z-10 opacity-30">
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-brass/20 blur-3xl" />
        <div className="absolute -right-32 bottom-1/4 h-96 w-96 rounded-full bg-terracotta/20 blur-3xl" />
      </div>
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="02" label="About" />
        <Reveal as="h2" className="font-display mt-6 max-w-4xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
          {site.content.whyHeadline || site.identity.businessName}
        </Reveal>

        <Reveal as="p" className="mt-6 max-w-2xl whitespace-pre-line text-muted-foreground">{plan.content?.about || site.content.about}</Reveal>
        <div className="mt-20 grid gap-12 md:grid-cols-3">
          {WHY.map((w, i) => (
            <Reveal key={w.n} delay={i * 120}>
              <div className="font-mono-tight text-xs uppercase tracking-[0.3em] text-brass">{w.n}</div>
              <h3 className="font-display mt-6 text-3xl text-bone md:text-4xl">{w.title}</h3>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{w.body}</p>
            </Reveal>
          ))}
        </div>


      </div>
    </section>
  );
}

/* =================================================================== */
/*  WORK                                                                 */
/* =================================================================== */

const FILTERS = ["All", "Gallery"] as const;
type Filter = (typeof FILTERS)[number];

function Work() {
  const [filter, setFilter] = useState<Filter>("All");
  const work = gallery();
  const items = filter === "All" ? work : work.filter((w) => w.category === filter);

  return (
    <section id="work" className="relative bg-background py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <SectionLabel index="03" label="Gallery" />
            <Reveal as="h2" className="font-display mt-6 max-w-3xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
              Project <span className="italic text-brass">gallery.</span>
            </Reveal>
          </div>
          <Reveal delay={200} className="flex gap-1 rounded-full border border-border bg-graphite p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-cursor="hover"
                className={`rounded-full px-4 py-2 font-mono-tight text-[10px] uppercase tracking-[0.22em] transition-all ${
                  filter === f ? "bg-brass text-ink" : "text-muted-foreground hover:text-bone"
                }`}
              >
                {f}
              </button>
            ))}
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-12 gap-4">
          {items.map((w, i) => (
            <WorkTile key={w.url} item={w} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkTile({ item, index }: { item: WorkItem; index: number }) {
  // Asymmetric mosaic spans
  const spans = [
    "col-span-12 md:col-span-7 row-span-2 h-[480px]",
    "col-span-12 md:col-span-5 h-[230px]",
    "col-span-12 md:col-span-5 h-[230px]",
    "col-span-6 md:col-span-4 h-[280px]",
    "col-span-6 md:col-span-4 h-[280px]",
    "col-span-12 md:col-span-4 h-[280px]",
  ];
  const span = spans[index % spans.length];

  return (
    <Reveal delay={(index % 6) * 60} className={span}>
      <figure
        className="group relative h-full w-full overflow-hidden rounded-xl border border-border bg-graphite transition-all duration-500 hover:border-brass/60 hover:shadow-[0_30px_60px_-25px_oklch(0.62_0.14_60/0.5)]"
        data-cursor="hover"
      >
        <img
          src={item.url}
          alt={item.alt}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent opacity-90 transition-opacity duration-500 group-hover:opacity-100" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-brass transition-transform duration-700 group-hover:scale-x-100" />
        <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-6">
          <div>
            <span className="font-mono-tight text-[10px] uppercase tracking-[0.3em] text-brass">
              {item.category}
            </span>
            <p className="font-display mt-2 translate-y-1 text-lg text-bone opacity-90 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 md:text-xl">{item.caption}</p>
          </div>
          <span className="font-mono-tight text-[10px] tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
        </figcaption>
      </figure>
    </Reveal>
  );
}

/* =================================================================== */
/*  PROCESS                                                              */
/* =================================================================== */

const STEPS: {n:string;title:string;body:string}[] = [];

function Process() {
  return (
    <section id="process" className="relative bg-graphite py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="04" label="Process" />
        <Reveal as="h2" className="font-display mt-6 max-w-3xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
          Our <span className="italic text-brass">process.</span>
        </Reveal>

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="h-full bg-background p-10 md:p-12">
                <div className="font-display text-[4.2rem] leading-none tracking-tighter text-brass/40 md:text-[5.6rem]">
                  {s.n}
                </div>
                <h3 className="font-display mt-4 text-3xl text-bone transition-colors duration-500 hover:text-brass md:text-4xl">{s.title}</h3>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =================================================================== */
/*  AREA                                                                 */
/* =================================================================== */



function Area() {
 const CITIES = site.trust.areas;
  return (
    <section id="area" className="relative bg-background py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="05" label="Service Area" />
        <div className="mt-6">
          <Reveal as="h2" className="font-display max-w-3xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
            Service <span className="italic text-brass">area.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
            {plan.content?.["service-area"] || CITIES.join(" · ")}
          </Reveal>
          <ul className="mt-12 grid grid-cols-2 gap-x-12 gap-y-4 md:grid-cols-3 lg:grid-cols-6">
            {CITIES.map((c, i) => (
              <Reveal key={c} delay={i * 60}>
                <li className="flex items-center gap-3 border-b border-border pb-3 font-display text-xl text-bone md:text-2xl">
                  <span className="font-mono-tight text-[10px] tabular-nums text-brass">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {c}
                </li>
              </Reveal>
            ))}
          </ul>

          {site.trust.mapUrl && <Reveal delay={200}>
            <div className="relative mt-16 w-full overflow-hidden rounded-2xl border border-border bg-graphite grid place-items-center" style={{height:"375px"}}>
              <a href={site.trust.mapUrl} target="_blank" rel="noopener noreferrer" className="font-mono-tight text-brass">View map and directions ↗</a>
            </div>
          </Reveal>}
        </div>
      </div>
    </section>
  );
}

/* =================================================================== */
/*  FAQ                                                                  */
/* =================================================================== */

function Faq() {
 const FAQ = site.content.faqs;
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="relative bg-graphite py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="06" label="FAQ" />
        <Reveal as="h2" className="font-display mt-6 max-w-3xl text-4xl leading-tight text-bone md:text-6xl lg:text-7xl">
          Common <span className="italic text-brass">questions.</span>
        </Reveal>

        <div className="mt-16 divide-y divide-border border-y border-border">
          {FAQ.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  data-cursor="hover"
                  className="flex w-full items-center justify-between gap-8 py-6 text-left transition-colors hover:text-brass"
                >
                  <span className="flex items-baseline gap-6">
                    <span className="font-mono-tight text-xs tabular-nums text-brass">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-display text-xl text-bone md:text-3xl">{f.q}</span>
                  </span>
                  <span
                    className={`font-display text-2xl text-brass transition-transform duration-500 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                <div
                  className="grid overflow-hidden transition-[grid-template-rows] duration-500 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <p className="max-w-2xl pb-8 pl-12 text-base leading-relaxed text-muted-foreground md:text-lg">
                      {f.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* =================================================================== */
/*  CONTACT                                                              */
/* =================================================================== */

function Contact() {
  return (
    <section id="contact" className="relative overflow-hidden bg-background py-28 md:py-40">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <SectionLabel index="07" label="Contact" />
        <Reveal as="h2" className="font-display mt-6 max-w-4xl text-[2.55rem] leading-[0.98] text-bone md:text-[3.15rem] lg:text-[5.6rem]">
          {site.content.ctaHeadline || "Contact"}
        </Reveal>
        {site.content.ctaBody && <Reveal as="p" className="mt-6 max-w-2xl text-muted-foreground">{site.content.ctaBody}</Reveal>}

        <div className="mt-20 grid gap-16 lg:grid-cols-[1fr,1.2fr]">
          <div className="space-y-10">
            <ContactRow label="Call">
              <a href={site.identity.phoneTel} data-cursor="hover" className="block hover:text-brass">
                {site.identity.phoneDisplay}
              </a>
            </ContactRow>
            {site.identity.email && <ContactRow label="Email">
              <a
                href={"mailto:" + site.identity.email}
                data-cursor="hover"
                className="block break-all hover:text-brass"
              >
                {site.identity.email}
              </a>
            </ContactRow>}
            <ContactRow label="Service Area">
              {site.identity.city}, {site.identity.state}
              <br />
              <span className="text-muted-foreground">{site.trust.areas.join(" · ")}</span>
            </ContactRow>
            {hoursText() && <ContactRow label="Hours">{hoursText()}</ContactRow>}
          </div>

          <Reveal delay={200}>
            {site.trust.bookingUrl && <a href={site.trust.bookingUrl} className="mb-6 inline-block rounded-full border border-brass px-6 py-3 font-mono-tight text-brass">Book a service ↗</a>}
            {site.identity.email ? <ServiceTicket /> : <a href={site.identity.phoneTel}>Call {site.identity.phoneDisplay}</a>}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ContactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-6">
      <div className="font-mono-tight text-[10px] uppercase tracking-[0.3em] text-brass">{label}</div>
      <div className="font-display mt-3 text-2xl text-bone md:text-3xl">{children}</div>
    </div>
  );
}

/* =================================================================== */
/*  FOOTER                                                               */
/* =================================================================== */

function Footer() {
  return (
    <footer className="dark border-t border-border bg-ink py-16 text-bone">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 md:px-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <a href="/#top" className="flex items-center gap-3" data-cursor="hover">
            <span className="grid h-[72px] w-[72px] place-items-center rounded-xl border border-border bg-graphite">
              <img src={site.identity.logoOnDark} alt="" className="h-[60px] w-[60px] object-contain" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-2xl tracking-tight text-bone">
                {site.identity.businessName}
              </span>
              <span className="font-mono-tight text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {site.identity.city}, {site.identity.state}
              </span>
            </span>
          </a>
        </div>

        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-3">
          <FooterCol title="Service Area">
            <p>{site.identity.city}, {site.identity.state}</p>
            <p>{site.trust.areas.join(" · ")}</p>
          </FooterCol>
          <FooterCol title="Reach">
            <a href={site.identity.phoneTel} className="block hover:text-brass" data-cursor="hover">
              {site.identity.phoneDisplay}
            </a>
            {site.identity.email && <a
              href={"mailto:" + site.identity.email}
              className="block break-all hover:text-brass"
              data-cursor="hover"
            >
              {site.identity.email}
            </a>}
            {site.trust.socials.map((url,i)=><a key={url} href={url} className="block hover:text-brass" rel="noopener noreferrer">Social profile {i+1} ↗</a>)}
          </FooterCol>
          {site.trust.aggregate && <FooterCol title="Reviews"><a href={site.trust.aggregate.sourceUrl}>View review source ↗</a></FooterCol>}
        </div>
      </div>

      <div className="mx-auto mt-16 flex max-w-[1440px] flex-col gap-3 border-t border-border px-6 pt-6 font-mono-tight text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:flex-row md:items-center md:justify-between md:px-10">
        <span>© {new Date().getFullYear()} {site.identity.businessName}</span>
        <span>{site.identity.city}, {site.identity.state}</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono-tight text-[10px] uppercase tracking-[0.3em] text-brass">{title}</div>
      <div className="mt-3 space-y-1 text-sm text-bone/80">{children}</div>
    </div>
  );
}

/* =================================================================== */
/*  HELPERS                                                              */
/* =================================================================== */

function SectionLabel({ index, label }: { index: string; label: string }) {
  return (
    <Reveal>
      <div className="flex items-center gap-4 font-mono-tight text-[11px] uppercase tracking-[0.32em] text-brass">
        <span className="tabular-nums">{index}</span>
        <span className="h-px w-12 bg-brass" />
        <span>{label}</span>
      </div>
    </Reveal>
  );
}

function proofStats() {
 const result:{n:number|string;t:string}[]=[];
 if(site.identity.founded !== null) result.push({n:String(site.identity.founded),t:"Founded"});
 if(site.trust.aggregate?.rating != null && site.trust.aggregate.count != null) result.push({n:String(site.trust.aggregate.rating),t:"Rating"},{n:site.trust.aggregate.count,t:"Reviews"});
 return result;
}
export function HeroMedia() {
 const [motion,setMotion]=useState(false);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setMotion(!q.matches);change();q.addEventListener('change',change);return()=>q.removeEventListener('change',change);},[]);
 return site.hero.video && motion && !failed ? <video src={site.hero.video} poster={site.hero.poster} autoPlay muted loop playsInline onError={()=>setFailed(true)} className="h-full w-full object-cover"/> : <img src={site.hero.poster} alt="" className="hero-drift h-full w-full object-cover"/>;
}
function DetailPage({path}:{path:string}) {
 const clean=path.replace(/\/$/,'');
 const service=site.services.find(s=>s.href===clean);
 const key=clean.slice(1);
 const copy=pageCopy(key);
 const title=service?.name || plan.pages?.find(p=>p.slug.replace(/^\/+|\/+$/g,'')===key)?.title || key;
 return <div style={brandStyle()} className="grain min-h-screen bg-background text-foreground"><Nav/><main className="mx-auto max-w-[1440px] px-6 pt-40 pb-28 md:px-10"><a href="/" className="font-mono-tight text-brass">← Home</a><Reveal as="h1" className="font-display mt-8 text-5xl text-bone">{service || copy ? title : 'Page not found'}</Reveal><p className="mt-8 max-w-3xl whitespace-pre-line text-lg text-muted-foreground">{service?.description || copy || ''}</p><a className="mt-10 inline-block text-brass" href={site.identity.phoneTel}>{site.identity.phoneDisplay}</a></main><Footer/></div>;
}
