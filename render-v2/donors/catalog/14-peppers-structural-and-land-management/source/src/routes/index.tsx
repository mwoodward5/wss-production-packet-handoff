import { site, showcase, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";











import { business, reviews, services, faqs } from "@/lib/business";
import { InlineLeadForm } from "@/components/site/InlineLeadForm";
import { FAQSchema } from "@/components/site/FAQSchema";
import { HeroFlagship } from "@/components/site/HeroFlagship";
import { HeroFAQMicro } from "@/components/site/HeroFAQMicro";
import { ServiceRouter } from "@/components/site/ServiceRouter";
import { LeadCTA } from "@/components/site/LeadCTA";





export function Home() {
  return (
    <>
      <FAQSchema faqs={faqs} />
      <HeroFlagship />
      <ServiceRouter />
      <HeroFAQMicro />
      <TrustStrip />
      <ServicesPreview />

      {/* CTA #1 — after services preview, momentum is high */}
      <LeadCTA variant="rail" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />

      <ProjectShowcase />

      {/* CTA #2 — after seeing real work, the natural impulse is "could you do mine?" */}
      <LeadCTA variant="banner" eyebrow="[ Project gallery ]" headline="Take a closer look." primary={{label:'Explore the gallery →',to:'/gallery'}} secondary={{label:'Discuss a project',to:'/contact'}} />

      <ProcessPanel />
      <InlineFormSection />
      <ReviewsBlock />

      {/* CTA #3 — after social proof, location-anchored quiet CTA */}
      <LeadCTA variant="quiet" eyebrow="[ Location ]" headline="Check your service area." primary={{label:'See locations →',to:'/service-area'}} />

      <ServiceArea />
      <FAQBlock />
      <FinalCTA />
    </>
  );
}

/* =============== UNUSED Stat (kept for reference) =============== */
function _Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-cream p-5">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-umber">{label}</p>
      <p className="mt-2 font-display text-xl text-ink leading-tight">{value}</p>
      <p className="mt-1 text-[11px] text-charcoal/60">{sub}</p>
    </div>
  );
}
void _Stat;

