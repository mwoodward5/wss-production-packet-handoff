import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { InlineLeadForm } from "@/components/site/InlineLeadForm";
import { ServiceAreaSchema } from "@/components/site/Schema";
import { LocationMap } from "@/components/site/LocationMap";
import { AEOFaqBlock } from "@/components/site/AEOFaqBlock";


import { business } from "@/lib/business";


const towns = site.trust.areas.map(name=>({name,note:""}));





export function ServiceAreaPage() {
  return (
    <>
      <ServiceAreaSchema />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Service Area" }]} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-ink text-cream">
        
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/40" />
        <div className="relative mx-auto max-w-[1400px] px-5 py-20 lg:px-10 lg:py-32">
          <p className="eyebrow text-amber-glow">[ Where we work ]</p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.95] tracking-tight text-cream">
            {business.city},<br/><span className="italic-fraunces text-amber-glow">{business.state}</span>
          </h1>
          {pageCopy('service-area') && <p className="mt-6 max-w-2xl text-lg text-cream/80">{pageCopy('service-area')}</p>}
        </div>
      </section>

      {/* Counties */}
      

      {/* Towns grid */}
      {towns.length > 0 && <section className="bg-bone py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className="eyebrow">[ Towns we work in ]</p>
              <h2 className="mt-3 font-display text-4xl leading-tight text-ink lg:text-5xl">Service <span className="italic-fraunces text-umber">areas</span>.</h2>
            </div>
            <p className="max-w-md text-sm text-charcoal/75">Call {business.phone} about your location.</p>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 lg:grid-cols-4">
            {towns.map((t) => (
              <div key={t.name} className="flex flex-col bg-cream p-5">
                <p className="font-display text-xl text-ink">{t.name}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{t.note}</p>
                <Link
                  to="/contact"
                  search={{ city: t.name }}
                  className="mt-3 link-underline font-mono text-[10px] uppercase tracking-[0.22em] text-ink"
                >
                  Estimate for {t.name} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>}

      <LocationMap />

      {/* Per-city AEO / voice-search FAQs — one block per county hub */}
      

      {/* Lead form */}
      <section className="border-t border-rule bg-cream py-20">
        <div className="mx-auto max-w-[900px] px-5 lg:px-10">
          <InlineLeadForm
            heading="Tell us where you are. We'll tell you if we're a fit."
            eyebrow="[ Local check ]"
          />
        </div>
      </section>

      {/* Cross-link */}
      <section className="border-t border-rule bg-bone py-16 text-center">
        <Link to="/services" className="btn-ghost">See what we build →</Link>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-charcoal/50">{business.city}, {business.state}</p>
      </section>
    </>
  );
}
