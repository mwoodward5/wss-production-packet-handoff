import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SERVICES, BUSINESS } from "@/lib/business";
import { CITIES } from "@/lib/cities";
import { Phone, Check, ArrowUpRight, MapPin } from "lucide-react";
import { CtaBanner } from "@/components/site/CtaBanner";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { routeHead } from "@/lib/wss-route-head";
import { RichText } from "@/components/site/RichText";
import { getClient } from "@/lib/wss-client";

export const Route = createFileRoute("/services/$slug")({
  loader: ({ params }) => {
    const service = SERVICES.find((s) => s.slug === params.slug);
    if (!service) throw notFound();
    return { service };
  },
  head: ({ loaderData }) => routeHead(loaderData?.service.name || "Service", loaderData?.service.short),
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center">
      <h1 className="display text-3xl">Something tripped a breaker</h1>
      <p className="mt-3 text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="mt-6 rounded-full bg-foreground px-4 py-2 text-sm text-background">Retry</button>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center">
      <div className="eyebrow">404</div>
      <h1 className="display mt-2 text-3xl">Service not found</h1>
      <Link to="/services" className="mt-6 inline-block rounded-full bg-foreground px-4 py-2 text-sm text-background">
        See all services
      </Link>
    </div>
  ),
  component: ServiceDetail,
});

function ServiceDetail() {
  const { service } = Route.useLoaderData();
  const others = SERVICES.filter((s) => s.slug !== service.slug).slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden bg-[var(--ink)] text-[var(--bone)]">
        <div className="absolute inset-0 grid-blueprint opacity-20" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 md:grid-cols-12 md:px-8 md:py-28">
          <div className="md:col-span-7">
            <div className="eyebrow text-[var(--gold)]">{BUSINESS.name} · Service</div>
            <h1 className="display mt-3 text-4xl md:text-6xl">{service.name}</h1>
            <p className="mt-5 max-w-xl text-lg text-[var(--bone)]/75">{service.short}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--ink)]">
                Discuss this service <ArrowUpRight className="h-4 w-4" />
              </Link>
              <a href={BUSINESS.phoneHref} className="inline-flex items-center gap-2 rounded-full border border-[var(--bone)]/25 px-5 py-3 text-sm font-semibold text-[var(--bone)]">
                <Phone className="h-4 w-4" /> {BUSINESS.phone}
              </a>
            </div>
          </div>
          <div className="md:col-span-5">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              {service.imagePath && <img src={service.imagePath} alt={`Client photograph from ${BUSINESS.name}`} loading="eager" decoding="async" fetchPriority="high" width={800} height={1000} className="h-full w-full object-cover" />}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/60 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Services", to: "/services" },
          { label: service.name },
        ]}
      />

      <section className="mx-auto max-w-5xl px-5 py-16 md:px-8">
        <RichText text={service.body} />
        {service.bullets.length > 0 && <div className="eyebrow">What's included</div>}
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {service.bullets.map((b: string) => (
            <li key={b} className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gold)]" />
              <span className="text-sm text-foreground">{b}</span>
            </li>
          ))}
        </ul>

        {getClient().content.values.length > 0 && <div className="mt-14 rounded-2xl bg-secondary p-8">
          <h2 className="display text-2xl">{getClient().content.whyHeadline}</h2>
          <ol className="mt-5 grid gap-5 md:grid-cols-3">{getClient().content.values.map((v,i) => <li key={v.title}><div className="font-mono text-xs text-[var(--gold)]">{String(i+1).padStart(2,'0')}</div><div className="mt-1 font-semibold">{v.title}</div><div className="mt-1 text-sm text-muted-foreground">{v.body}</div></li>)}</ol>
        </div>}
      </section>

      {service.faqs && service.faqs.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 pb-4 md:px-8">
          <div className="eyebrow">{service.name} · FAQs</div>
          <h2 className="display mt-3 text-3xl md:text-4xl">Common questions</h2>
          <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
            {service.faqs.map((f: { q: string; a: string }) => (
              <details key={f.q} className="group p-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-start justify-between gap-4 text-base font-semibold text-foreground">
                  <span>{f.q}</span>
                  <span className="mt-1 shrink-0 font-mono text-xs text-[var(--gold)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {CITIES.length > 0 && <section className="bg-secondary">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-8">
          <div className="eyebrow">{service.name} · Where we work</div>
          <h2 className="display mt-3 text-2xl md:text-3xl">
            Service areas
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <span
                key={c.slug}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground hover:border-[var(--gold)]"
              >
                <MapPin className="h-3.5 w-3.5 text-[var(--gold)]" /> {c.city}, {c.state}
              </span>
            ))}
          </div>
        </div>
      </section>}

      <section className="mx-auto max-w-7xl px-5 pb-20 pt-16 md:px-8">
        <div className="eyebrow">More from {BUSINESS.name}</div>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {others.map((o) => (
            <Link
              key={o.slug}
              to="/services/$slug"
              params={{ slug: o.slug }}
              className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-secondary"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold">{o.name}</div>
                <ArrowUpRight className="h-4 w-4 text-foreground/50 group-hover:text-[var(--gold)]" />
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{o.short}</div>
            </Link>
          ))}
        </div>
      </section>

      <CtaBanner />
    </>
  );
}
