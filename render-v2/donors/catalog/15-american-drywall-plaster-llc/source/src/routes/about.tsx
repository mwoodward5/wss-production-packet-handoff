import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, ShieldCheck, Heart, Hammer } from "lucide-react";
import { business } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";
const heroImg = aboutPhoto?.path || "";

export const Route = createFileRoute("/about")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | about", description: client.content.about, path: "/about"})}),
  component: AboutPage,
});

function AboutPage() {
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-16 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">About</span></nav>
            <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">About <span className="italic">{client.identity.businessName}.</span></h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-foreground/75">{pageCopy("about",client.content.about)}</p>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-foreground/75"></p>
          </div>
          <div className="lg:col-span-5 relative">
            <div className="aspect-[3/4] overflow-hidden rounded-sm shadow-lift">
              {heroImg && (<img src={heroImg} alt={client.identity.businessName + " — company photo"} className="h-full w-full object-cover" loading="lazy" />)}
            </div>
          </div>
        </div>
      </section>

      {client.content.values.length > 0 && (<section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid md:grid-cols-3 gap-px bg-border rounded-sm overflow-hidden border border-border">
          {client.content.values.map(v=>({icon:Heart,t:v.title,d:v.body})).map((v) => (
            <div key={v.t} className="bg-card p-8">
              <v.icon className="h-7 w-7 text-amber" strokeWidth={1.5} />
              <h3 className="mt-5 font-display text-[22px] text-ink">{v.t}</h3>
              <p className="mt-3 text-foreground/70 text-[14.5px] leading-relaxed">{v.d}</p>
            </div>
          ))}
        </div>
      </section>)}

      <section className="bg-secondary py-20 lg:py-28 border-t border-border">
        <div className="mx-auto max-w-[1100px] px-6 lg:px-10 text-center">
          <h2 className="font-display text-[36px] lg:text-[56px] text-ink">Talk to the people doing the work.</h2>
          <p className="mt-5 text-foreground/75">{client.content.ctaBody}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-amber text-ink font-semibold">
              <Phone className="h-4 w-4" /> {business.phone}
            </a>
            <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm border border-ink/25 text-ink">Send a message</Link>
          </div>
        </div>
      </section>
    </>
  );
}
