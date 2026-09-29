import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { reviews, business } from "@/lib/business";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { ReviewsPageSchema } from "@/components/site/Schema";
import { LeadCTA } from "@/components/site/LeadCTA";



export function ReviewsPage() {
  return (
    <>
      <ReviewsPageSchema />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Reviews" }]} />
      <section className="border-b border-rule bg-cream py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <p className="eyebrow">[ Reviews ]</p>
          <h1 className="mt-4 display-xl text-[clamp(2.75rem,7vw,6rem)] text-ink">
            Word of mouth,<br />
            <span className="italic-fraunces text-umber">in writing.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-charcoal/80 text-pretty"></p>
        </div>
      </section>

      <section className="bg-cream py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <div className="grid gap-px bg-rule md:grid-cols-2">
            {reviews.map((r) => (
              <article key={r.name} className="card-tactile p-7 lg:p-9">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{r.rating !== null ? `${r.rating} / 5` : ""}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/60"><a href={r.sourceUrl}>Source</a></p>
                </div>
                <p className="mt-5 font-display text-xl leading-snug italic text-ink text-pretty">
                  "{r.text}"
                </p>
                <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/70">
                  — {r.name}
                </p>
              </article>
            ))}
          </div>

          {/* CTA — right after reading reviews, social-proof momentum is highest */}
          <div className="mt-10">
            <LeadCTA variant="card" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />
          </div>

          {site.trust.aggregate && site.trust.aggregate.rating !== null && site.trust.aggregate.count !== null && (<div className="mt-12 border border-rule bg-bone p-8 text-center"><a href={site.trust.aggregate.sourceUrl}>{site.trust.aggregate.rating} / 5 · {site.trust.aggregate.count} reviews</a></div>)}
        </div>
      </section>

      <section className="bg-cream py-24 text-center">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="font-display text-4xl text-ink lg:text-5xl">
            Ready to be the next one?
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link to="/contact" className="btn-primary">Request an estimate →</Link>
            <a href={`tel:${business.phoneTel}`} className="btn-ghost">☎ {business.phone}</a>
          </div>
        </div>
      </section>
    </>
  );
}
