import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute, Link, notFound, useRouterState } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { ContactForm } from "@/components/site/ContactForm";
import { ServiceSchema } from "@/components/site/Schema";

export const Route = createFileRoute('/services/$slug')({loader:({params})=>{const d=SERVICES.find(s=>s.slug===params.slug);if(!d) throw notFound();return d;},component:ServiceDetail});

function BreadcrumbsSchema({ name, slug }: { name: string; slug: string }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `https://${BUSINESS.domain}/` },
      { "@type": "ListItem", position: 2, name: "Services", item: `https://${BUSINESS.domain}/services` },
      { "@type": "ListItem", position: 3, name, item: `https://${BUSINESS.domain}/services/${slug}` },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export function ServiceDetail() {
  const path=useRouterState({select:s=>s.location.pathname});
  const d=SERVICES.find(s=>s.slug===path.split("/").filter(Boolean).at(-1));
  if(!d) return <section className="container-edge py-24"><h1 className="display-lg">Service not found</h1></section>;
  return (
    <>
      <ServiceSchema name={d.name} description={d.intro} />
      <BreadcrumbsSchema name={d.name} slug={d.service} />
      <section className="bg-bone pt-16 pb-12">
        <div className="container-edge">
          <Link to="/services" className="num-badge text-ink/50 hover:text-ink">← All services</Link>
          <div className="grid lg:grid-cols-12 gap-10 mt-6 items-end">
            <div className="lg:col-span-7">
              <h1 className="display-xl">{d.name}.</h1>
              <p className="mt-6 text-[18px] text-ink/70 max-w-xl leading-relaxed">{d.tagline}</p>
            </div>
            <div className="lg:col-span-5 num-badge text-ink/40">
              — Service · {BUSINESS.city}, {BUSINESS.state}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-bone pb-24">
        <div className="container-edge">
          <div className="aspect-[16/8] overflow-hidden frame-ink">
            {d.img && <img src={d.img} alt={d.name} width={1600} height={800} className="w-full h-full object-cover" />}
          </div>
          <div className="grid lg:grid-cols-12 gap-12 mt-16">
            <div className="lg:col-span-5">
              <p className="text-[16px] text-ink/75 leading-relaxed">{d.intro}</p>
            </div>
            <div className="lg:col-span-7 space-y-8">
              {d.bullets.map((b: { t: string; d: string }, i: number) => (
                <div key={b.t} className="border-t border-ink/10 pt-6 grid grid-cols-12 gap-4">
                  <div className="col-span-2 num-badge text-ink/40">— 0{i+1}</div>
                  <div className="col-span-10">
                    <h3 className="font-display text-2xl">{b.t}</h3>
                    <p className="mt-2 text-[15px] text-ink/70 leading-relaxed">{b.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-bone py-20">
        <div className="container-edge max-w-3xl">
          <div className="eyebrow text-volt mb-3">— Request {d.name.toLowerCase()}</div>
          <h2 className="display-lg text-bone mb-10">Tell us about your project.</h2>
          <div className="bg-bone text-ink p-8 md:p-10">
            <ContactForm defaultService={d.service} compact source={`services/${d.service}`} />
          </div>
        </div>
      </section>
    </>
  );
}
