import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { services, business } from "@/lib/business";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { InlineLeadForm } from "@/components/site/InlineLeadForm";
import { ServiceSchema } from "@/components/site/Schema";
import { AEOFaqBlock, type AEOFaq } from "@/components/site/AEOFaqBlock";

import { LeadCTA } from "@/components/site/LeadCTA";














export function ServiceDetail() {
  const slug = window.location.pathname.split("/").filter(Boolean).pop();
  const service = services.find((s) => s.slug === slug)!;
  const detail = {lede:service.detail,bullets:[] as string[],quote:""};
  const img = service.image;
  const formService = service.title;

  // Voice-search / AEO FAQs: service-specific bank + a "do you serve here?" question.
  
  const localFaqs: ReadonlyArray<AEOFaq> = [];

  return (
    <>
      <ServiceSchema
        name={service.title}
        description={detail.lede}
        slug={service.slug}
        image={img}
      />
      <Breadcrumbs items={[
        { label: "Home", to: "/" },
        { label: "Services", to: "/services" },
        { label: service.title },
      ]} />

      {/* Hero */}
      <section className="bg-cream">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-5 pb-16 pt-12 lg:grid-cols-12 lg:gap-12 lg:px-10 lg:pb-24 lg:pt-20">
          <div className="lg:col-span-7">
            <p className="eyebrow">[ Service · {service.title} ]</p>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.95] tracking-tight text-ink">
              {service.title} in <span className="italic-fraunces text-umber">{business.city}, {business.state}</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-charcoal/80">{detail.lede}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/contact" search={{service:formService}} className="btn-primary">Discuss this service →</Link>
              <a href={site.identity.phoneTel} className="btn-ghost">☎ {business.phone}</a>
            </div>
          </div>
          <div className="relative lg:col-span-5">
            {img && <img src={img} alt={service.title} width={1200} height={1500} loading="eager" fetchPriority="high" decoding="async" className="aspect-[4/5] w-full object-cover"/>}
          </div>
        </div>
      </section>

      {/* What's included */}
      {detail.bullets.length > 0 && (<section id="whats-included" className="border-t border-rule bg-bone py-20 lg:py-28">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-5 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-5">
            <p className="eyebrow">[ What's included ]</p>
            <h2 className="mt-4 font-display text-4xl leading-tight text-ink lg:text-5xl">
              The work, <span className="italic-fraunces text-umber">specifically</span>.
            </h2>
            <p className="mt-5 max-w-md text-charcoal/75"></p>
          </div>
          <ul className="grid gap-4 lg:col-span-7 sm:grid-cols-2">
            {detail.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 border border-rule bg-cream p-5">
                <span aria-hidden className="mt-0.5 text-amber-glow">◆</span>
                <span className="text-sm text-ink">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>)}

      {/* CTA — between scope and pricing-conscious form. Service-specific microcopy. */}
      <LeadCTA variant="rail" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />

      <section className="border-t border-rule bg-cream py-20 lg:py-28">
        <div className="mx-auto max-w-[900px] px-5 lg:px-10">
          <InlineLeadForm
            defaultService={formService}
            heading={`Discuss ${service.title.toLowerCase()}.`}
          />
        </div>
      </section>

      {/* FAQs */}
      

      {/* Cross-link */}
      <section className="border-t border-rule bg-cream py-16">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <p className="eyebrow">[ Other services ]</p>
          <div className="mt-6 grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-5">
            {services.filter((s) => s.slug !== slug).slice(0, 5).map((s) => (
              <Link
                key={s.slug}
                to={s.href}
                className="bg-cream p-5 hover:bg-bone"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">→</p>
                <p className="mt-2 font-display text-lg text-ink">{s.title}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
