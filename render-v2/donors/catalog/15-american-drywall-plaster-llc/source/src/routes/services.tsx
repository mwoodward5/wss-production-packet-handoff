import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Hammer, Layers, PaintRoller, Wrench, Phone } from "lucide-react";
import { business, services } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/services")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | services", description: client.content.serviceIntro, path: "/services"})}),
  component: ServicesPage,
});

function ServicesPage() {
  return (
    <>
      <PageHeader />
      <PillarGrid />
      <FullList />
      <CTA />
    </>
  );
}

function PageHeader() {
  return (
    <section className="bg-bone border-b border-border">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-16 lg:pb-20">
        <nav className="eyebrow flex items-center gap-2"><Link to="/">Home</Link> <span>/</span> <span className="text-ink">Services</span></nav>
        <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">Our <span className="italic">services.</span></h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-foreground/75">{client.content.serviceIntro}</p>
      </div>
    </section>
  );
}

function PillarGrid() {
  const pillars = client.services.map((s,i)=>({to:serviceHref(s),icon:[Hammer,Layers,PaintRoller,Wrench][i%4],title:s.name,lead:s.description}));
  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid sm:grid-cols-2 gap-px bg-border rounded-sm overflow-hidden border border-border">
        {pillars.map((p) => (
          <Link key={p.title} to={p.to} className="group bg-card p-8 lg:p-10 hover:bg-secondary transition-colors">
            <p.icon className="h-8 w-8 text-ink" strokeWidth={1.4} />
            <h2 className="mt-6 font-display text-[28px] text-ink">{p.title}</h2>
            <p className="mt-3 text-foreground/70">{p.lead}</p>
            <div className="mt-6 inline-flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.2em] text-ink group-hover:text-amber">
              View details <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FullList() {
  const groups = client.services.map(s=>({title:s.name,items:[s.description]}));
  return (
    <section className="bg-secondary/60 py-20 lg:py-28">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10">
        <div className="eyebrow">Full capability list</div>
        <h2 className="mt-3 font-display text-[36px] lg:text-[48px] text-ink">Every line item, in plain English.</h2>
        <div className="mt-12 grid lg:grid-cols-2 gap-8">
          {groups.map((g) => (
            <div key={g.title} className="bg-card border border-border rounded-sm p-7">
              <h3 className="font-display text-[22px] text-ink">{g.title}</h3>
              <ul className="mt-4 grid gap-2.5">
                {g.items.map((s) => (
                  <li key={s} className="flex gap-3 text-[14.5px] text-foreground/80">
                    <span className="mt-2 h-1 w-3 bg-amber flex-shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-[1100px] px-6 lg:px-10 text-center">
        <h2 className="font-display text-[36px] lg:text-[52px] text-ink leading-[1.05]">Not sure which service you need?</h2>
        <p className="mt-4 text-foreground/75">{client.content.ctaBody}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-ink text-bone font-medium">
            <Phone className="h-4 w-4 text-amber" /> {business.phone}
          </a>
          <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-amber text-ink font-semibold">Contact</Link>
        </div>
      </div>
    </section>
  );
}
