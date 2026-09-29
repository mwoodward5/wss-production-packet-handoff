import type { Service } from '@/lib/bridge';
import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, MessageSquare, Check } from "lucide-react";
import { business, services } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";
const interiorImg = "";

export const Route = createFileRoute("/painting")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | painting", description: serviceList("painting").map(s=>s.description).join(" "), path: "/painting"})}),
  component: PaintingPage,
});

export function PaintingPage({ selected }: { selected?: Service } = {}) {
 const chosen=serviceList("painting",selected);
 const services={drywall:chosen.map(s=>s.description),plaster:chosen.map(s=>s.description),interiorPainting:chosen.filter(s=>!/exterior/i.test(s.name)).map(s=>s.description),exteriorPainting:chosen.filter(s=>/exterior/i.test(s.name)).map(s=>s.description)};
  if (!chosen.length) return <section className="mx-auto max-w-[1400px] px-6 py-24"><h1 className="font-display text-[44px]">Service unavailable</h1><Link to="/services">View available services</Link></section>;
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-12 grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <nav className="eyebrow"><Link to="/">Home</Link> / <Link to="/services">Services</Link> / <span className="text-ink">Painting</span></nav>
            <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">{chosen.length===1?chosen[0].name:"Painting"} <span className="italic">services.</span></h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-foreground/75">{chosen[0]?.description}</p>
          </div>
          <div className="lg:col-span-5">
            <div className="aspect-[4/3] overflow-hidden rounded-sm shadow-lift">
              {interiorImg && (<img src={interiorImg} alt="Interior of a freshly finished home with smooth white walls" className="h-full w-full object-cover" loading="lazy" width={1920} height={1280} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid lg:grid-cols-2 gap-10">
          {services.interiorPainting.length>0 && (<div className="bg-card border border-border rounded-sm p-8">
            <h2 className="font-display text-[28px] text-ink">Painting services</h2>
            <ul className="mt-5 grid gap-2.5">
              {services.interiorPainting.map((s) => (
                <li key={s} className="flex gap-3 text-[14.5px] text-foreground/80">
                  <Check className="h-4 w-4 text-amber mt-1 flex-shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>)}
          {services.exteriorPainting.length>0 && (<div className="bg-card border border-border rounded-sm p-8">
            <h2 className="font-display text-[28px] text-ink">Exterior Painting</h2>
            <ul className="mt-5 grid gap-2.5">
              {services.exteriorPainting.map((s) => (
                <li key={s} className="flex gap-3 text-[14.5px] text-foreground/80">
                  <Check className="h-4 w-4 text-amber mt-1 flex-shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>)}
        </div>

        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 mt-12 flex flex-wrap gap-3 justify-center">
          <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-ink text-bone"><Phone className="h-4 w-4 text-amber" /> {business.phone}</a>
          <a href="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm border border-border"><MessageSquare className="h-4 w-4" /> Contact us</a>
          <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-amber text-ink font-semibold">Contact</Link>
        </div>
      </section>
    </>
  );
}
