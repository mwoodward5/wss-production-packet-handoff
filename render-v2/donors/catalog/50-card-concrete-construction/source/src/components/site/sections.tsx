import { useEffect, useRef, useState } from "react";
import { SERVICES } from "@/content/services";
import { FAQS } from "@/content/faqs";
import { CLIENT, BINDING, SITE } from "@/lib/site";
import { ServiceIcon } from "./icons";
import { CC_ASSETS } from "@/assets/cc";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 text-white transition-all duration-300 ${
        scrolled
          ? "bg-[var(--ink)]/80 backdrop-blur-xl border-b border-white/10 supports-[backdrop-filter]:bg-[var(--ink)]/60"
          : "bg-transparent"
      }`}
    >
      <div className={`mx-auto max-w-7xl px-5 sm:px-8 flex items-center justify-between transition-all ${scrolled ? "py-3" : "py-5"}`}>
        <a href="/#top" className="flex items-center gap-2.5 group">
          <img src={CC_ASSETS.logo} alt={SITE.name} className={`w-auto transition-all ${scrolled ? "h-8" : "h-9 sm:h-10"}`} />
        </a>
        <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
          <a href="/#services" className="hover:text-white">Services</a>
          {CC_ASSETS.gallery.length > 0 && <a href="/#gallery" className="hover:text-white">Work</a>}
          <a href="/#process" className="hover:text-white">About</a>
          <a href="/#area" className="hover:text-white">Service area</a>
          {FAQS.length > 0 && <a href="/#faq" className="hover:text-white">FAQ</a>}
          <a href={SITE.phoneHref} className="text-white font-semibold">{SITE.phone}</a>
        </nav>
        <a href="/#quote" className="md:hidden bg-[var(--brand)] text-[var(--ink)] px-3 py-1.5 text-sm font-bold rounded-md">Quote</a>
      </div>
    </header>
  );
}

export function ServiceStack() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section id="services" className="bg-[var(--paper)] text-[var(--ink)] py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--brand-ink)] font-semibold">Capabilities</div>
          <h2 className="font-display text-4xl sm:text-5xl mt-3">Services</h2>
          <p className="text-[var(--grit-2)] mt-4 text-lg">
            {CLIENT.content.serviceIntro}
          </p>
        </div>

        <div className="mt-14 space-y-6">
          {SERVICES.map((s, idx) => {
            const isOpen = open === s.slug;
            const img = CC_ASSETS.service[s.slug];
            const flip = idx % 2 === 1;
            return (
              <article
                key={s.slug}
                id={s.slug}
                className={`relative grid lg:grid-cols-12 gap-0 border-2 transition overflow-hidden rounded-sm ${
                  isOpen
                    ? "bg-[var(--ink)] text-white border-[var(--ink)] shadow-[10px_10px_0_0_var(--brand)]"
                    : "bg-white border-[var(--ink)] hover:shadow-[10px_10px_0_0_var(--ink)]"
                }`}
              >
                {/* Image */}
                {(
                  <div className={`relative lg:col-span-5 aspect-[16/10] lg:aspect-auto overflow-hidden bg-[var(--ink)] ${flip ? "lg:order-2" : ""}`}>
                    {img && <img src={img} alt={s.name} loading="lazy" className="w-full h-full object-cover"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />}
                    <span className="absolute top-3 left-3 font-mono text-[10px] tracking-[0.2em] text-[var(--brand)] bg-[var(--ink)]/80 px-2 py-1 rounded">
                      SVC-{String(idx + 1).padStart(2, "0")}
                    </span>
                  </div>
                )}
                {/* Copy */}
                <div className={`lg:col-span-7 p-6 sm:p-8 flex flex-col ${flip ? "lg:order-1" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className={`size-11 grid place-items-center rounded-sm ${isOpen ? "bg-[var(--brand)] text-[var(--ink)]" : "bg-[var(--ink)] text-[var(--brand)]"}`}>
                      <ServiceIcon name={s.icon} className="size-6" />
                    </div>
                    <div className="font-mono text-[10px] tracking-[0.22em] opacity-70">{s.ideal}</div>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl mt-4">{s.name}</h3>
                  <p className={`mt-2 text-base ${isOpen ? "text-white/75" : "text-[var(--grit-2)]"}`}>{s.blurb}</p>
                  {isOpen && (
                    <p className={`mt-3 text-sm leading-relaxed ${isOpen ? "text-white/80" : "text-[var(--grit-2)]"}`}>{s.details}</p>
                  )}
                  {s.details && <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : s.slug)}
                    aria-expanded={isOpen}
                    className={`mt-5 self-start text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm transition ${
                      isOpen
                        ? "bg-[var(--brand)] text-[var(--ink)]"
                        : "border border-[var(--ink)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--brand)]"
                    }`}
                  >
                    {isOpen ? "Collapse ▴" : "Spec sheet ▾"}
                  </button>}
                  {s.href && <a href={s.href} className="mt-4 underline">View service →</a>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Gallery() {
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowRight") setActive((i) => (i === null ? null : (i + 1) % CC_ASSETS.gallery.length));
      if (e.key === "ArrowLeft") setActive((i) => (i === null ? null : (i - 1 + CC_ASSETS.gallery.length) % CC_ASSETS.gallery.length));
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active]);
  if (!CC_ASSETS.gallery.length) return null;
  return (
    <section id="gallery" className="bg-[var(--ink)] text-white py-20 sm:py-28 relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 concrete-grain opacity-40" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--brand)] font-semibold">Project gallery</div>
          <h2 className="font-display text-4xl sm:text-5xl mt-3">From the jobsite.</h2>
          <p className="text-white/65 mt-4 text-lg">
            {SITE.name}
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {CC_ASSETS.gallery.map((g, i) => (
            <button
              key={g.url}
              type="button"
              onClick={() => setActive(i)}
              className={`relative overflow-hidden rounded-lg border border-white/10 bg-white/5 group text-left focus:outline-none focus:ring-2 focus:ring-[var(--brand)] ${
                i === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-[4/3]"
              }`}
              aria-label={`Open image: ${g.alt}`}
            >
              <img
                src={g.url}
                alt={g.alt}
                loading="lazy"
                className="w-full h-full object-cover transition duration-500 group-hover:scale-[1.04]"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <span aria-hidden className="pointer-events-none absolute top-2 right-2 size-7 rounded-full bg-[var(--ink)]/70 backdrop-blur grid place-items-center text-[var(--brand)] text-xs opacity-0 group-hover:opacity-100 transition">⤢</span>
              {g.caption && (
                <span className="absolute inset-x-0 bottom-0 p-3 text-xs font-medium bg-gradient-to-t from-[var(--ink)] to-transparent text-white block">
                  {g.caption}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {active !== null && (
        <div
          className="fixed inset-0 z-[60] bg-[var(--ink)]/95 backdrop-blur-md grid place-items-center p-4 sm:p-8 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="Project image viewer"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActive(null); }}
            className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl grid place-items-center"
            aria-label="Close"
          >×</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActive((i) => i === null ? null : (i - 1 + CC_ASSETS.gallery.length) % CC_ASSETS.gallery.length); }}
            className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center"
            aria-label="Previous image"
          >‹</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActive((i) => i === null ? null : (i + 1) % CC_ASSETS.gallery.length); }}
            className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center"
            aria-label="Next image"
          >›</button>
          <figure className="max-w-6xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={CC_ASSETS.gallery[active].url}
              alt={CC_ASSETS.gallery[active].alt}
              className="w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
            />
            <figcaption className="mt-4 text-center text-sm text-white/80">
              <span className="text-[var(--brand)] font-mono text-[10px] tracking-[0.2em] mr-3">{String(active + 1).padStart(2, "0")} / {String(CC_ASSETS.gallery.length).padStart(2, "0")}</span>
              {CC_ASSETS.gallery[active].caption || CC_ASSETS.gallery[active].alt}
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

export function ProcessRail() {
  const steps = CLIENT.content.values.map((v, i) => ({n: `T-${String(i).padStart(2, '0')}`, t: v.title, d: v.body, mark: ''}));
  return (
    <section id="process" className="bg-[var(--ink)] text-white py-20 sm:py-28 relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 concrete-grain opacity-50" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 grid lg:grid-cols-[1fr_2fr] gap-14 lg:gap-20">
        {/* Left: sticky header — breaks the equal-column rhythm */}
        <div className="lg:sticky lg:top-24 self-start">
          <div className="spec-mark">About · SITE NOTES</div>
          <h2 className="font-display text-4xl sm:text-5xl mt-3 leading-[0.95]">
            {CLIENT.content.whyHeadline || SITE.name}
          </h2>
          <p className="text-white/60 mt-5 text-sm leading-relaxed max-w-sm">
            {CLIENT.content.about}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 text-[10px] uppercase tracking-[0.18em] text-white/45 max-w-sm">
            {CLIENT.trust.badges.map(b => <div key={b.label} className="border border-white/10 rounded px-3 py-2">{b.label}{b.sublabel && <span className="block">{b.sublabel}</span>}</div>)}
          </div>
        </div>

        {/* Right: vertical timeline with traveling laser */}
        {steps.length > 0 && <ol className="relative pl-10 sm:pl-14">
          <div aria-hidden className="absolute left-3 sm:left-5 top-1 bottom-1 w-px bg-gradient-to-b from-[var(--brand)]/60 via-white/15 to-[var(--brand)]/0" />
          <div aria-hidden className="absolute left-3 sm:left-5 top-0 h-24 w-px bg-[var(--brand)] shadow-[0_0_18px_var(--brand)] laser-scan" />
          {steps.map((s, i) => (
            <li key={s.n} className="relative pb-12 last:pb-0">
              <div className="absolute -left-7 sm:-left-9 top-1 size-6 rounded-full border-2 border-[var(--brand)] bg-[var(--ink)] grid place-items-center">
                <span className="size-2 rounded-full bg-[var(--brand)]" />
              </div>
              <div className="flex items-baseline gap-4 flex-wrap">
                <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--brand)]">{s.n}</span>
                <span className="font-mono text-[10px] tracking-[0.2em] text-white/40">NOTE {String(i + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
                <span className="ml-auto font-mono text-[10px] tracking-[0.2em] text-white/45 border border-white/10 px-2 py-0.5 rounded">{s.mark}</span>
              </div>
              <h3 className="font-display text-2xl sm:text-3xl mt-2">{s.t}</h3>
              <p className="mt-3 text-white/65 leading-relaxed max-w-xl">{s.d}</p>
            </li>
          ))}
        </ol>}
      </div>
    </section>
  );
}

export function ServiceArea() {
  const { city, region } = SITE.address;
  const geo = BINDING.coordinates;
  const mapSrc = geo ? `https://www.openstreetmap.org/export/embed.html?bbox=${geo.lng - .1},${geo.lat - .1},${geo.lng + .1},${geo.lat + .1}&layer=mapnik&marker=${geo.lat},${geo.lng}` : '';
  return (
    <section id="area" className="relative bg-[var(--ink)] text-white py-20 sm:py-28 overflow-hidden">
      <div aria-hidden className="absolute inset-0 concrete-grain opacity-40" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 grid lg:grid-cols-[1fr_1.2fr] gap-12 items-center">
        <div>
          <div className="spec-mark">Service area</div>
          <h2 className="font-display text-4xl sm:text-5xl mt-3">
            <span className="text-[var(--brand)]">{city}</span>, {region}
          </h2>
          <p className="text-white/65 mt-4 text-lg whitespace-pre-line">
            {BINDING.sectionCopy.area || SITE.name}
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {SITE.nearbyCities.map((c) => (
              <li key={c} className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-white text-sm">{c}</li>
            ))}
          </ul>
          <div className="mt-7 text-sm text-white/60">
            <div className="font-semibold text-white">{SITE.address.street}</div>
            <div>{city}, {region} {SITE.address.postal}</div>
            <div className="mt-2">{SITE.hours}</div>
            <a href={SITE.phoneHref} className="inline-block mt-4 font-bold text-white underline decoration-[var(--brand)] decoration-2 underline-offset-4">
              {SITE.phone}
            </a>
          </div>
          {CLIENT.trust.mapUrl && <div className="mt-6 flex flex-wrap gap-3">
            <a href={CLIENT.trust.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[var(--brand)] text-[var(--ink)] px-4 py-2.5 rounded-md font-bold text-sm hover:brightness-110">View map & directions →</a>
          </div>}
        </div>

        {/* Premium map frame: terrain-style treatment, radius overlay, corner spec marks */}
        {geo && <div className="relative">
          <div aria-hidden className="absolute -inset-4 bg-[var(--brand)]/10 blur-3xl rounded-3xl" />
          <div className="relative rounded-2xl overflow-hidden border border-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] aspect-[5/4] bg-[var(--ink-2)]">
            <iframe
              title={`${SITE.name} location map`}
              src={mapSrc}
              className="w-full h-full"
              style={{ filter: "grayscale(0.7) contrast(1.05) brightness(0.7) hue-rotate(70deg) saturate(0.9)" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            {/* Corner spec marks */}
            <div className="pointer-events-none absolute inset-0 p-3 flex justify-between items-start text-[10px] uppercase tracking-[0.2em] text-white/70 font-mono">
              <span className="bg-[var(--ink)]/70 px-2 py-1 rounded">{geo.lat} · {geo.lng}</span>

            </div>
          </div>
        </div>}
      </div>
    </section>
  );
}

export function Faq() {
  const [open, setOpen] = useState(0);
  if (!FAQS.length) return null;
  return (
    <section id="faq" className="bg-[var(--ink)] text-white py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--brand)] font-semibold">Common questions</div>
        <h2 className="font-display text-4xl sm:text-5xl mt-3">Straight answers, no run-around.</h2>
        <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  type="button"
                  className="w-full grid grid-cols-[auto_1fr_auto] items-start gap-4 sm:gap-6 py-5 text-left"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                >
                  <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--brand)] pt-1.5">Q-{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-display text-lg sm:text-xl">{f.q}</span>
                  <span className={`text-[var(--brand)] text-2xl leading-none transition ${isOpen ? "rotate-45" : ""}`}>+</span>
                </button>
                {isOpen && <p className="pb-6 pl-16 sm:pl-20 pr-10 text-white/70 leading-relaxed">{f.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ContactSection() {
  const [draft, setDraft] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const transfer = (event: Event) => {
      const detail = (event as CustomEvent<{service: string; zip: string; notes: string}>).detail;
      for (const [name, value] of Object.entries({service_type: detail.service, zip: detail.zip, message: detail.notes})) {
        const input = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
        if (input) input.value = value || '';
      }
    };
    window.addEventListener('wss-triage', transfer);
    return () => window.removeEventListener('wss-triage', transfer);
  }, []);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setDraft(['name', 'phone', 'email', 'zip', 'service_type', 'message'].map(k => `${k}: ${String(fd.get(k) || '')}`).join('\n'));
  }
  return (
    <section id="quote" className="bg-[var(--paper)] text-[var(--ink)] py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        {/* Work order ticket — single-stage, header on top, fields gridded inside */}
        <div className="bg-white border-2 border-[var(--ink)] rounded-sm shadow-[8px_8px_0_0_var(--ink)]">
          {/* Ticket header strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 sm:px-8 py-4 bg-[var(--ink)] text-white font-mono text-[11px] uppercase tracking-[0.2em]">
            <span className="text-[var(--brand)]">● Work Order Intake</span>
            <span className="text-white/55">Form CC-001 · Rev 2026</span>
            <span className="text-white/55">{SITE.address.city}, {SITE.address.region} · {SITE.phone}</span>
          </div>

          {/* Headline bar — full-width, not a sidebar */}
          <div className="px-6 sm:px-8 pt-8 pb-6 border-b border-[var(--grit)]">
            <h2 className="font-display text-3xl sm:text-5xl leading-[0.95]">
              {CLIENT.content.ctaHeadline || 'Prepare a job ticket.'}<br/>
              <span className="text-[var(--grit-2)]">{SITE.email ? 'Call or email to discuss it.' : 'Call to discuss it.'}</span>
            </h2>
            <p className="mt-4 text-[var(--grit-2)] max-w-2xl whitespace-pre-line">
              {BINDING.sectionCopy.contact || CLIENT.content.ctaBody}
            </p>
            <p className="mt-4 text-[var(--grit-2)] max-w-2xl">
              This form prepares a draft on your device. It does not send your details.{' '}
              Prefer to talk? <a href={SITE.phoneHref} className="text-[var(--ink)] underline decoration-[var(--brand)] decoration-2 underline-offset-4 font-semibold">{SITE.phone}</a>.
            </p>
          </div>

          {/* Form body — 12-col ticket grid */}
          <form ref={formRef} onSubmit={onSubmit} className="p-6 sm:p-8 grid grid-cols-12 gap-4">
            <Field label="01 · Name *" className="col-span-12 sm:col-span-6">
              <input required name="name" className={inputCls} />
            </Field>
            <Field label="02 · Phone *" className="col-span-12 sm:col-span-6">
              <input required name="phone" inputMode="tel" className={inputCls} />
            </Field>
            <Field label="03 · Email" className="col-span-12 sm:col-span-7">
              <input name="email" type="email" className={inputCls} />
            </Field>
            <Field label="04 · ZIP" className="col-span-6 sm:col-span-2">
              <input name="zip" inputMode="numeric" className={inputCls} />
            </Field>
            <Field label="05 · Service" className="col-span-12 sm:col-span-3">
              <select name="service_type" defaultValue="" className={inputCls}>
                <option value="">Select…</option>
                {SERVICES.map((s) => <option key={s.slug} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="06 · Scope & site notes" className="col-span-12">
              <textarea name="message" rows={4} className={inputCls} placeholder="Footprint (sq ft), timeline, access, anything we should know." />
            </Field>
            <input tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" name="company_website" />

            {/* Footer action strip */}
            <div className="col-span-12 mt-2 pt-5 border-t border-dashed border-[var(--grit)] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-5 text-xs text-[var(--grit-2)]">
                <a href={SITE.phoneHref} className="flex items-center gap-2 hover:text-[var(--ink)]">
                  <span className="size-7 rounded-full bg-[var(--ink)] text-[var(--brand)] grid place-items-center text-xs">☎</span>
                  {SITE.phone}
                </a>
                {SITE.email && <a href={SITE.mailtoHref} className="hidden sm:flex items-center gap-2 hover:text-[var(--ink)] break-all">
                  <span className="size-7 rounded-full bg-[var(--ink)] text-[var(--brand)] grid place-items-center text-xs">@</span>
                  {SITE.email}
                </a>}
              </div>
              <button type="submit" className="bg-[var(--ink)] text-[var(--brand)] px-6 py-3 font-bold uppercase tracking-wider text-sm hover:bg-[var(--brand)] hover:text-[var(--ink)] disabled:opacity-50 transition rounded-sm">
                Prepare draft →
              </button>
            </div>

            {draft && <div className="col-span-12 text-sm" role="status">
              <p>Draft ready. Nothing has been sent. Call us{SITE.email ? ' or open your email app to send it' : ''}.</p>
              <pre className="whitespace-pre-wrap mt-3">{draft}</pre>
              {SITE.email && <a className="underline" href={`${SITE.mailtoHref}?subject=${encodeURIComponent('Project inquiry')}&body=${encodeURIComponent(draft)}`}>Open email draft →</a>}
            </div>}
          </form>
        </div>
      </div>
    </section>
  );
}

const inputCls = "w-full bg-[var(--paper)] border border-[var(--grit)] rounded-sm px-3 py-2.5 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] focus:ring-2 focus:ring-[var(--brand)]/30";

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--grit-2)] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function Footer() {
  return (
    <footer className="bg-[var(--ink)] text-white/70 border-t border-white/10">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <img src={CC_ASSETS.logo} alt={SITE.name} className="h-9 w-auto" loading="lazy" />
          </div>
          <p className="mt-3 text-sm">{SITE.name}</p>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand)] font-semibold">Services</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {SERVICES.map((s) => <li key={s.slug}><a href={s.href || `/#${s.slug}`} className="hover:text-white">{s.name}</a></li>)}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand)] font-semibold">Reach us</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href={SITE.phoneHref} className="hover:text-white">{SITE.phone}</a></li>
            {SITE.email && <li><a href={SITE.mailtoHref} className="hover:text-white break-all">{SITE.email}</a></li>}
            <li>{SITE.address.street}<br />{SITE.address.city}, {SITE.address.region} {SITE.address.postal}</li>
          </ul>
        </div>
        <div>
          {SITE.hours && <><div className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand)] font-semibold">Hours</div>
          <p className="mt-3 text-sm">{SITE.hours}</p></>}
          <a href="/#quote" className="inline-block mt-4 bg-[var(--brand)] text-[var(--ink)] px-4 py-2 rounded-md font-bold text-sm">Get a Quote</a>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-xs text-center text-white/40">
        © {new Date().getFullYear()} {SITE.name} · {SITE.address.city}, {SITE.address.region} ·{" "}
        <a href="/trust" className="hover:text-white underline-offset-2 hover:underline">Trust & Privacy</a>
      </div>
    </footer>
  );
}

export function StickyCta() {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--ink)]/95 backdrop-blur border-t border-white/10 px-4 py-2.5 flex gap-2">
      <a href={SITE.phoneHref} className="flex-1 text-center bg-white/10 text-white py-2.5 rounded-md font-semibold text-sm">Call</a>
      <a href="/#quote" className="flex-1 text-center bg-[var(--brand)] text-[var(--ink)] py-2.5 rounded-md font-bold text-sm">Get a Quote</a>
    </div>
  );
}
