import { aggregate, client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { business, testimonials } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/reviews")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | reviews", description: client.hero.support, path: "/reviews"})}),
  component: ReviewsPage,
});

function ReviewsPage() {
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-16">
          <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">Reviews</span></nav>
          <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">Reviews from <span className="italic">real customers.</span></h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-foreground/75">{testimonials.length ? "Reviews and their source links." : "No reviews have been supplied."}</p>
          {aggregate && <a href={aggregate.sourceUrl} className="inline-flex mt-6 px-4 py-3 border border-border rounded-sm">{aggregate.rating} / 5 · {aggregate.count} reviews</a>}
        </div>
      </section>

      {testimonials.length > 0 && (<section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid md:grid-cols-2 gap-6">
          {testimonials.map((t, i) => (
            <figure key={i} className="bg-card border border-border rounded-sm p-8 shadow-soft">
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm bg-secondary text-ink/80 font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber" /> Originally posted on {t.platform}
              </span>
              <blockquote className="mt-5 text-[16px] leading-relaxed text-foreground/85">“{t.quote}”</blockquote>
              <figcaption className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <span className="font-display text-[18px] text-ink">{t.name}</span>
                <span className="eyebrow !text-[10px]">via <a href={t.sourceUrl} target="_blank" rel="noreferrer">{t.platform}</a></span>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 mt-16">
          <div className="bg-ink text-bone p-8 lg:p-12 rounded-sm grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="font-display text-[28px] lg:text-[36px] text-bone">Client profiles</h2>
              <p className="mt-3 text-bone/70"></p>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">{client.trust.socials.map(url=><a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex px-3 py-2 rounded-sm border border-bone/20">{new URL(url).hostname}</a>)}</div>
          </div>
        </div>
      </section>)}
    </>
  );
}
