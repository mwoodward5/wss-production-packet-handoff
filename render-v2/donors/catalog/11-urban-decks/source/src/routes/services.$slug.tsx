import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Phone } from "lucide-react";
import { SITE, SERVICE_DETAILS } from "@/lib/site";

type ServiceDetail = (typeof SERVICE_DETAILS)[string];
type Svc = (typeof SITE.services)[number];

import { serviceJsonLd, faqJsonLd } from "@/lib/schema";
import { pageHead, Breadcrumbs } from "@/lib/seo";
import { PageHero, ClosingBand } from "./services";
const projectTimber = CLIENT.hero.poster;

export const Route = createFileRoute("/services/$slug")({
  loader: ({ params }) => {
    const detail = SERVICE_DETAILS[params.slug];
    if (!detail) throw notFound();
    const svc = SITE.services.find((s) => s.slug === params.slug)!;
    return { detail, svc, slug: params.slug };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { detail, slug } = loaderData;
    return pageHead({
      title: detail.metaTitle,
      description: detail.metaDescription,
      path: `/services/${slug}`,
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Services", path: "/services" },
        { name: detail.h1, path: `/services/${slug}` },
      ],
      extraScripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            serviceJsonLd({
              name: detail.h1,
              description: detail.metaDescription,
              url: `${SITE.url}/services/${slug}`,
            })
          ),
        },
        ...detail.faqs.length ? [{
          type: "application/ld+json",
          children: JSON.stringify(faqJsonLd(detail.faqs)),
        }] : [],
      ],
    });
  },
  notFoundComponent: () => (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-display text-4xl text-ink">Service not found</h1>
        <Link to="/services" className="mt-4 inline-block text-cedar">Browse all services</Link>
      </div>
    </div>
  ),
  component: ServiceDetail,
});

function ServiceDetail() {
  const { detail, svc, slug } = Route.useLoaderData() as { detail: ServiceDetail; svc: Svc; slug: string };

  return (
    <>
      <PageHero
        eyebrow="Service"
        title={<>{detail.h1}</>}
        intro={detail.intro}
        image={projectTimber}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-5xl px-5 md:px-8">
          <Breadcrumbs
            crumbs={[
              { name: "Home", path: "/" },
              { name: "Services", path: "/services" },
              { name: svc.title, path: `/services/${slug}` },
            ]}
          />

          <div className="mt-8 grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-6 speakable">
              {detail.paragraphs.map((p, i) => (
                <p key={i} className="text-ink/80 leading-relaxed text-lg">{p}</p>
              ))}

              <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm text-ink/85">
                {detail.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-cedar mt-0.5 shrink-0" /> {b}
                  </li>
                ))}
              </ul>

              {detail.faqs.length > 0 && <div className="mt-12">
                <h2 className="font-display text-3xl text-ink">Frequently asked</h2>
                <ul className="mt-6 divide-y divide-border">
                  {detail.faqs.map((f) => (
                    <li key={f.q} className="py-5">
                      <h3 className="font-display text-xl text-ink">{f.q}</h3>
                      <p className="mt-2 text-ink/75 leading-relaxed">{f.a}</p>
                    </li>
                  ))}
                </ul>
              </div>}
            </div>

            <aside className="lg:col-span-4">
              <div className="rounded-2xl border border-border bg-card p-6 sticky top-28">
                <p className="eyebrow text-cedar">Contact</p>
                <h3 className="mt-2 font-display text-2xl text-ink">{CLIENT.content.ctaHeadline || "Contact"}</h3>
                <p className="mt-2 text-sm text-ink/65">{CLIENT.content.ctaBody}</p>
                <Link to="/contact" className="mt-5 inline-flex items-center gap-2 rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-cream w-full justify-center">
                  Start my project <ArrowRight className="h-4 w-4" />
                </Link>
                <a href={SITE.phoneHref} className="mt-3 inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink w-full justify-center">
                  <Phone className="h-4 w-4" /> {SITE.phone}
                </a>
                <p className="mt-5 text-xs text-ink/55">
                  {SITE.serviceArea.join(" · ")}
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <ClosingBand />
    </>
  );
}
