import type { Service } from '@/lib/bridge';
import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, MessageSquare, Check } from "lucide-react";
import { business, services } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, ldFAQ, pageMeta } from "@/lib/seo";
const plasterImg = "";

const FAQS = faqsFor("plaster");

export const Route = createFileRoute("/plaster")({
  head: () => ({scripts: FAQS.length ? [jsonLdScript(ldFAQ(FAQS))] : [], meta: pageMeta({title: client.identity.businessName + " | plaster", description: serviceList("plaster").map(s=>s.description).join(" "), path: "/plaster"})}),
  component: PlasterPage,
});

export function PlasterPage({ selected }: { selected?: Service } = {}) {
 const chosen=serviceList("plaster",selected);
 const services={drywall:chosen.map(s=>s.description),plaster:chosen.map(s=>s.description),interiorPainting:chosen.filter(s=>!/exterior/i.test(s.name)).map(s=>s.description),exteriorPainting:chosen.filter(s=>/exterior/i.test(s.name)).map(s=>s.description)};
  if (!chosen.length) return <section className="mx-auto max-w-[1400px] px-6 py-24"><h1 className="font-display text-[44px]">Service unavailable</h1><Link to="/services">View available services</Link></section>;
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-12 grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <nav className="eyebrow"><Link to="/">Home</Link> / <Link to="/services">Services</Link> / <span className="text-ink">Plaster</span></nav>
            <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">{chosen.length===1?chosen[0].name:"Plaster"} <span className="italic">services.</span></h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-foreground/75">{chosen[0]?.description}</p>
          </div>
          <div className="lg:col-span-5">
            <div className="aspect-[4/3] overflow-hidden rounded-sm shadow-lift">
              {plasterImg && (<img src={plasterImg} alt="Hand-troweled plaster wall texture under warm light" className="h-full w-full object-cover" loading="lazy" width={1536} height={1024} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="eyebrow">Service scope</div>
            <h2 className="mt-3 font-display text-[36px] lg:text-[48px] text-ink leading-[1.04]">Service scope.</h2>
            <p className="mt-5 text-foreground/75 leading-relaxed"></p>
            <div className="mt-8 flex gap-3">
              <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-5 py-3 rounded-sm bg-ink text-bone"><Phone className="h-4 w-4 text-amber" /> {business.phone}</a>
              <a href="/contact" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm border border-border"><MessageSquare className="h-4 w-4" /> Contact</a>
            </div>
          </div>
          <ul className="lg:col-span-7 grid sm:grid-cols-2 gap-3">
            {services.plaster.map((s) => (
              <li key={s} className="flex gap-3 p-4 rounded-sm border border-border bg-card">
                <Check className="h-5 w-5 text-amber flex-shrink-0 mt-0.5" />
                <span className="text-[14.5px] text-foreground/85">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {FAQS.length > 0 && (<section className="bg-secondary/60 py-20 lg:py-28">
        <div className="mx-auto max-w-[1100px] px-6 lg:px-10">
          <div className="eyebrow">Plaster questions</div>
          <h2 className="mt-3 font-display text-[36px] lg:text-[48px] text-ink">What homeowners ask us most.</h2>
          <dl className="mt-10 grid gap-px bg-border rounded-sm overflow-hidden border border-border">
            {FAQS.map((f, i) => (
              <div key={i} className="bg-card p-7 grid lg:grid-cols-12 gap-4">
                <dt className="lg:col-span-5 font-display text-[20px] text-ink">{f.q}</dt>
                <dd className="lg:col-span-7 text-foreground/75 leading-relaxed text-[15px]">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>)}
    </>
  );
}
