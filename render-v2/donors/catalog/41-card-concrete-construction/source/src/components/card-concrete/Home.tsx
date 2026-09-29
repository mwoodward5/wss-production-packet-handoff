import { useEffect, useState } from "react";
import {
  Phone,
  ArrowUpRight,
  Menu,
  X,
  MapPin,
  Clock,
  Mail,
  ChevronDown,
  Plus,
  Minus,
} from "lucide-react";
import { useDonor } from "./data";
import { HeroMedia } from "../../wss/HeroMedia";
import { Reveal } from "./Reveal";

/* ─────────────────────────  NAV  ───────────────────────── */

const ALL_NAV_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#work", label: "Work" },
  { href: "#process", label: "About" },
  { href: "#area", label: "Service area" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

function Nav() {
  const {style, NAME, LOCATION, PHONE, PHONE_TEL, IMG, GALLERY, FAQ}=useDonor();
  const NAV_LINKS=ALL_NAV_LINKS.filter(l=>l.href!=="#work"||GALLERY.length).filter(l=>l.href!=="#faq"||FAQ.length);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "glass-panel backdrop-saturate-150"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-5 sm:h-24 sm:px-8">
        <a href="#top" className="flex items-center gap-4 group">
          <span
            className="relative grid h-14 w-14 sm:h-[72px] sm:w-[72px] place-items-center rounded-sm bg-bone ring-1 ring-bone/40 transition-all duration-500 group-hover:ring-amber group-hover:ring-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_30px_-10px_color-mix(in_oklab,var(--amber)_35%,transparent)]"
          >
            <img
              src={IMG.logo}
              alt={NAME}
              width={72}
              height={72}
              className="h-[88%] w-[88%] object-contain"
              loading="eager"
              decoding="async"
            />
            <span className="pointer-events-none absolute inset-0 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-500 ring-1 ring-amber/60 shadow-[0_0_30px_-2px_color-mix(in_oklab,var(--amber)_60%,transparent)]" />
          </span>
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="font-display text-xl text-bone tracking-tight">{NAME}</span>
            <span className="font-mono-spec text-cement-soft">{LOCATION}</span>
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono-spec text-cement hover:text-bone transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href={`tel:${PHONE_TEL}`}
          className="hidden lg:inline-flex items-center gap-2 rounded-full bg-amber px-5 py-2.5 text-ink font-medium text-sm hover:bg-amber-soft transition-colors"
        >
          <Phone className="h-4 w-4" />
          {PHONE}
        </a>

        <button
          onClick={() => setOpen(true)}
          className="lg:hidden grid h-10 w-10 place-items-center rounded-full hairline border text-bone"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/95 backdrop-blur-2xl lg:hidden animate-in fade-in duration-300">
          <div className="flex h-full flex-col p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono-spec text-cement-soft">MENU</span>
              <button
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full hairline border text-bone"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="mt-12 flex flex-col gap-2">
              {NAV_LINKS.map((l, i) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="font-display text-5xl text-bone py-2 border-b hairline"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <a
              href={`tel:${PHONE_TEL}`}
              onClick={() => setOpen(false)}
              className="mt-auto inline-flex items-center justify-between gap-3 rounded-full bg-amber px-6 py-4 text-ink font-medium"
            >
              <span className="font-mono-spec text-xs">DISPATCH</span>
              <span className="font-display text-2xl">{PHONE}</span>
              <Phone className="h-5 w-5" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────  HERO  ───────────────────────── */

function Hero() {
  const {client, coords, LOCATION, PHONE, PHONE_TEL}=useDonor();
  return (
    <section id="top" className="relative isolate min-h-[100svh] overflow-hidden grain">
      {/* Background image */}
      <div className="absolute inset-0 -z-10">
        <HeroMedia hero={client.hero} />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/35 to-ink" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/20 to-transparent" />
        <div className="absolute inset-0 hero-glow opacity-70" />
      </div>

      {/* spec rails */}
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden md:flex flex-col justify-between py-32 font-mono-spec text-[10px] text-cement-soft/60">
        <span>{coords}</span>
        <span>{LOCATION}</span>
        <span></span>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-6 hidden md:flex flex-col justify-between py-32 font-mono-spec text-[10px] text-cement-soft/60 text-right">
        <span>SHEET · A-01</span>
        <span></span>
        <span></span>
      </div>

      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 pt-36 sm:pt-44 pb-24">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full glass-light px-3 py-1.5">
            <span className="relative grid h-2 w-2 place-items-center">
              <span className="absolute inset-0 rounded-full bg-amber animate-ping" />
              <span className="h-2 w-2 rounded-full bg-amber" />
            </span>
            <span className="font-mono-spec text-bone">
              {client.hero.eyebrow}
            </span>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <h1 className="mt-8 font-display text-[clamp(2.8rem,8.4vw,8rem)] leading-[0.88] tracking-[-0.025em] text-bone max-w-[16ch] drop-shadow-[0_2px_30px_rgba(0,0,0,0.45)]">
            {client.hero.line1}
            <br />
            <span className="italic text-cement">{client.hero.emphasis}</span>
            <br />

            <span className="italic text-amber [text-shadow:0_0_60px_color-mix(in_oklab,var(--amber)_45%,transparent)]">
              {client.hero.line3}
            </span>
          </h1>
        </Reveal>

        <Reveal delay={260}>
          <p className="mt-10 max-w-xl text-lg leading-relaxed text-cement">
            {client.hero.support}
          </p>
        </Reveal>

        <Reveal delay={380}>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <a
              href="#contact"
              className="shine-on-hover group inline-flex items-center gap-3 rounded-full bg-bone pl-7 pr-2 py-2.5 text-ink font-medium hover:bg-amber transition-colors shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_30px_60px_-25px_color-mix(in_oklab,var(--amber)_55%,transparent)]"
            >
              Discuss your project
              <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-bone group-hover:rotate-45 transition-transform duration-500">
                <ArrowUpRight className="h-5 w-5" />
              </span>
            </a>
            <a
              href={`tel:${PHONE_TEL}`}
              className="font-mono-spec text-cement hover:text-bone underline underline-offset-4"
            >
              Or call dispatch · {PHONE}
            </a>
          </div>
        </Reveal>

        {client.trust.badges.length > 0 && <Reveal delay={520}>
          <dl className="mt-20 grid max-w-2xl grid-cols-3 gap-6 sm:gap-10 border-t hairline pt-8">
            {client.trust.badges.map(b=><div key={b.label}><dd className="font-display text-2xl text-bone">{b.label}</dd></div>)}
          </dl>
        </Reveal>}
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <span className="font-mono-spec text-cement-soft tracking-[0.24em]">Scroll</span>
        <span className="block h-10 w-px bg-bone/60 scroll-stem" />
      </div>
    </section>
  );
}

/* ─────────────────────────  MARQUEE  ───────────────────────── */

function Marquee() {
  const {SERVICES}=useDonor();
  const items = SERVICES.map(s=>s.title);
  const loop = [...items, ...items];
  return (
    <div className="relative border-y hairline overflow-hidden bg-ink py-6">
      <div className="flex marquee whitespace-nowrap gap-12">
        {loop.map((t, i) => (
          <span key={i} className="font-display text-3xl sm:text-5xl text-bone/90 flex items-center gap-12">
            {t}
            <span className="text-amber">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  SERVICES  ───────────────────────── */

function Services() {
  const {client, NAME, SERVICES}=useDonor();
  return (
    <section id="services" className="relative py-24 sm:py-32 grain">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="grid md:grid-cols-12 gap-8 mb-16">
          <div className="md:col-span-3">
            <span className="font-mono-spec text-amber">§ 01 · CAPABILITIES</span>
          </div>
          <div className="md:col-span-9">
            <Reveal as="h2" className="font-display text-4xl sm:text-6xl lg:text-7xl text-bone leading-[1.02] tracking-tight">
              Services.
              <br />
              <span className="italic text-cement">{NAME}</span>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-6 max-w-2xl text-lg text-cement">
                {client.content.serviceIntro}
              </p>
            </Reveal>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SERVICES.map((s, i) => (
            <Reveal key={s.code} delay={(i % 3) * 100}>
              <article className="group relative h-full overflow-hidden rounded-sm bg-card border hairline transition-all duration-700 hover:border-amber/60">
                <div className="relative aspect-[5/4] overflow-hidden">
                  {s.image && <img
                    src={s.image}
                    alt={s.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-110"
                  />}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
                  <div className="absolute top-4 left-4 right-4 flex items-start justify-between">
                    <span className="font-mono-spec rounded-sm bg-ink/70 backdrop-blur px-2 py-1 text-amber">
                      {s.code}
                    </span>
                    <ArrowUpRight className="h-5 w-5 text-bone/70 transition-transform duration-500 group-hover:rotate-45 group-hover:text-amber" />
                  </div>

                  {/* corner brackets */}
                  <CornerBrackets />
                </div>

                <div className="p-6 sm:p-7">
                  <p className="font-mono-spec text-cement-soft">{s.use}</p>
                  <h3 className="mt-3 font-display text-3xl text-bone">{s.href ? <a href={s.href}>{s.title}</a> : s.title}</h3>
                  <p className="mt-2 text-cement">{s.tag}</p>
                  <p className="mt-4 text-sm text-cement-soft leading-relaxed">
                    {s.blurb}
                  </p>

                  {s.specs.length > 0 && <dl className="mt-6 grid grid-cols-3 gap-3 border-t hairline pt-4">
                    {s.specs.map((sp) => (
                      <div key={sp.k}>
                        <dt className="font-mono-spec text-cement-soft text-[10px]">{sp.k}</dt>
                        <dd className="mt-1 text-bone text-sm font-medium">{sp.v}</dd>
                      </div>
                    ))}
                  </dl>}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CornerBrackets() {
  return (
    <>
      {(["top-3 left-3", "top-3 right-3", "bottom-3 left-3", "bottom-3 right-3"] as const).map(
        (pos) => (
          <span
            key={pos}
            className={`pointer-events-none absolute h-4 w-4 border-amber opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${pos} ${
              pos.includes("top") ? "border-t-2" : "border-b-2"
            } ${pos.includes("left") ? "border-l-2" : "border-r-2"}`}
          />
        ),
      )}
    </>
  );
}

/* ─────────────────────────  GALLERY  ───────────────────────── */

function Reviews() {
  const {client}=useDonor();
  if (!client.trust.reviews.length) return null;
  return <section aria-label="Client reviews" className="relative py-24 sm:py-32 grain">
    <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
      <span className="font-mono-spec text-amber">CLIENT REVIEWS</span>
      <div className="mt-8 grid md:grid-cols-2 gap-5">
        {client.trust.reviews.map((review,i)=><figure key={i} className="glass-panel rounded-sm p-6 sm:p-8">
          {review.rating !== null && <p className="font-mono-spec text-amber">{review.rating} / 5</p>}
          <blockquote className="mt-4 font-display text-2xl text-bone whitespace-pre-line">{review.text}</blockquote>
          <figcaption className="mt-6 font-mono-spec text-cement"><a href={review.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">{review.author} · Source</a></figcaption>
        </figure>)}
      </div>
    </div>
  </section>;
}

function Gallery() {
  const {style, NAME, PROCESS, GALLERY}=useDonor();
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? 0 : (i + 1) % GALLERY.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? 0 : (i - 1 + GALLERY.length) % GALLERY.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <section id="work" className="relative py-24 sm:py-32 bg-card/40">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="grid md:grid-cols-12 gap-8 mb-12">
          <div className="md:col-span-3">
            <span className="font-mono-spec text-amber">§ 02 · RECENT WORK</span>
          </div>
          <div className="md:col-span-9">
            <Reveal as="h2" className="font-display text-4xl sm:text-6xl lg:text-7xl text-bone leading-[1.02] tracking-tight">
              From the jobsite.
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-6 max-w-2xl text-lg text-cement">
                {NAME}
              </p>
            </Reveal>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4 auto-rows-auto">
          {GALLERY.map((g, i) => (
            <Reveal key={i} delay={(i % 4) * 80} className={g.span}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="group relative block h-full w-full overflow-hidden rounded-sm bg-ink"
              >
                <img
                  src={g.src}
                  alt={g.caption}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity" />
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <span className="font-mono-spec text-bone/90 text-left">{g.caption}</span>
                  <span className="grid h-8 w-8 place-items-center rounded-full glass-panel text-bone opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      {open !== null && (
        <div
          className="fixed inset-0 z-[60] bg-ink/95 backdrop-blur-xl flex items-center justify-center p-4 sm:p-10 animate-in fade-in"
          onClick={() => setOpen(null)}
        >
          <button
            onClick={() => setOpen(null)}
            className="absolute top-5 right-5 grid h-12 w-12 place-items-center rounded-full glass-panel text-bone"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <figure
            className="max-h-[88vh] max-w-[1400px]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={GALLERY[open].src}
              alt={GALLERY[open].caption}
              className="max-h-[80vh] w-auto rounded-sm object-contain"
            />
            <figcaption className="mt-4 font-mono-spec text-cement text-center">
              {GALLERY[open].caption}
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────  PROCESS  ───────────────────────── */

function Process() {
  const {client, COPY, NAME, PROCESS}=useDonor();
  return (
    <section id="process" className="relative py-24 sm:py-32 grain">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="grid md:grid-cols-12 gap-8 mb-16">
          <div className="md:col-span-3">
            <span className="font-mono-spec text-amber">§ 03 · ABOUT</span>
          </div>
          <div className="md:col-span-9">
            <Reveal as="h2" className="font-display text-4xl sm:text-6xl lg:text-7xl text-bone leading-[1.02] tracking-tight">
              {client.content.whyHeadline || NAME}
              <br />
              <span className="italic text-cement"></span>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-6 max-w-2xl text-lg text-cement">
                {COPY.about}
              </p>
            </Reveal>
          </div>
        </div>

        <div className="relative grid lg:grid-cols-12 gap-8">
          {/* concrete column */}
          <div className="hidden lg:block lg:col-span-1 relative">
            <div className="sticky top-32 mx-auto h-[60vh] w-3 rounded-full bg-gradient-to-b from-amber via-cement to-rebar/50 opacity-80" />
          </div>

          <ol className="lg:col-span-11 space-y-5">
            {PROCESS.map((p, i) => (
              <Reveal key={p.id} delay={i * 80}>
                <li className="group grid sm:grid-cols-12 gap-6 rounded-sm border hairline bg-card/60 p-6 sm:p-10 hover:border-amber/50 transition-colors">
                  <div className="sm:col-span-3 flex sm:flex-col items-start gap-4 sm:gap-2">
                    <span className="font-mono-spec text-amber">{p.id}</span>
                    <span className="font-mono-spec text-cement-soft">{p.stage}</span>
                    <span className="ml-auto sm:ml-0 font-display text-cement text-2xl">
                      {p.label}
                    </span>
                  </div>
                  <div className="sm:col-span-9">
                    <h3 className="font-display text-3xl sm:text-5xl text-bone">
                      {p.title}
                    </h3>
                    <p className="mt-4 text-cement text-lg leading-relaxed max-w-2xl">
                      {p.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          {client.trust.badges.map(b=>b.label).map((b) => (
            <span
              key={b}
              className="font-mono-spec rounded-full glass-light px-4 py-2 text-bone"
            >
              ✓ {b}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  SERVICE AREA  ───────────────────────── */

function ServiceArea() {
  const {COPY, coords, LOCATION, PHONE, PHONE_TEL, ADDRESS_LINE2, HOURS, MAPS_URL, TOWNS}=useDonor();
  return (
    <section id="area" className="relative py-24 sm:py-32 bg-card/30 overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-6">
          <span className="font-mono-spec text-amber">§ 04 · SERVICE AREA</span>
          <Reveal as="h2" className="mt-4 font-display text-4xl sm:text-6xl lg:text-7xl text-bone leading-[1.02] tracking-tight">
            {LOCATION}
            <br />
            <span className="italic text-cement">Service area.</span>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 max-w-xl text-lg text-cement">
              {COPY.area || TOWNS.join(" · ")}
            </p>
          </Reveal>

          <Reveal delay={200}>
            <ul className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {TOWNS.map((t) => (
                <li key={t} className="flex items-center gap-2 text-bone">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                  <span className="font-display text-xl">{t}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={300}>
            <div className="mt-10 glass-panel rounded-sm p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <span className="font-mono-spec text-cement-soft">LOCATION</span>
                  
                  <p className="font-display text-2xl text-bone">{ADDRESS_LINE2}</p>
                </div>
                {coords && <div className="text-right">
                  <span className="font-mono-spec text-cement-soft">COORDINATES</span>
                  <p className="mt-3 font-mono text-bone text-sm">{coords}</p>
                  </div>}
              </div>
              <div className="mt-6 flex flex-wrap gap-3 border-t hairline pt-5">
                {MAPS_URL && <a
                  href={MAPS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-amber px-4 py-2 text-ink font-medium text-sm hover:bg-amber-soft"
                >
                  <MapPin className="h-4 w-4" /> Map & directions
                </a>}
                <a
                  href={`tel:${PHONE_TEL}`}
                  className="inline-flex items-center gap-2 rounded-full glass-light px-4 py-2 text-bone text-sm"
                >
                  <Phone className="h-4 w-4" /> {PHONE}
                </a>
              </div>
              {HOURS && <p className="mt-5 font-mono-spec text-cement-soft flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> {HOURS}
              </p>}
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-6 relative">
          <RadiusDiagram />
        </div>
      </div>
    </section>
  );
}

function RadiusDiagram() {
  const {style, FAQ}=useDonor();
  const rings = [1, 2, 3, 4];
  return (
    <div className="relative mx-auto aspect-square max-w-[560px]">
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="cg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="currentColor" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="400" height="400" fill="url(#grid)" className="text-bone/10" />
        <circle cx="200" cy="200" r="190" fill="url(#cg)" />
        {rings.map((r, i) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={40 + r * 35}
            fill="none"
            stroke="currentColor"
            strokeWidth={i === rings.length - 1 ? 1.5 : 0.6}
            strokeDasharray={i === rings.length - 1 ? "0" : "3 4"}
            className="text-bone/40"
          />
        ))}
        <text x="200" y="395" textAnchor="middle" className="fill-current text-amber" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
          SERVICE AREA · NOT TO SCALE
        </text>
      </svg>
    </div>
  );
}

/* ─────────────────────────  FAQ  ───────────────────────── */

function FAQSection() {
  const {PHONE, PHONE_TEL, FAQ}=useDonor();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative py-24 sm:py-32 grain">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <span className="font-mono-spec text-amber">§ 05 · COMMON QUESTIONS</span>
          <Reveal as="h2" className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl text-bone leading-[1.02] tracking-tight">
            Straight answers,
            <br />
            <span className="italic text-cement">no run-around.</span>
          </Reveal>
          <p className="mt-6 text-cement max-w-sm">
            Contact us with your question.
          </p>
          <a
            href={`tel:${PHONE_TEL}`}
            className="mt-6 inline-flex items-center gap-2 font-mono-spec text-bone underline underline-offset-4"
          >
            <Phone className="h-4 w-4" /> {PHONE}
          </a>
        </div>

        <div className="md:col-span-8">
          <ul className="divide-y hairline border-t border-b">
            {FAQ.map((f, i) => {
              const isOpen = open === i;
              return (
                <li key={f.q}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-start gap-6 py-6 text-left group"
                    aria-expanded={isOpen}
                  >
                    <span className="font-mono-spec text-amber mt-2 shrink-0">
                      Q-{String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 font-display text-xl sm:text-2xl text-bone group-hover:text-amber transition-colors">
                      {f.q}
                    </span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full hairline border text-bone">
                      {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>
                  <div
                    className={`grid transition-all duration-500 ${
                      isOpen ? "grid-rows-[1fr] opacity-100 pb-8" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="pl-16 pr-12 text-cement text-lg leading-relaxed">
                        {f.a}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  CONTACT  ───────────────────────── */

function Contact() {
  const {client, COPY, LOCATION, PHONE, PHONE_TEL, EMAIL, ADDRESS_LINE2, SERVICES}=useDonor();
  const [prepared, setPrepared] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPrepared(true);
  }

  return (
    <section id="contact" className="relative py-24 sm:py-32 bg-card/40">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5">
          <div className="flex items-center gap-2 font-mono-spec text-amber">
            <span className="h-2 w-2 rounded-full bg-amber animate-pulse" />
            PROJECT NOTES
          </div>
          <Reveal as="h2" className="mt-4 font-display text-4xl sm:text-6xl lg:text-7xl text-bone leading-[1.02] tracking-tight">
            {client.content.ctaHeadline || "Contact us."}
            <br />
            <span className="italic text-cement"></span>
          </Reveal>
          <p className="mt-6 text-lg text-cement max-w-md">
            {COPY.contact}
          </p>

          <div className="mt-10 space-y-4">
            <a href={`tel:${PHONE_TEL}`} className="flex items-center gap-4 group">
              <span className="grid h-12 w-12 place-items-center rounded-full glass-light text-amber group-hover:bg-amber group-hover:text-ink transition">
                <Phone className="h-5 w-5" />
              </span>
              <div>
                <span className="font-mono-spec text-cement-soft">DISPATCH</span>
                <p className="font-display text-2xl text-bone">{PHONE}</p>
              </div>
            </a>
            {EMAIL && <a href={`mailto:${EMAIL}`} className="flex items-center gap-4 group">
              <span className="grid h-12 w-12 place-items-center rounded-full glass-light text-amber group-hover:bg-amber group-hover:text-ink transition">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <span className="font-mono-spec text-cement-soft">EMAIL</span>
                <p className="font-display text-xl text-bone break-all">{EMAIL}</p>
              </div>
            </a>}
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-full glass-light text-amber">
                <MapPin className="h-5 w-5" />
              </span>
              <div>
                <span className="font-mono-spec text-cement-soft">LOCATION</span>
                
                <p className="font-display text-xl text-bone">{ADDRESS_LINE2}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <form
            onSubmit={onSubmit}
            className="glass-panel rounded-sm p-6 sm:p-10 grid sm:grid-cols-2 gap-5"
          >
            <Field label="01 · Name" name="name" required />
            <Field label="02 · Phone" name="phone" type="tel" required />
            <Field label="03 · Email" name="email" type="email" />
            <Field label="04 · ZIP" name="zip" />
            <div className="sm:col-span-2">
              <Label htmlFor="service">05 · Service</Label>
              <div className="relative">
                <select
                  id="service"
                  name="service"
                  className="appearance-none w-full bg-transparent border-b hairline border-b-cement/30 text-bone font-display text-xl pb-3 pt-2 focus:outline-none focus:border-amber"
                >
                  <option value="" className="bg-ink">Select…</option>
                  {SERVICES.map((s) => (
                    <option key={s.title} value={s.title} className="bg-ink">
                      {s.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-0 top-3 h-5 w-5 text-cement pointer-events-none" />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">06 · Scope & site notes</Label>
              <textarea
                id="notes"
                name="notes"
                rows={4}
                placeholder="Footprint, timing, site conditions, anything we should know…"
                className="w-full bg-transparent border hairline border-cement/30 rounded-sm text-bone p-3 focus:outline-none focus:border-amber placeholder:text-cement-soft/60"
              />
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 pt-4 border-t hairline">
              <p className="font-mono-spec text-cement-soft">
                {prepared ? "NOT SENT · CALL OR EMAIL TO SHARE YOUR NOTES" : "NOTES STAY IN THIS BROWSER · NO ONLINE DELIVERY"}
              </p>
              <button
                type="submit"
                className="group inline-flex items-center gap-3 rounded-full bg-amber pl-6 pr-2 py-2 text-ink font-medium hover:bg-bone transition-colors"
              >
                Review notes
                <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-bone group-hover:rotate-45 transition-transform duration-500">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block font-mono-spec text-cement-soft mb-2">{children}</label>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}{required && " *"}</Label>
      <input
        type={type}
        id={name}
        name={name}
        required={required}
        className="w-full bg-transparent border-b hairline border-b-cement/30 text-bone font-display text-xl pb-3 pt-2 focus:outline-none focus:border-amber placeholder:text-cement-soft"
      />
    </div>
  );
}

/* ─────────────────────────  FOOTER  ───────────────────────── */

function Footer() {
  const {client, NAME, LOCATION, PHONE, PHONE_TEL, EMAIL, ADDRESS_LINE2, IMG, GALLERY, FAQ}=useDonor();
  const NAV_LINKS=ALL_NAV_LINKS.filter(l=>l.href!=="#work"||GALLERY.length).filter(l=>l.href!=="#faq"||FAQ.length);
  return (
    <footer className="relative border-t hairline bg-ink py-16">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-sm bg-bone">
              <img src={IMG.logo} alt="" className="h-9 w-9 object-contain" />
            </span>
            <div className="leading-none">
              <p className="font-display text-xl text-bone">{NAME}</p>
              <p className="font-mono-spec text-cement-soft">{LOCATION}</p>
            </div>
          </div>
          <p className="mt-6 text-cement max-w-sm">
            {client.content.about}
          </p>
        </div>
        <div className="md:col-span-3">
          <span className="font-mono-spec text-cement-soft">CONTACT</span>
          <ul className="mt-4 space-y-2 text-bone">
            <li><a href={`tel:${PHONE_TEL}`} className="hover:text-amber">{PHONE}</a></li>
            {EMAIL && <li><a href={`mailto:${EMAIL}`} className="hover:text-amber break-all">{EMAIL}</a></li>}
            
            <li className="text-cement">{ADDRESS_LINE2}</li>
          </ul>
        </div>
        <div className="md:col-span-2">
          <span className="font-mono-spec text-cement-soft">SITEMAP</span>
          <ul className="mt-4 space-y-2 text-bone">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-amber">{l.label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <span className="font-mono-spec text-cement-soft">LEGAL</span>
          <ul className="mt-4 space-y-2 text-bone">
            <li><a href="/privacy" className="hover:text-amber">Privacy</a></li>
            <li><a href="/terms" className="hover:text-amber">Terms</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 mt-12 pt-6 border-t hairline flex flex-wrap items-center justify-between gap-4 font-mono-spec text-cement-soft">
        <span>© {new Date().getFullYear()} {NAME}</span>
        <span>{LOCATION}</span>
      </div>
    </footer>
  );
}

/* ─────────────────────────  MOBILE STICKY  ───────────────────────── */

function StickyCall() {
  const {style, PHONE, PHONE_TEL, FAQ, GALLERY}=useDonor();
  return (
    <a
      href={`tel:${PHONE_TEL}`}
      className="fixed bottom-4 left-4 right-4 z-40 lg:hidden flex items-center justify-between gap-3 rounded-full bg-amber px-5 py-3.5 text-ink font-medium shadow-2xl shadow-amber/30"
    >
      <span className="font-mono-spec text-xs">DISPATCH</span>
      <span className="font-display text-lg">{PHONE}</span>
      <Phone className="h-5 w-5" />
    </a>
  );
}

/* ─────────────────────────  PAGE  ───────────────────────── */

export function CardConcreteHome() {
  const {style, FAQ, GALLERY}=useDonor();
  return (
    <div style={style} className="bg-ink text-bone min-h-screen overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Services />
        <Reviews />
        {GALLERY.length > 0 && <Gallery />}
        <Process />
        <ServiceArea />
        {FAQ.length > 0 && <FAQSection />}
        <Contact />
      </main>
      <Footer />
      <StickyCall />
    </div>
  );
}
