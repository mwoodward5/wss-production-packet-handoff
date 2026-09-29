import { useSite, paragraphs, resolvePage } from "../wss-bridge";
import { HeroMedia } from "../hero-media";

export default function Index({ path = "/" }: { path?: string }) {
  const site = useSite();
  const page = resolvePage(site, path);
  if (page.kind !== "home")
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="container-x py-24">
          {page.kind === "missing" ? (
            <>
              <h1>Page not found</h1>
              <a href="/">Home</a>
            </>
          ) : page.kind === "service" ? (
            <>
              <p className="text-primary">{site.client.identity.businessName}</p>
              <h1 className="mt-4 text-4xl md:text-5xl">{page.service.name}</h1>
              <p className="mt-6 max-w-2xl text-lg">{page.service.description}</p>
              <a
                href="/#quote"
                className="mt-8 inline-block rounded-full bg-primary px-6 py-3 text-primary-foreground"
              >
                Contact
              </a>
            </>
          ) : (
            <>
              <h1 className="text-4xl md:text-5xl">
                {page.slug === "about"
                  ? site.client.content.whyHeadline || "About"
                  : page.slug.replace("-", " ")}
              </h1>
              <Copy text={page.body} />
              {page.slug === "services" && <Services />}
              {page.slug === "gallery" && <Gallery />}
              {page.slug === "contact" && <QuoteCTA />}
            </>
          )}
        </main>
        <Footer />
      </div>
    );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <TrustBar />
      <Services />
      <Process />
      <Gallery />
      <Areas />
      <FAQ />
      <QuoteCTA />
      <Footer />
    </div>
  );
}

