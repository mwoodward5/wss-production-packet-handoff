import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, MapPin, Phone } from "lucide-react";
import { SITE, CITY_DETAILS } from "@/lib/site";

type CityDetail = (typeof CITY_DETAILS)[string];

import { serviceJsonLd, faqJsonLd } from "@/lib/schema";
import { pageHead, Breadcrumbs } from "@/lib/seo";
import { PageHero, ClosingBand } from "./services";
import { LocationMap } from "@/components/site/LocationMap";
const projectModern = CLIENT.hero.poster;

export const Route = createFileRoute("/service-area/$city")({
  loader: ({ params }) => {
    const detail = CITY_DETAILS[params.city];
    if (!detail) throw notFound();
    return { detail };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { detail } = loaderData;
    return pageHead({
      title: detail.metaTitle,
      description: detail.metaDescription,
      path: `/service-area/${detail.slug}`,
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Service Area", path: "/service-area" },
        { name: `${detail.city}`, path: `/service-area/${detail.slug}` },
      ],
      extraScripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            serviceJsonLd({
              name: `${SITE.name} · ${detail.city}`,
              description: detail.metaDescription,
              url: `${SITE.url}/service-area/${detail.slug}`,
              areaServed: [detail.city],
            })
          ),
        },
        ...detail.voiceQA.length ? [{
          type: "application/ld+json",
          children: JSON.stringify(faqJsonLd(detail.voiceQA)),
        }] : [],
      ],
    });
  },
  notFoundComponent: () => (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-display text-4xl text-ink">City not in our service area listing</h1>
        <Link to="/service-area" className="mt-4 inline-block text-cedar">See full service area</Link>
      </div>
    </div>
  ),
  component: CityPage,
});

function CityPage() {
  const { detail } = Route.useLoaderData() as { detail: CityDetail };

  return (
    <>
      <PageHero
        eyebrow={`${detail.city}`}
        title={<>{detail.h1}</>}
        intro={detail.intro}
        image={projectModern}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-5xl px-5 md:px-8">
          <Breadcrumbs
            crumbs={[
              { name: "Home", path: "/" },
              { name: "Service Area", path: "/service-area" },
              { name: detail.city, path: `/service-area/${detail.slug}` },
            ]}
          />

          <div className="mt-8 grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-6 speakable">
              {detail.paragraphs.map((p, i) => (
                <p key={i} className="text-ink/80 leading-relaxed text-lg">{p}</p>
              ))}

              {detail.neighborhoods.length > 0 && (
                <div className="mt-6">
                  <p className="eyebrow text-cedar">Neighborhoods we build in</p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {detail.neighborhoods.map((n) => (
                      <li key={n} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-ink/80">
                        <MapPin className="h-3 w-3 text-cedar" /> {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.voiceQA.length > 0 && <div className="mt-12">
                <h2 className="font-display text-3xl text-ink">Questions and answers</h2>
                <ul className="mt-6 divide-y divide-border">
                  {detail.voiceQA.map((f) => (
                    <li key={f.q} className="py-5">
                      <h3 className="font-display text-xl text-ink">{f.q}</h3>
                      <p className="mt-2 text-ink/75 leading-relaxed">{f.a}</p>
                    </li>
                  ))}
                </ul>
              </div>}

              <div className="mt-12">
                <h2 className="font-display text-3xl text-ink">What we build in {detail.city}</h2>
                <ul className="mt-6 grid sm:grid-cols-2 gap-3 text-sm text-ink/85">
                  {SITE.services.map((s) => (
                    <li key={s.slug}>
                      <Link to="/services/$slug" params={{ slug: s.slug }} className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 hover:border-cedar/60 transition-colors">
                        <CheckCircle2 className="h-4 w-4 text-cedar mt-0.5 shrink-0" />
                        <span>
                          <span className="block font-semibold text-ink">{s.title}</span>
                          <span className="block text-ink/65 mt-0.5">{s.summary}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <aside className="lg:col-span-4">
              <div className="rounded-2xl border border-border bg-card p-6 sticky top-28">
                <p className="eyebrow text-cedar">Contact</p>
                <h3 className="mt-2 font-display text-2xl text-ink">Contact {SITE.name}</h3>
                <p className="mt-2 text-sm text-ink/65">{CLIENT.content.ctaBody}</p>
                <Link to="/contact" className="mt-5 inline-flex items-center gap-2 rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-cream w-full justify-center">
                  Start my project <ArrowRight className="h-4 w-4" />
                </Link>
                <a href={SITE.phoneHref} className="mt-3 inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink w-full justify-center">
                  <Phone className="h-4 w-4" /> {SITE.phone}
                </a>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <LocationMap
        eyebrow={`Find us · ${detail.city}`}
        heading={detail.city}
        copy={detail.city}
      />

      <ClosingBand />
    </>
  );
}
