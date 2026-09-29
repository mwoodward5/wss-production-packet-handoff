import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";


import { business } from "@/lib/business";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { LeadCTA } from "@/components/site/LeadCTA";



export function AboutPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "About" }]} />
      <section className="relative overflow-hidden border-b border-rule bg-cream">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-5 py-20 lg:grid-cols-12 lg:gap-12 lg:px-10 lg:py-28">
          <div className="lg:col-span-7">
            <p className="eyebrow">[ About ]</p>
            <h1 className="mt-4 display-xl text-[clamp(2.75rem,7vw,6rem)] text-ink">{business.name}</h1>
            <p className="mt-8 max-w-xl text-lg text-charcoal/80 text-pretty whitespace-pre-line">{pageCopy('about') || site.content.about}</p>
            
          </div>
          {aboutImage && (<div className="relative lg:col-span-5">
            <div className="relative aspect-[4/5] overflow-hidden">
              <img
                src={aboutImage.path}
                alt={business.name}
                width={1200} height={1500}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/80">{business.city}, {business.state}</p>
              </div>
            </div>
          </div>)}
        </div>
      </section>

      {site.content.values.length > 0 && (<section className="bg-bone py-24">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-5 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-4">
            <p className="eyebrow">[ The principles ]</p>
            <h2 className="mt-4 font-display text-4xl text-ink lg:text-5xl">
              How we <span className="italic-fraunces text-umber">work</span>.
            </h2>
          </div>
          <div className="grid gap-px bg-rule lg:col-span-8 sm:grid-cols-2">
            {site.content.values.map(v=>({t:v.title,b:v.body})).map((p) => (
              <div key={p.t} className="bg-cream p-7">
                <h3 className="font-display text-xl text-ink">{p.t}</h3>
                <p className="mt-3 text-charcoal/75">{p.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>)}

      {/* CTA — after the principles, ask for a small commitment */}
      <LeadCTA variant="rail" eyebrow="[ Contact ]" headline={site.content.ctaHeadline || 'Discuss your project.'} subline={site.content.ctaBody || undefined} primary={{label:'Contact →',to:'/contact'}} secondary={{label:'Call',tel:true}} />

      <section className="relative overflow-hidden border-y border-rule bg-ink text-cream">
        
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/60" />
        <div className="relative mx-auto grid max-w-[1400px] gap-10 px-5 py-24 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-7">
            <p className="eyebrow text-amber-glow">[ The place ]</p>
            <h2 className="mt-4 font-display text-4xl text-cream lg:text-5xl">{business.city}, <span className="italic-fraunces text-amber-glow">{business.state}</span></h2>
            <p className="mt-6 max-w-xl text-cream/75 text-pretty">{pageCopy("service-area")}</p>
          </div>
          <div className="grid grid-cols-2 gap-6 lg:col-span-5">{business.yearFounded && <Stat label="Founded" value={String(business.yearFounded)} />}</div>
        </div>
      </section>

      <section className="bg-cream py-24 text-center">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="font-display text-4xl text-ink lg:text-5xl">Bring us your project.</h2>
          
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link to="/contact" className="btn-primary">Request an estimate →</Link>
            <a href={`tel:${business.phoneTel}`} className="btn-ghost">☎ {business.phone}</a>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-cream/15 bg-ink/40 p-5 backdrop-blur">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-glow/80">{label}</p>
      <p className="mt-2 font-display text-2xl text-cream">{value}</p>
    </div>
  );
}