/* =============== PROJECT SHOWCASE =============== */
function ProjectShowcase() {
 if (!showcase.length) return null;
  return (
    <section className="bg-bone py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <div className="mb-12 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="eyebrow">[ Section 02 · Recent work ]</p>
            <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
              Our Craftsmanship <span className="italic-fraunces text-umber">in Action</span>.
            </h2>
            <p className="mt-4 max-w-xl text-charcoal/75"></p>
          </div>
          <Link to="/gallery" className="btn-ghost">Full gallery →</Link>
        </div>
        <div className="grid grid-cols-1 gap-px bg-rule lg:grid-cols-2">{showcase.slice(0,2).map((m,i)=><figure key={m.path} className="relative overflow-hidden bg-cream"><img src={m.path} alt={"Project photo " + (i+1)} width={1600} height={1000} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover"/><figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 to-transparent p-5"><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-glow">[ {String(i+1).padStart(2,'0')} ]</p></figcaption></figure>)}</div>
      </div>
    </section>
  );
}

/* =============== INLINE LEAD FORM SECTION =============== */
function InlineFormSection() {
  return (
    <section className="border-y border-rule bg-cream py-24 lg:py-32">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-5 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-5">
          <p className="eyebrow">[ Contact ]</p>
          <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
            Skip the form,<br />
            <span className="italic-fraunces text-umber">if you'd rather.</span>
          </h2>
          <p className="mt-6 max-w-md text-charcoal/75">Call or open your email app to discuss your project.</p>
          <a href={`tel:${business.phoneTel}`} className="btn-primary mt-8 inline-flex">
            ☎ {business.phone}
          </a>
        </div>
        <div className="lg:col-span-7">
          <InlineLeadForm
            heading="Or send a quick note."
            eyebrow="[ Project details ]"
          />
        </div>
      </div>
    </section>
  );
}

/* =============== TRUST STRIP =============== */
function TrustStrip() {
  const items = site.trust.badges.map(b=>b.label);
 if (!items.length) return null;
  return (
    <section className="overflow-hidden border-y border-rule bg-ink py-5 text-cream">
      <div className="marquee-track flex w-max gap-12 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.22em] text-cream/80">
        {[...items, ...items].map((item, i) => (
          <span key={i} className="flex items-center gap-3">
            <span aria-hidden className="text-amber-glow">◆</span>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

/* =============== SERVICES PREVIEW =============== */
function ServicesPreview() {
  return (
    <section className="bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-4">
            <p className="eyebrow">[ Section 01 · What we build ]</p>
            <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
              The work,<br />
              <span className="italic-fraunces text-umber">in plain words.</span>
            </h2>
            <p className="mt-6 max-w-md text-charcoal/75">{site.content.serviceIntro}</p>
            <Link to="/services" className="btn-ghost mt-8">
              See full service list →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:col-span-8 lg:grid-cols-3">
            {services.slice(0,6).map((s, i) => (
              <article key={s.slug} className="group relative aspect-[4/5] overflow-hidden bg-cream">
                {s.image && (<img
                  src={s.image}
                  alt={s.title}
                  width={800}
                  height={1000}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />)}
                <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/20 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-between p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/80">
                    [ {String(i + 1).padStart(2, "0")} ]
                  </p>
                  <div>
                    <h3 className="font-display text-2xl leading-tight text-cream"><Link to={s.href}>{s.title}</Link></h3>
                    <p className="mt-2 hidden text-sm text-cream/80 sm:block line-clamp-3">{s.summary}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =============== PROCESS =============== */
function ProcessPanel() {
  const steps: {n:string;title:string;body:string}[] = [];
 if (!steps.length) return null;
  return (
    <section className="border-t border-rule bg-bone py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <div className="mb-14 flex flex-col items-start gap-4">
          <p className="eyebrow">[ Section 03 · How it goes ]</p>
          <h2 className="font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
            Project <span className="italic-fraunces text-umber">steps</span>.
          </h2>
        </div>
        <ol className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s) => (
            <li key={s.n} className="bg-cream p-6 lg:p-8">
              <p className="numeral text-5xl">{s.n}</p>
              <h3 className="mt-6 font-display text-xl text-ink">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal/75">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* =============== REVIEWS =============== */
function ReviewsBlock() {
  const featured = reviews.slice(0, 3);
 if (!featured.length) return null;
  return (
    <section className="bg-cream py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <div className="mb-12 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="eyebrow">[ Section 04 · In their words ]</p>
            <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
              What clients <span className="italic-fraunces text-umber">actually</span> say.
            </h2>
            <p className="mt-4 max-w-xl text-charcoal/75"></p>
          </div>
          <Link to="/reviews" className="btn-ghost">All reviews →</Link>
        </div>

        <div className="grid gap-px bg-rule md:grid-cols-3">
          {featured.map((r) => (
            <article key={r.name} className="card-tactile p-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{r.rating !== null ? `${r.rating} / 5` : ""}</p>
              <p className="mt-4 font-display text-lg leading-snug italic text-ink">"{r.text}"</p>
              <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/60">{r.name} · <a href={r.sourceUrl}>Source</a></p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =============== SERVICE AREA =============== */
function ServiceArea() {
 if (!site.trust.areas.length) return null;
  return (
    <section className="relative overflow-hidden border-y border-rule bg-ink text-cream">
      
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/40" />
      <div className="relative mx-auto grid max-w-[1400px] gap-12 px-5 py-24 lg:grid-cols-12 lg:px-10 lg:py-32">
        <div className="lg:col-span-6">
          <p className="eyebrow text-amber-glow">[ Section 05 · Where we work ]</p>
          <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-cream lg:text-6xl">{business.city}, <span className="italic-fraunces text-amber-glow">{business.state}</span></h2>
          <p className="mt-6 max-w-lg text-cream/75">{pageCopy("service-area")}</p>
        </div>
        <div className="lg:col-span-6">
          <div className="grid grid-cols-2 gap-px bg-cream/15 text-cream sm:grid-cols-3">
            {site.trust.areas.map((city) => (
              <div key={city} className="bg-ink/60 p-4 backdrop-blur">
                <p className="font-display text-lg">{city}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-glow/70"></p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-cream/50"><a href={site.identity.phoneTel}>Call {business.phone} about your location.</a></p>
        </div>
      </div>
    </section>
  );
}

/* =============== FAQ =============== */
function FAQBlock() {
 if (!faqs.length) return null;
  return (
    <section className="bg-cream py-24 lg:py-32">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-5 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-4">
          <p className="eyebrow">[ Section 06 · Common questions ]</p>
          <h2 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-ink lg:text-6xl">
            Things people <span className="italic-fraunces text-umber">ask first</span>.
          </h2>
          <p className="mt-6 text-charcoal/70"></p>
        </div>
        <div className="divide-y divide-rule border-y border-rule lg:col-span-8">
          {faqs.map((f, i) => (
            <details key={f.q} className="group py-6" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <span className="font-display text-2xl text-ink">{f.q}</span>
                <span className="numeral mt-2 text-2xl group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-4 max-w-3xl text-pretty text-charcoal/80">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =============== FINAL CTA =============== */
function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-rule bg-bone py-24 lg:py-32">
      <div className="mx-auto max-w-[1100px] px-5 text-center lg:px-10">
        <p className="eyebrow justify-center">[ Section 07 · Contact ]</p>
        <h2 className="mt-6 font-display text-[clamp(2.75rem,7vw,6rem)] leading-[0.95] tracking-tight text-ink">
          You've thought about this <span className="italic-fraunces text-umber">long enough</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-charcoal/75">{site.content.ctaBody}</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link to="/contact" className="btn-primary">Request your estimate →</Link>
          <a href={`tel:${business.phoneTel}`} className="btn-ghost">☎ {business.phone}</a>
        </div>
      </div>
    </section>
  );
}