function Nav() {
  const { client, plan, gallery, emailHref, hoursText } = useSite();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="container-x flex h-18 items-center justify-between py-3">
        <a href="/#top" className="flex items-center gap-2">
          <img
            src={client.identity.logoOnLight}
            alt={client.identity.businessName}
            className="h-10 max-w-[45vw] w-auto object-contain"
          />
        </a>
        <nav className="hidden items-center gap-8 text-sm font-medium text-foreground/80 md:flex">
          <a href="/#services" className="hover:text-primary">
            Services
          </a>
          {gallery.length > 0 && (
            <a href="/#work" className="hover:text-primary">
              Our Work
            </a>
          )}
          {client.content.values.length > 0 && (
            <a href="/#process" className="hover:text-primary">
              About
            </a>
          )}
          {client.trust.areas.length > 0 && (
            <a href="/#areas" className="hover:text-primary">
              Areas
            </a>
          )}
          <a href="/#quote" className="hover:text-primary">
            Contact
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={client.identity.phoneTel}
            className="hidden text-sm font-semibold text-foreground sm:block"
          >
            {client.identity.phoneDisplay}
          </a>
          <a
            href="/#quote"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-soft)] transition hover:brightness-95"
          >
            Get a Quote
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const { client, plan, gallery, emailHref, hoursText } = useSite();
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="absolute inset-0">
        <HeroMedia />
        <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
      </div>
      <div className="container-x relative flex min-h-[78vh] w-full min-w-0 max-w-full flex-col justify-end pb-16 pt-40 text-white">
        <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.78_0.17_140)]" />
          {client.hero.eyebrow}
        </span>
        <h1 className="max-w-4xl min-w-0 break-words text-4xl leading-[1.08] text-white sm:text-6xl md:text-7xl">
          {client.hero.line1}{" "}
          <span className="italic text-[oklch(0.88_0.11_130)]">{client.hero.emphasis}</span>{" "}
          {client.hero.line3}
        </h1>
        <p className="mt-6 max-w-2xl min-w-0 break-words text-base leading-relaxed text-white/85 sm:text-lg">{client.hero.support}</p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <a
            href="/#quote"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-foreground shadow-[var(--shadow-lift)] transition hover:bg-white/90"
          >
            Start Your Project
          </a>
          <a
            href={client.identity.phoneTel}
            className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Call {client.identity.phoneDisplay}
          </a>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const { client } = useSite();
  const aggregate =
    client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null
      ? client.trust.aggregate
      : null;
  if (!client.trust.badges.length && !aggregate && !client.trust.reviews.length) return null;
  return (
    <section className="border-b border-border bg-card">
      <div className="container-x grid gap-8 py-10 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
          {client.trust.badges.map((b) => (
            <span key={b.label} className="font-semibold tracking-wide text-foreground">
              {b.label}
              {b.sublabel && ` — ${b.sublabel}`}
              {b.meta && ` · ${b.meta}`}
            </span>
          ))}
          {aggregate && (
            <a href={aggregate.sourceUrl}>
              {aggregate.rating} / 5 · {aggregate.count} reviews
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {client.trust.reviews.map((r) => (
            <blockquote key={r.sourceUrl + r.author} className="max-w-md text-sm">
              <p>{r.text}</p>
              <a href={r.sourceUrl}>{r.author}</a>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

function Services() {
  const { client, plan, gallery, emailHref, hoursText } = useSite();
  return (
    <section id="services" className="py-24">
      <div className="container-x">
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              What we do
            </p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Services</h2>
          </div>
          <p className="text-lg leading-relaxed text-muted-foreground md:mt-14">
            {client.content.serviceIntro}
          </p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {client.services.map((s, i) => (
            <article
              key={s.name}
              className="group relative flex flex-col rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
            >
              <span className="font-display text-sm text-primary">0{i + 1}</span>
              <h3 className="mt-3 text-2xl">{s.name}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
              <a
                href={s.href || "/#quote"}
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                {s.href ? "Learn more" : "Contact"} <span aria-hidden>→</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Process() {
  const { client } = useSite();
  if (!client.content.values.length) return null;
  return (
    <section id="process" className="bg-[oklch(0.22_0.02_150)] py-24 text-white">
      <div className="container-x">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[oklch(0.82_0.15_140)]">
            About
          </p>
          <h2 className="mt-4 text-4xl leading-tight md:text-5xl">
            {client.content.whyHeadline || "About"}
          </h2>
          <p className="mt-5 text-white/70">{client.content.about}</p>
        </div>
        <ol className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {client.content.values.map((s, i) => (
            <li key={s.title} className="border-t border-white/15 pt-6">
              <div className="font-display text-4xl text-[oklch(0.82_0.15_140)]">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="mt-3 text-xl text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Gallery() {
  const { client, plan, gallery } = useSite();
  if (!gallery.length) return null;
  return (
    <section id="work" className="py-24">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Selected work
            </p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Our work</h2>
          </div>
          <p className="max-w-md text-muted-foreground">{plan?.content.gallery || ""}</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-6 md:grid-rows-2">
          {gallery.map((image, i) => (
            <figure
              key={image.path}
              className={i === 0 ? "md:col-span-4 md:row-span-2" : "md:col-span-2"}
            >
              <img
                src={image.path}
                alt={`${client.identity.businessName} — project ${i + 1}`}
                loading="lazy"
                className="h-72 w-full rounded-2xl object-cover shadow-[var(--shadow-soft)] md:h-full"
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Areas() {
  const { client, plan } = useSite();
  if (!client.trust.areas.length) return null;
  return (
    <section id="areas" className="bg-secondary/60 py-20">
      <div className="container-x grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Where we work
          </p>
          <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Service areas</h2>
          <p className="mt-5 text-muted-foreground">
            {paragraphs(plan?.content["service-area"] || "").join("\n\n")}
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {client.trust.areas.map((a) => (
            <li
              key={a}
              className="rounded-xl border border-border bg-card px-4 py-4 text-center font-medium text-foreground shadow-[var(--shadow-soft)]"
            >
              {a}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function QuoteCTA() {
  const { client, plan, gallery, emailHref, hoursText } = useSite();
  return (
    <section id="quote" className="py-24">
      <div className="container-x">
        <div
          className="overflow-hidden rounded-3xl p-10 text-white shadow-[var(--shadow-lift)] md:p-16"
          style={{ background: "var(--gradient-leaf)" }}
        >
          <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <h2 className="text-4xl leading-tight text-white md:text-5xl">
                {client.content.ctaHeadline || "Contact"}
              </h2>
              <p className="mt-5 max-w-xl text-white/85">
                {plan?.content.contact
                  ? paragraphs(plan.content.contact).join("\n\n")
                  : client.content.ctaBody}
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href={client.identity.phoneTel}
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[oklch(0.35_0.12_150)] shadow-[var(--shadow-soft)] transition hover:bg-white/90"
                >
                  Call {client.identity.phoneDisplay}
                </a>
                {emailHref && (
                  <a
                    href={emailHref}
                    className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Email us
                  </a>
                )}
                {client.trust.bookingUrl && (
                  <a
                    href={client.trust.bookingUrl}
                    className="rounded-full border border-white/40 px-6 py-3"
                  >
                    Book
                  </a>
                )}
              </div>
            </div>
            <ul className="grid gap-3 text-sm text-white/90">
              {client.trust.badges.map((badge) => {
                const b = [badge.label, badge.sublabel, badge.meta].filter(Boolean).join(" · ");
                return (
                  <li
                    key={b}
                    className="flex items-start gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur"
                  >
                    <span className="mt-0.5 text-white">✓</span>
                    <span>{b}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const { client, plan, gallery, emailHref, hoursText } = useSite();
  return (
    <footer className="border-t border-border bg-[oklch(0.18_0.02_150)] py-14 text-white/80">
      <div className="container-x grid gap-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <img
            src={client.identity.logoOnDark}
            alt={client.identity.businessName}
            className="h-12 w-auto object-contain"
          />
          <p className="mt-5 max-w-md text-sm text-white/70">
            {plan?.content.about
              ? paragraphs(plan.content.about).join("\n\n")
              : client.content.about}
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/50">
            {client.trust.badges.map((b) => b.label).join(" · ")}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white">Services</h4>
          <ul className="mt-4 space-y-2 text-sm">
            {client.services.map((service) => (
              <li key={service.name}>
                <a href={service.href || "/#services"} className="hover:text-white">
                  {service.shortLabel}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white">Contact</h4>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a href={client.identity.phoneTel} className="hover:text-white">
                {client.identity.phoneDisplay}
              </a>
            </li>
            <li>
              {client.identity.city}, {client.identity.state}
            </li>
            {emailHref && (
              <li>
                <a href={emailHref}>{client.identity.email}</a>
              </li>
            )}
            {hoursText && <li>{hoursText}</li>}
            {client.trust.mapUrl && (
              <li>
                <a href={client.trust.mapUrl}>Map and directions</a>
              </li>
            )}
            <li className="flex gap-3 pt-2">
              {client.trust.socials.map((url) => (
                <a key={url} href={url} className="hover:text-white">
                  {new URL(url).hostname}
                </a>
              ))}
            </li>
          </ul>
        </div>
      </div>
      <div className="container-x mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/50">
        <p>
          © {new Date().getFullYear()} {client.identity.businessName}
        </p>
        <p>{client.trust.areas.join(" · ")}</p>
      </div>
    </footer>
  );
}

function Copy({ text }: { text: string }) {
  return (
    <>
      {paragraphs(text).map((p, i) => (
        <p
          key={i}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground whitespace-pre-line"
        >
          {p}
        </p>
      ))}
    </>
  );
}
function FAQ() {
  const { client } = useSite();
  if (!client.content.faqs.length) return null;
  return (
    <section id="faq" className="container-x py-20">
      <h2 className="text-4xl md:text-5xl">Questions & answers</h2>
      <div className="mt-10 grid gap-4">
        {client.content.faqs.map((f) => (
          <details key={f.q} className="rounded-2xl border border-border bg-card p-7">
            <summary className="cursor-pointer font-display text-2xl">{f.q}</summary>
            <p className="mt-4 text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
