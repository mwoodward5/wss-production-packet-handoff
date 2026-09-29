import {createFileRoute,Link,notFound} from '@tanstack/react-router';
import {BUSINESS} from '@/lib/business';
import {SITE,CLIENT,SERVICES} from '@/lib/wss';
import {ContactForm} from '@/components/site/ContactForm';
const LOCATIONS=SITE.areas;
export const Route=createFileRoute('/service-areas/$slug')({loader:({params})=>{const location=LOCATIONS.find(l=>l.slug===params.slug);if(!location) throw notFound();return {location};},component:LocationPage});
export function LocationPage() {
  const { location: loc } = Route.useLoaderData();

  const others = LOCATIONS.filter((l) => l.slug !== loc.slug);
  const locationLabel = loc.name;
  const sourceTag = `service-areas/${loc.slug}`;

  return (
    <>
      {/* Hero */}
      <section className="bg-bone pt-20 pb-16">
        <div className="container-edge">
          <nav className="text-[12px] uppercase tracking-[0.14em] text-ink/50 mb-6" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-ink">Home</Link>
            <span className="mx-2">/</span>
            <Link to="/service-areas" className="hover:text-ink">Service areas</Link>
            <span className="mx-2">/</span>
            <span className="text-ink">{loc.name}</span>
          </nav>

          <div className="num-badge text-ink/40 mb-3">— {BUSINESS.name}</div>
          <h1 className="display-xl max-w-4xl">
            {BUSINESS.name} · {loc.name}
          </h1>
          <p className="mt-6 max-w-2xl text-ink/70 text-lg leading-relaxed">
            Service area: {loc.name}.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <a href={`tel:${BUSINESS.phoneE164}`} className="btn-volt">
              Call {BUSINESS.phone}
            </a>
            <a href="#quote" className="btn-ghost-ink">
              Discuss a project →
            </a>
          </div>
        </div>
      </section>

      {CLIENT.trust.badges.length>0 && <section className="bg-ink text-bone py-8"><div className="container-edge grid gap-6 sm:grid-cols-3 text-[13px]">{CLIENT.trust.badges.map(b=><div key={b.label}><div className="eyebrow text-volt mb-1">{b.label}</div>{b.sublabel}</div>)}</div></section>}

      {/* Original per-trade directory geometry. No invented local execution claims. */}
      <section className="bg-bone py-20">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— Services</div>
          <h2 className="display-md max-w-3xl">Explore our services.</h2>
          <div className="mt-12 space-y-px bg-ink/10 border border-ink/10">
            {SERVICES.slice(0,4).map((s,i)=><article key={s.slug} className="bg-bone p-7 md:p-10 grid md:grid-cols-12 gap-6 md:gap-10">
              <div className="md:col-span-3"><div className="num-badge text-ink/40 mb-2">— 0{i+1}</div><h3 className="font-display text-2xl md:text-3xl">{s.name}</h3><div className="mt-1 text-[12px] uppercase tracking-[0.14em] text-ink/50">{s.shortLabel}</div></div>
              <div className="md:col-span-7"><p className="text-[15px] text-ink/75 leading-relaxed">{s.description}</p></div>
              <div className="md:col-span-2 md:text-right"><Link to="/services/$slug" params={{slug:s.slug}} className="text-[12px] uppercase tracking-[0.14em] text-ink/60 hover:text-ink underline underline-offset-4">Service detail →</Link></div>
            </article>)}
          </div>
          {BUSINESS.additionalServices.length>0 && <div className="mt-12 max-w-3xl"><div className="eyebrow text-ink/50 mb-3">— More services</div><ul className="flex flex-wrap gap-2">{BUSINESS.additionalServices.map(s=><li key={s} className="border border-ink/20 px-3 py-1.5 text-[12px] uppercase tracking-[0.1em]">{s}</li>)}</ul></div>}
        </div>
      </section>

      {/* Direct contact actions in the original booking card. */}
      <section id="quote" className="bg-ink text-bone py-20 scroll-mt-24">
        <div className="container-edge max-w-3xl">
          <div className="eyebrow text-volt mb-3">— Request a quote · {loc.name}</div>
          <h2 className="display-lg text-bone mb-3">
            Tell us about your {loc.name} project.
          </h2>
          <p className="text-bone/65 mb-10 max-w-xl">
            Contact {BUSINESS.name} about your project in {loc.name}.
          </p>
          <div className="bg-bone text-ink p-8 md:p-10">
            <ContactForm
              compact
              locationSlug={loc.slug}
              locationLabel={locationLabel}
              source={sourceTag}
            />
          </div>
        </div>
      </section>

      {/* Other areas */}
      <section className="bg-bone py-16">
        <div className="container-edge">
          <div className="eyebrow text-ink/50 mb-5">— Also serving</div>
          <div className="flex flex-wrap gap-3">
            {others.map((o) => (
              <Link
                key={o.slug}
                to="/service-areas/$slug"
                params={{ slug: o.slug }}
                className="border border-ink/20 px-4 py-2 text-[13px] hover:bg-ink hover:text-bone transition-colors"
              >
                {o.name} →
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
