import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
const LOCATIONS=SITE.areas;

export const Route = createFileRoute("/service-areas/")({
  component: ServiceAreasPage,
});

export function ServiceAreasPage() {
  return (
    <>
      <section className="bg-bone pt-20 pb-12">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— Service areas</div>
          <h1 className="display-xl max-w-3xl">
            Service areas.
          </h1>
          <p className="mt-6 max-w-2xl text-ink/70 text-lg leading-relaxed">
            {PLAN.content?.["service-area"] || "Contact us to confirm coverage for your project."}
          </p>
        </div>
      </section>

      <section className="bg-bone pb-28">
        <div className="container-edge">
          <div className="grid gap-px bg-ink/10 border border-ink/10 sm:grid-cols-2 lg:grid-cols-3">
            {LOCATIONS.map((loc) => (
              <Link
                key={loc.slug}
                to="/service-areas/$slug"
                params={{ slug: loc.slug }}
                className="bg-bone p-8 hover:bg-ink hover:text-bone transition-colors group"
              >
                <div className="eyebrow text-ink/50 group-hover:text-volt mb-3">
                  — {BUSINESS.name}
                </div>
                <h2 className="font-display text-3xl">
                  {loc.name}
                </h2>
                <p className="mt-3 text-[14px] text-ink/65 group-hover:text-bone/70 leading-relaxed">
                  
                </p>
                <div className="mt-5 text-[12px] uppercase tracking-[0.14em] text-ink/50 group-hover:text-volt">
                  View area →
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-16 bg-ink text-bone p-8 md:p-10 max-w-3xl">
            <div className="eyebrow text-volt mb-3">— Outside this list?</div>
            <h2 className="font-display text-3xl">
              Call to confirm coverage.
            </h2>
            <p className="mt-4 text-bone/70 max-w-xl">
              If you don't see your area,
              call {BUSINESS.phone} and we'll confirm coverage.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <a href={`tel:${BUSINESS.phoneE164}`} className="btn-volt">
                Call {BUSINESS.phone}
              </a>
              <Link to="/contact" className="btn-ghost-bone">
                Send a message →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
