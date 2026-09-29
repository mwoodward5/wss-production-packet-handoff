import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { FAQSchema } from "@/components/site/FAQSchema";
import { InlineLeadForm } from "@/components/site/InlineLeadForm";
import { LeadCTA } from "@/components/site/LeadCTA";
import { faqs, business } from "@/lib/business";



const allFaqs = faqs;



export function FAQPage() {
  return (
    <>
      <FAQSchema faqs={allFaqs} />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "FAQ" }]} />

      <section className="bg-cream">
        <div className="mx-auto max-w-[1400px] px-5 pb-12 pt-12 lg:grid lg:grid-cols-12 lg:gap-12 lg:px-10 lg:pb-16 lg:pt-20">
          <div className="lg:col-span-6">
            <p className="eyebrow">[ Common questions ]</p>
            <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,6rem)] leading-[0.95] tracking-tight text-ink">
              Asked <span className="italic-fraunces text-umber">first</span>,
              answered <span className="italic-fraunces text-umber">honestly</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-charcoal/80">Contact us if your question is not answered here.</p>
          </div>
          <div className="mt-8 lg:col-span-6 lg:mt-0">
            <div className="border border-rule bg-bone p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">[ Quick answers ]</p>
              <ul className="mt-4 space-y-3 text-sm text-charcoal/85">{faqs.slice(0,3).map(f=><li key={f.q}><span className="font-medium text-ink">{f.q}</span> {f.a}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA — between at-a-glance answers and the long FAQ list */}
      <LeadCTA variant="quiet" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />

      <section className="border-t border-rule bg-bone py-16 lg:py-24">
        <div className="mx-auto max-w-[1100px] px-5 lg:px-10">
          <div className="divide-y divide-rule border-y border-rule">
            {allFaqs.map((f, i) => (
              <details key={f.q} className="group py-6" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                  <span className="font-display text-2xl text-ink lg:text-3xl">{f.q}</span>
                  <span className="numeral mt-2 text-2xl group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-4 max-w-3xl text-pretty text-charcoal/80">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-rule bg-cream py-20">
        <div className="mx-auto max-w-[900px] px-5 lg:px-10">
          <InlineLeadForm
            heading="Still have questions?"
            eyebrow="[ Contact ]"
          />
          <p className="mt-6 text-center text-sm text-charcoal/70">
            Or call <a href={`tel:${business.phoneTel}`} className="link-underline font-medium">{business.phone}</a>{" "}
            
          </p>
          <p className="mt-6 text-center">
            <Link to="/services" className="font-mono text-[11px] uppercase tracking-[0.22em] text-charcoal hover:text-ink">
              See all services →
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
