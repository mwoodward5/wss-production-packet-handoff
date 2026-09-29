import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { InlineLeadForm } from "@/components/site/InlineLeadForm";
import { LeadCTA } from "@/components/site/LeadCTA";

















const projects = gallery.map((m,i)=>({img:m.path,title:`Plate ${String(i+1).padStart(2,"0")}`,caption:""}));



export function GalleryPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Gallery" }]} />

      <section className="bg-cream">
        <div className="mx-auto max-w-[1400px] px-5 pb-8 pt-8 lg:px-10 lg:pb-10 lg:pt-12">
          <p className="eyebrow">[ Project gallery · Real client work ]</p>
          <h1 className="mt-3 font-display text-[clamp(2.25rem,6vw,5rem)] leading-[0.95] tracking-tight text-ink">
            From Blueprint to <span className="italic-fraunces text-umber">Beautiful Home.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-charcoal/80 lg:text-lg"></p>
        </div>
      </section>

      <section className="bg-cream pb-16 lg:pb-20">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3">
            {projects.map((p, i) => (
              <figure key={i} className="group relative overflow-hidden bg-bone">
                <img
                  src={p.img}
                  alt={p.title}
                  width={1100}
                  height={825}
                  loading={i < 4 ? "eager" : "lazy"}
                  decoding="async"
                  className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-glow">
                    [ {String(i + 1).padStart(2, "0")} ]
                  </p>
                  <p className="mt-0.5 font-display text-sm text-cream lg:text-base">{p.title}</p>
                  <p className="mt-0.5 hidden text-[11px] text-cream/75 sm:block">{p.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-rule bg-bone py-16 lg:py-20">
        <div className="mx-auto max-w-[900px] px-5 lg:px-10">
          <InlineLeadForm
            heading="Have a project like one of these?"
            eyebrow="[ Start a conversation ]"
          />
        </div>
      </section>

      <LeadCTA variant="banner" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />
    </>
  );
}
