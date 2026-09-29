import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { ContactForm } from "@/components/site/ContactForm";

export const Route = createFileRoute("/services")({
  component: ServicesPage,
});

export function ServicesPage() {
  const pathname=useRouterState({select:s=>s.location.pathname});
  if(pathname.replace(/\/$/,'')!=='/services') return <Outlet/>;
  return (
    <>
      <section className="bg-bone pt-20 pb-16">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— Services</div>
          <h1 className="display-xl max-w-4xl">Services for your home.</h1>
          <p className="mt-8 max-w-2xl text-[17px] text-ink/70 leading-relaxed">
            {CLIENT.content.serviceIntro}
          </p>
        </div>
      </section>

      <section className="bg-bone pb-24">
        <div className="container-edge space-y-24 lg:space-y-32">
          {SERVICES.slice(0,4).map((s, i) => (
            <div key={s.slug} className={`grid lg:grid-cols-12 gap-10 items-center ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
              <div className="lg:col-span-7">
                <div className="aspect-[16/10] overflow-hidden frame-ink">
                  {s.img && <img src={s.img} alt={s.name} width={1280} height={800} loading="lazy" className="w-full h-full object-cover"/>}
                </div>
              </div>
              <div className="lg:col-span-5">
                <div className="num-badge text-ink/40 mb-3">— 0{i+1} / {Math.min(SERVICES.length,4)}</div>
                <h2 className="display-lg">{s.name}</h2>
                <ul className="mt-6 space-y-3">
                  {s.lines.map(l => (
                    <li key={l} className="flex items-start gap-3 text-[15px] text-ink/75">
                      <span className="mt-2 w-2 h-2 bg-volt shrink-0"/>{l}
                    </li>
                  ))}
                </ul>
                <Link to="/services/$slug" params={{ slug: s.slug }} className="mt-8 btn-ghost-ink">More on {s.name.toLowerCase()} →</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {BUSINESS.additionalServices.length>0 && <section className="bg-ink text-bone py-20">
        <div className="container-edge grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="eyebrow text-volt mb-3">— Also available</div>
            <h2 className="display-lg text-bone">More services.</h2>
          </div>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-[15px] text-bone/85">
            {SERVICES.slice(4).map(s => (
              <li key={s.slug} className="flex items-center gap-3"><span className="w-1.5 h-1.5 bg-volt"/><Link to="/services/$slug" params={{slug:s.slug}}>{s.name}</Link></li>
            ))}
          </ul>
        </div>
      </section>

      }
      <section className="bg-bone py-24">
        <div className="container-edge max-w-3xl">
          <div className="num-badge text-ink/40 mb-3">— Start a project</div>
          <h2 className="display-lg mb-10">Tell us what you have in mind.</h2>
          <ContactForm source="services-index" />
        </div>
      </section>
    </>
  );
}
