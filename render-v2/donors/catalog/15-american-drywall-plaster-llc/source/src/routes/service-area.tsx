import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, Phone } from "lucide-react";
import { business, serviceAreas } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/service-area")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | service-area", description: client.hero.support, path: "/service-area"})}),
  component: ServiceAreaPage,
});

function ServiceAreaPage() {
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-16">
          <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">Service Area</span></nav>
          <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">Where we work, <span className="italic">in plain English.</span></h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-foreground/75">{pageCopy("service-area", client.trust.areas.join(", "))}</p>
        </div>
      </section>

      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="eyebrow">Service areas</div>
            <h2 className="mt-3 font-display text-[36px] lg:text-[44px] text-ink">Areas we serve.</h2>
            <p className="mt-5 text-foreground/75 leading-relaxed">Contact us to discuss your project location.</p>
            <a href={`tel:${business.phoneRaw}`} className="mt-7 inline-flex items-center gap-2 px-5 py-3 rounded-sm bg-ink text-bone">
              <Phone className="h-4 w-4 text-amber" /> {business.phone}
            </a>
          </div>
          <div className="lg:col-span-7">
            {client.trust.mapUrl && <a href={client.trust.mapUrl} className="inline-flex mb-6 px-5 py-3 border border-border rounded-sm">Map and directions</a>}
            <ul className="grid sm:grid-cols-2 gap-3">
              {serviceAreas.map((c) => (
                <li key={c} className="flex items-center gap-3 p-4 rounded-sm border border-border bg-card">
                  <MapPin className="h-4 w-4 text-amber" />
                  <span className="text-[15px] text-ink">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-secondary py-16 border-t border-border">
        <div className="mx-auto max-w-[1100px] px-6 lg:px-10 text-center">
          <div className="eyebrow">Local-first</div>
          <h2 className="mt-3 font-display text-[28px] lg:text-[40px] text-ink">{client.identity.city}, {client.identity.state}</h2>
          <p className="mt-4 text-foreground/75 max-w-2xl mx-auto">{client.trust.areas.join(", ")}</p>
        </div>
      </section>
    </>
  );
}
