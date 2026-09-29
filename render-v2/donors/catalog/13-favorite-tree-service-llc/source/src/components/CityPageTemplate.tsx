import { client } from "@/lib/wss-bridge";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { Testimonials } from "@/components/Testimonials";
import {
  CostFactorsBlock,
  ProcessBlock,
  HiringGuideBlock,
  ProblemsSolvedBlock,
  StormBucketSnowBlock,
  InternalLinkHubBlock,
} from "@/components/LongFormDepth";
import { BUSINESS } from "@/lib/business";
import { SERVICES, type CityMeta } from "@/lib/services-data";
import { MapPin, Phone, ArrowRight, Clock } from "lucide-react";

export function CityPageTemplate({
  city,
  heroImg,
  heroAlt,
  body,
  faqs,
}: {
  city: CityMeta;
  heroImg: string;
  heroAlt: string;
  body: ReactNode;
  faqs: FAQItem[];
}) {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          {heroImg && <img src={heroImg} alt={heroAlt} loading="eager" className="h-full w-full object-cover" />}
        </div>
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider backdrop-blur">
            <MapPin className="h-3.5 w-3.5" /> {client.identity.businessName}
          </div>
          <h1 className="mt-6 text-4xl font-bold leading-tight text-glow sm:text-6xl">
            Tree Service in <span className="text-primary-glow">{city.city}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {client.identity.businessName} / {city.city}
          </p>
          <div className="mt-8 flex justify-center">
            <InlineCtas />
          </div>
        </div>
      </section>

      {body && <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">{city.city}</h2>
          <div className="mt-5 space-y-4 text-muted-foreground">
            
            {body}
          </div>

          <div className="mt-10"><InlineCtas /></div>
        </div>
      </section>}

      <section className="bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">Services</h2>
          <p className="mt-3 text-muted-foreground">Contact us about service availability at your address.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <Link
                key={s.slug}
                to={s.path}
                className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
              >
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.blurb}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>






      <Testimonials />

      <FAQ items={faqs} />

      <InternalLinkHubBlock excludeCitySlug={city.slug} />

      <section className="bg-surface py-14 text-surface-foreground">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold">Need tree work in {city.city}?</h2>
          <p className="mt-3 text-surface-foreground/75">{client.content.ctaBody}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a href={`tel:${BUSINESS.phoneRaw}`} className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-6 py-3 text-base font-bold text-accent-foreground shadow-amber">
              <Phone className="h-4 w-4" /> Call {BUSINESS.phoneDisplay}
            </a>
            <Link to="/contact" className="inline-flex items-center gap-2 rounded-md border border-white/20 px-6 py-3 text-base font-semibold">
              Contact us <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Service Area", path: "/service-area" },
          { name: city.city, path: city.path },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          serviceType: "Tree Service",
          name: `Tree Service in ${city.city}`,
          provider: { "@id": `https://${BUSINESS.domain}/#business` },
          areaServed: city.city,
          url: `https://${BUSINESS.domain}${city.path}`,
        }}
      />
    </SiteShell>
  );
}
