import { client } from "@/lib/wss-bridge";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { ProjectGallery, type GalleryPhoto } from "@/components/ProjectGallery";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { RelatedServices, AreasWeServe } from "@/components/RelatedLinks";
import {
  CostFactorsBlock,
  ProcessBlock,
  HiringGuideBlock,
  ProblemsSolvedBlock,
  PROBLEM_SETS,
  StormBucketSnowBlock,
  InternalLinkHubBlock,
} from "@/components/LongFormDepth";
import { BUSINESS } from "@/lib/business";
import { CheckCircle2, ArrowRight, Phone } from "lucide-react";

export type ServicePageProps = {
  slug: string;
  path?: string;
  serviceType: string;
  h1: ReactNode;
  heroSub: string;
  heroImg: string;
  heroAlt: string;
  intro: ReactNode;
  included: string[];
  whyPro: { title: string; body: string }[];
  pricing: ReactNode;
  faqs: FAQItem[];
  galleryPhotos?: GalleryPhoto[];
  galleryHeading?: string;
};

export function ServicePageTemplate(props: ServicePageProps) {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28 lg:py-32">
        <div className="pointer-events-none absolute inset-0 -z-10">
          {props.heroImg && <img
            src={props.heroImg}
            alt={props.heroAlt}
            loading="eager"
            className="h-full w-full object-cover opacity-30 animate-ken-burns"
          />}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t from-surface/80 to-transparent" aria-hidden />
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:items-end lg:px-8">
          <div className="lg:col-span-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary-glow">{BUSINESS.name}</p>
            <h1 className="mt-4 text-4xl font-bold leading-tight text-glow sm:text-6xl">{props.h1}</h1>
            <p className="mt-5 max-w-2xl text-lg text-surface-foreground/80">{props.heroSub}</p>
          </div>
          <div className="lg:col-span-4 lg:justify-self-end">
            <InlineCtas />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
          <div className="lg:col-span-2">
            <h2 className="text-3xl font-bold sm:text-4xl">{props.serviceType}</h2>
            <div className="mt-4 space-y-4 text-muted-foreground">{props.intro}</div>

            {props.included.length > 0 && <><h3 className="mt-10 text-2xl font-bold text-foreground">What's Included</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {props.included.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {b}
                </div>
              ))}
            </div>

            </>}
            {props.whyPro.length > 0 && <><h3 className="mt-10 text-2xl font-bold text-foreground">Why Hire a Pro</h3>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {props.whyPro.map((w) => (
                <div key={w.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="text-base font-bold text-foreground">{w.title}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{w.body}</p>
                </div>
              ))}
            </div>

            </>}
            {props.pricing && <><h3 className="mt-10 text-2xl font-bold text-foreground">Pricing Guidance</h3>
            <div className="mt-4 space-y-3 text-muted-foreground">{props.pricing}</div></>}

            <div className="mt-8"><InlineCtas /></div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-wider text-primary">Request an estimate</div>
              <div className="mt-2 text-2xl font-bold">Call us today</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {client.content.ctaBody}
              </p>
              <a
                href={`tel:${BUSINESS.phoneRaw}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-cta-gradient px-4 py-3 text-sm font-bold text-accent-foreground shadow-amber"
              >
                <Phone className="h-4 w-4" /> {BUSINESS.phoneDisplay}
              </a>
              <Link
                to="/contact"
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold"
              >
                Request a Quote <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-wider text-primary">Service Area</div>
              <p className="mt-3 text-sm text-muted-foreground">
                {client.trust.areas.join(" · ")}
              </p>
              <Link to="/service-area" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Full service area <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        </div>
      </section>






      <FAQ items={props.faqs} />

      {props.galleryPhotos ? (
        <ProjectGallery heading={props.galleryHeading ?? `Recent ${props.serviceType} Work`} photos={props.galleryPhotos} />
      ) : null}

      <RelatedServices excludeSlug={props.slug} />
      <AreasWeServe />

      <InternalLinkHubBlock excludeServiceSlug={props.slug} />

      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Services", path: "/services" },
          { name: props.serviceType, path: props.path || `/services/${props.slug}` },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          serviceType: props.serviceType,
          name: props.serviceType,
          provider: { "@id": `https://${BUSINESS.domain}/#business` },
          areaServed: BUSINESS.serviceAreas,
          url: new URL(props.path || `/services/${props.slug}`, client.identity.website).href,
        }}
      />
    </SiteShell>
  );
}
