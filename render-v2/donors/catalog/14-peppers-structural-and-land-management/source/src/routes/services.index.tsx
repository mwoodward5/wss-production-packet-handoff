import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { LeadCTA } from "@/components/site/LeadCTA";







import { services, business } from "@/lib/business";





export function ServicesPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Services" }]} />
      <section className="border-b border-rule bg-cream py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <p className="eyebrow">[ Services ]</p>
          <h1 className="mt-4 display-xl text-[clamp(2.75rem,7vw,6rem)] text-ink">The work,<br/><span className="italic-fraunces text-umber">in plain words.</span></h1>
          <p className="mt-8 max-w-2xl text-lg text-charcoal/80 text-pretty">{site.content.serviceIntro}</p>
        </div>
      </section>

      <section className="bg-cream py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <div className="grid gap-px bg-rule lg:grid-cols-2">
            {services.map((s, i) => (
              <article key={s.slug} className="bg-cream p-6 lg:p-10">
                <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
                  <div className="relative aspect-[4/3] overflow-hidden bg-bone">
                    {s.image && (<img
                      src={s.image}
                      alt={s.title}
                      width={800} height={600}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />)}
                  </div>
                  <div className="flex flex-col">
                    <p className="numeral text-3xl">{String(i + 1).padStart(2, "0")}</p>
                    <h2 className="mt-3 font-display text-3xl text-ink">{s.title}</h2>
                    <p className="mt-4 text-charcoal/80 text-pretty">{s.summary}</p>
                    <Link to={s.href} className="mt-auto pt-6">
                      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-umber link-underline">
                        See {s.title.toLowerCase()} details →
                      </span>
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <LeadCTA variant="rail" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />

      

      <LeadCTA variant="card" eyebrow="[ Project details ]" headline="Which service fits your project?" primary={{label:'Use the service matcher →',to:'/'}} secondary={{label:'Contact',to:'/contact'}} />

      <section className="bg-cream py-24 text-center">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="font-display text-4xl text-ink lg:text-5xl">
            Ready to discuss your project?
          </h2>
          <Link to="/contact" className="btn-primary mt-8">Request your estimate →</Link>
        </div>
      </section>
    </>
  );
}
