import { createContext, useContext, useEffect, useState } from "react";
import type { Bridge } from "../wss/bridge";
const Context = createContext<Bridge | null>(null);
function useSite() {
  const value = useContext(Context);
  if (!value) throw Error("client_data_required");
  return value;
}
function Logo() {
  const { client: c } = useSite();
  return (
    <img
      src={c.identity.logoOnLight}
      alt={c.identity.businessName}
      className="h-9 w-9 rounded-sm object-contain"
    />
  );
}
function HeroMedia() {
  const { client: c } = useSite();
  const [motion, setMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return (
    <>
      <img src={c.hero.poster} alt="" className="h-full w-full object-cover" />
      {c.hero.video && motion && !failed && (
        <video
          src={c.hero.video}
          poster={c.hero.poster}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          aria-label={c.hero.eyebrow}
        />
      )}
    </>
  );
}
function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <div
      className={`inline-flex gap-0.5 text-terracotta ${className}`}
      aria-label={`${rating} out of 5 stars`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 ${i < Math.floor(rating) ? "" : "opacity-25"}`}
        >
          <path d="M10 15.27 16.18 19l-1.64-7.03L20 7.24l-7.19-.61L10 0 7.19 6.63 0 7.24l5.46 4.73L3.82 19z" />
        </svg>
      ))}
    </div>
  );
}

function Nav() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  const [open, setOpen] = useState(false);
  const links = [
    ["Craft", "#craft"],
    ["Services", "#services"],
    ...(site.gallery.length ? [["Projects", "#projects"]] : []),
    ...(c.trust.reviews.length || c.trust.aggregate ? [["Reviews", "#reviews"]] : []),
    ["Contact", "#contact"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
        <a href="#top" className="flex items-center gap-3">
          <Logo />
          <span className="hidden sm:block">
            <span className="block font-display text-base font-semibold leading-none">
              {c.identity.businessName}
            </span>
            <span className="block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {c.identity.city}, {c.identity.state}
            </span>
          </span>
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-sm font-medium text-foreground/80 transition hover:text-terracotta"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={PHONE_HREF}
            className="hidden rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-terracotta md:inline-flex"
          >
            {PHONE_DISPLAY}
          </a>
          <button
            aria-label="Toggle menu"
            aria-expanded={open}
            className="grid h-10 w-10 place-items-center rounded-md border border-border md:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="block h-0.5 w-5 bg-foreground before:mb-1.5 before:block before:h-0.5 before:w-5 before:bg-foreground after:mt-1.5 after:block after:h-0.5 after:w-5 after:bg-foreground" />
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col px-5 py-3">
            {links.map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="py-3 text-sm font-medium"
              >
                {label}
              </a>
            ))}
            <a
              href={PHONE_HREF}
              className="mt-2 rounded-full bg-foreground px-5 py-3 text-center text-sm font-semibold text-primary-foreground"
            >
              Call {PHONE_DISPLAY}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  return (
    <section id="top" className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <HeroMedia />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/70" />
      </div>
      <div className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-36">
        <div className="max-w-3xl text-primary-foreground">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-terracotta" />
            {c.hero.eyebrow}
          </p>
          <h1 className="mt-6 font-display text-5xl leading-[1.02] md:text-7xl">
            {c.hero.line1}
            <br />
            <span className="italic text-stone">{c.hero.emphasis}</span> {c.hero.line3}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/85 md:text-xl">{c.hero.support}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#contact"
              className="rounded-full bg-terracotta px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/20 transition hover:brightness-110"
            >
              Get in touch
            </a>
            <a
              href={PHONE_HREF}
              className="rounded-full border border-white/40 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Call {PHONE_DISPLAY}
            </a>
          </div>

          {(c.trust.aggregate || c.identity.founded || c.trust.badges.length > 0) && (
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-sm text-white/85">
              {c.trust.aggregate &&
                c.trust.aggregate.rating !== null &&
                c.trust.aggregate.count !== null && (
                  <a href={c.trust.aggregate.sourceUrl} className="flex items-center gap-2">
                    <Stars rating={c.trust.aggregate.rating} />
                    <span>
                      {c.trust.aggregate.rating} - {c.trust.aggregate.count} reviews
                    </span>
                  </a>
                )}
              {c.identity.founded && <span>Established {c.identity.founded}</span>}
              {c.trust.badges.slice(0, 2).map((b) => (
                <span key={b.label}>{b.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Craft() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  return (
    <section id="craft" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-terracotta">
            Our craft
          </p>
          <h2 className="mt-4 font-display text-4xl md:text-5xl">
            {c.content.whyHeadline || "Our craft"}
          </h2>
          <div className="mt-6 space-y-4 text-lg text-foreground/80">
            {site.copy.about.split(/\n\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ...c.content.values.map((v) => `${v.title}: ${v.body}`),
              ...c.trust.badges.map((b) =>
                [b.label, b.sublabel, b.meta].filter(Boolean).join(" · "),
              ),
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm font-medium">
                <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-terracotta text-white">
                  <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
                    <path
                      d="M4 10.5 8 14l8-8"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        {site.craftImage && (
          <div className="relative">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              <img
                src={site.craftImage.path}
                alt={`${c.identity.businessName} - our craft`}
                className="h-full w-full object-cover"
              />
            </div>
            {c.identity.founded && (
              <div className="absolute -bottom-6 -left-6 hidden w-56 rounded-xl border border-border bg-card p-5 shadow-xl md:block">
                <p className="font-display text-4xl leading-none text-terracotta">
                  {c.identity.founded}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Established</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Services() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  return (
    <section id="services" className="border-y border-border bg-secondary/40">
      <div className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-terracotta">
              What we do
            </p>
            <h2 className="mt-4 font-display text-4xl md:text-5xl">Our services.</h2>
            <p className="mt-4 text-lg text-foreground/75">{c.content.serviceIntro}</p>
          </div>
          <a href="#contact" className="text-sm font-semibold text-terracotta hover:underline">
            Contact us
          </a>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {c.services.map((s) => (
            <article
              key={s.name}
              className="group overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-1 hover:shadow-xl"
            >
              {/* Service-specific photography requires a certified service-to-media relation absent from CSD v2. */}
              <div className="aspect-[4/3] overflow-hidden bg-secondary/40" aria-hidden="true" />
              <div className="p-6">
                <h3 className="font-display text-xl">
                  {s.href ? <a href={s.href}>{s.name}</a> : s.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Projects() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  if (!site.gallery.length) return null;
  return (
    <section id="projects" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-terracotta">
            Projects
          </p>
          <h2 className="mt-4 font-display text-4xl md:text-5xl">Project gallery.</h2>
        </div>
        {site.copy.gallery && <p className="max-w-md text-foreground/75">{site.copy.gallery}</p>}
      </div>
      <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {site.gallery.map(({ path: src }, i) => (
          <div
            key={src}
            className={`overflow-hidden rounded-lg ${i % 5 === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"}`}
          >
            <img
              src={src}
              alt={`${c.identity.businessName} project ${i + 1}`}
              loading="lazy"
              className="h-full w-full object-cover transition duration-700 hover:scale-105"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Reviews() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  if (!c.trust.reviews.length && !c.trust.aggregate) return null;
  return (
    <section
      id="reviews"
      className="relative overflow-hidden bg-foreground text-primary-foreground"
    >
      <div className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-terracotta">
              What clients say
            </p>
            <h2 className="mt-4 font-display text-4xl md:text-5xl">Client reviews.</h2>
          </div>
          {c.trust.aggregate &&
            c.trust.aggregate.rating !== null &&
            c.trust.aggregate.count !== null && (
              <a
                href={c.trust.aggregate.sourceUrl}
                className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/5 px-6 py-4"
              >
                <div>
                  <div className="font-display text-4xl leading-none">
                    {c.trust.aggregate.rating}
                  </div>
                  <Stars rating={c.trust.aggregate.rating} className="mt-1" />
                </div>
                <div className="h-10 w-px bg-white/20" />
                <div className="text-sm">
                  <p className="font-semibold">{c.trust.aggregate.count} reviews</p>
                  <p className="text-white/70">
                    {c.identity.city}, {c.identity.state}
                  </p>
                </div>
              </a>
            )}
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {c.trust.reviews.slice(0, 4).map((t) => (
            <figure
              key={t.author}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-8"
            >
              {t.rating !== null && <Stars rating={t.rating} />}
              <blockquote className="mt-4 font-display text-xl leading-snug text-white/95">
                "{t.text}"
              </blockquote>
              <figcaption className="mt-6 text-sm font-semibold uppercase tracking-widest text-terracotta">
                — <a href={t.sourceUrl}>{t.author}</a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  return (
    <section id="contact" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
      <div className="grid gap-12 rounded-3xl border border-border bg-card p-8 shadow-sm md:grid-cols-2 md:p-14">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-terracotta">
            Get in touch
          </p>
          <h2 className="mt-4 font-display text-4xl md:text-5xl">
            {c.content.ctaHeadline || "Get in touch."}
          </h2>
          <p className="mt-5 text-lg text-foreground/75">{site.copy.contact}</p>

          <dl className="mt-10 space-y-6 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Phone
              </dt>
              <dd className="mt-1">
                <a
                  href={PHONE_HREF}
                  className="font-display text-2xl text-foreground hover:text-terracotta"
                >
                  {PHONE_DISPLAY}
                </a>
              </dd>
            </div>
            {EMAIL && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Email
                </dt>
                <dd className="mt-1">
                  <a href={`mailto:${EMAIL}`} className="text-foreground hover:text-terracotta">
                    {EMAIL}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Location
              </dt>
              <dd className="mt-1 text-foreground">
                {c.identity.city}, {c.identity.state}
              </dd>
            </div>
            {site.copy.areas && (
              <div>
                <dt>Service area information</dt>
                <dd>{site.copy.areas}</dd>
              </div>
            )}
            {site.hoursText && (
              <div>
                <dt>Hours</dt>
                <dd>{site.hoursText}</dd>
              </div>
            )}
            {c.trust.areas.length > 0 && (
              <div>
                <dt>Service areas</dt>
                <dd>{c.trust.areas.join(" - ")}</dd>
              </div>
            )}
            {c.trust.mapUrl && (
              <div>
                <a href={c.trust.mapUrl}>Business location information</a>
              </div>
            )}
          </dl>
          {c.content.faqs.length > 0 && (
            <div className="mt-8 space-y-3">
              {c.content.faqs.slice(0, 6).map((f) => (
                <details key={f.q} className="border-b border-border py-3">
                  <summary className="cursor-pointer font-semibold">{f.q}</summary>
                  <p className="mt-3 text-sm">{f.a}</p>
                </details>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-secondary/50 p-6 md:p-8 flex flex-col justify-center gap-6">
          <h3 className="font-display text-2xl">Contact {c.identity.businessName}</h3>
          <a
            href={PHONE_HREF}
            className="rounded-full bg-terracotta px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:brightness-110"
          >
            Call {PHONE_DISPLAY}
          </a>
          {EMAIL && (
            <a
              href={`mailto:${EMAIL}`}
              className="rounded-full border border-border px-6 py-3.5 text-center text-sm font-semibold"
            >
              Email us
            </a>
          )}
          {c.trust.bookingUrl && (
            <a href={c.trust.bookingUrl} className="text-center text-sm underline">
              Book an appointment
            </a>
          )}
          {c.content.seasonalNote && (
            <p className="text-sm text-muted-foreground">{c.content.seasonalNote}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const site = useSite();
  const { client: c } = site;
  const PHONE_HREF = c.identity.phoneTel,
    PHONE_DISPLAY = c.identity.phoneDisplay,
    EMAIL = c.identity.email;
  return (
    <footer className="border-t border-border bg-secondary/30">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-10 md:flex-row md:items-center md:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-display font-semibold">{c.identity.businessName}</p>
            <p className="text-xs text-muted-foreground">
              {c.trust.areas.join(" - ") || `${c.identity.city}, ${c.identity.state}`}
            </p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          <a href={PHONE_HREF} className="hover:text-terracotta">
            {PHONE_DISPLAY}
          </a>
          {EMAIL && (
            <>
              <span className="mx-3"> · </span>
              <a href={`mailto:${EMAIL}`} className="hover:text-terracotta">
                {EMAIL}
              </a>
            </>
          )}
          {c.trust.socials.map((url, i) => (
            <a key={url} href={url} className="ml-3 underline">
              Social profile {i + 1}
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {c.identity.businessName}
        </p>
      </div>
    </footer>
  );
}

export function Landing({ site, path = "/" }: { site: Bridge; path?: string }) {
  const service = site.client.services.find((s) => s.href && s.href === path);
  if (path !== "/" && !service)
    return (
      <main className="p-8">
        <h1>Page not found</h1>
        <a href="/">Go home</a>
      </main>
    );
  return (
    <Context.Provider value={site}>
      {path === "/" ? (
        <Nav />
      ) : (
        <header className="mx-auto max-w-7xl px-5 py-4">
          <a href="/">{site.client.identity.businessName} - Home</a>
        </header>
      )}
      <main>
        {service ? (
          <section className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
            <p className="text-xs uppercase tracking-[0.25em] text-terracotta">Our services</p>
            <h1 className="mt-4 font-display text-5xl">{service.name}</h1>
            <p className="mt-6 max-w-3xl text-lg">{service.description}</p>
          </section>
        ) : (
          <>
            <Hero />
            <Craft />
            <Services />
            <Projects />
            <Reviews />
          </>
        )}
        <Contact />
      </main>
      <Footer />
    </Context.Provider>
  );
}
