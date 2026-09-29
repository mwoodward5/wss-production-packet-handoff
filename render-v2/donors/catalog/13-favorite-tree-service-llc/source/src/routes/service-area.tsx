import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { Testimonials } from "@/components/Testimonials";
import {
  InShortBlock,
  CostFactorsBlock,
  ProcessBlock,
  HiringGuideBlock,
  ProblemsSolvedBlock,
  StormBucketSnowBlock,
  InternalLinkHubBlock,
} from "@/components/LongFormDepth";
import { BUSINESS, MAPS_LINK } from "@/lib/business";
import { CITIES, SERVICES } from "@/lib/services-data";
import { MapPin, ArrowRight } from "lucide-react";

import { client, bodyCopy } from '@/lib/wss-bridge';
const HERO_IMG = client.hero.poster;
export function ServiceAreaPage() {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <img src={HERO_IMG} alt="" loading="eager" className="h-full w-full object-cover" />
        </div>
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-glow sm:text-6xl">Service Areas</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {bodyCopy("service-area")}
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CITIES.map((c) => (
              <Link
                key={c.slug}
                to={c.path}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
              >
                <div className="flex items-center gap-2 text-primary">
                  <MapPin className="h-5 w-5" aria-hidden />
                  <h2 className="text-lg font-bold">{c.city}</h2>
                </div>

                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  View {c.city} page <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">{BUSINESS.city}, {BUSINESS.region}</h2>
            <p className="mt-4 text-muted-foreground">
              {BUSINESS.name}
            </p>
            <p className="mt-4 text-muted-foreground">
              Contact us to ask about service availability at your address.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {MAPS_LINK && <a href={MAPS_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">
                Map and directions <ArrowRight className="h-4 w-4" />
              </a>}
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-5 py-2.5 text-sm font-semibold">
                Contact Us
              </Link>
            </div>
            <div className="mt-8"><InlineCtas /></div>
          </div>
        </div>
      </section>





      <Testimonials heading="What Customers Say" />


      <InternalLinkHubBlock />

      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Service Area", path: "/service-area" }])} />
    </SiteShell>
  );
}


