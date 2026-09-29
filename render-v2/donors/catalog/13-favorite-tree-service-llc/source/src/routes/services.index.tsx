import { client } from "@/lib/wss-bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { AreasWeServe } from "@/components/RelatedLinks";
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
import { BUSINESS } from "@/lib/business";
import { SERVICES } from "@/lib/services-data";
import {
  TreePine, Scissors, Truck, Snowflake, Sprout, Leaf, Wrench, Shovel, ArrowRight, Zap, Trees,
} from "lucide-react";

const HERO_IMG = client.hero.poster;

const ICONS: Record<string, typeof TreePine> = {
  "tree-removal-stump-grinding": TreePine,
  "tree-pruning": Scissors,
  "bucket-truck-service": Truck,
  "snow-removal": Snowflake,
  "brush-hogging": Wrench,
  "mulching": Shovel,
  "landscape-maintenance": Leaf,
  "lot-clearing": Trees,
  "storm-damage-cleanup": Zap,
};

void Sprout;

const FAQ_ITEMS = client.content.faqs;

export function ServicesPage() {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          <img src={HERO_IMG} alt="" loading="eager" className="h-full w-full object-cover" />
        </div>
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-glow sm:text-6xl">Services</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {client.content.serviceIntro}
          </p>
          <div className="mt-8 flex justify-center">
            <InlineCtas />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => {
              const Icon = ICONS[s.slug] ?? TreePine;
              return (
                <Link
                  key={s.slug}
                  to={s.path}
                  className="group rounded-2xl border border-border bg-card p-7 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
                >
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <h2 className="mt-5 text-xl font-bold">{s.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{s.blurb}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>





      <Testimonials heading="What Our Tree Service Customers Say" />


      <FAQ items={FAQ_ITEMS} />

      <AreasWeServe />

      <InternalLinkHubBlock />

      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Services", path: "/services" }])} />
      <JsonLd
        data={SERVICES.map((s) => ({
          "@context": "https://schema.org",
          "@type": "Service",
          serviceType: s.title,
          name: s.title,
          provider: { "@id": `https://${BUSINESS.domain}/#business` },
          areaServed: BUSINESS.serviceAreas,
          url: `https://${BUSINESS.domain}${s.path}`,
        }))}
      />
    </SiteShell>
  );
}
