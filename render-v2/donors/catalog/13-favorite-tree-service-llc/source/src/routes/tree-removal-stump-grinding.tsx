import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { Testimonials } from "@/components/Testimonials";
import { ProjectGallery, STUMP_REMOVAL_GALLERY } from "@/components/ProjectGallery";
import { RelatedServices, AreasWeServe } from "@/components/RelatedLinks";
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
import { TreePine, Sprout, Shield, BadgeCheck, ArrowRight, CheckCircle2 } from "lucide-react";

import { client } from '@/lib/wss-bridge';
import { serviceBinding } from '@/lib/service-bindings';
import type { Service } from '@/lib/wss-types';
export function TreeRemovalPage({ service }: { service: Service }) {
  const data = serviceBinding(service);
  const stump = client.services.find(s => /stump/i.test(s.name) && s !== service);

  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-primary-glow/20 blur-3xl" aria-hidden />
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold leading-tight text-glow sm:text-6xl">
            {service.name}<br />
            <span className="text-primary-glow">{client.identity.city}, {client.identity.state}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {data.heroSub}
          </p>
          <div className="mt-8 flex justify-center">
            <InlineCtas />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">{service.name}</h2>
            <p className="mt-4 whitespace-pre-line text-muted-foreground">{data.intro}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {data.included.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{b}
                </div>
              ))}
            </div>
          </div>
          {stump && <div className="rounded-3xl border border-border bg-card p-7 shadow-elegant sm:p-9">
            <Sprout className="h-10 w-10 text-primary" aria-hidden />
            <h2 className="mt-4 text-2xl font-bold">{stump.name}</h2>
            <p className="mt-3 text-muted-foreground">{stump.description}</p>
          </div>}
        </div>
      </section>

      {client.trust.badges.length > 0 && <section className="bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">Credentials</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {client.trust.badges.map(b => ({i:Shield,t:b.label,d:b.sublabel})).map((c) => (
              <div key={c.t} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <c.i className="h-7 w-7 text-primary" aria-hidden />
                <h3 className="mt-3 text-lg font-bold">{c.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>}

      <FAQ items={client.content.faqs} variant="dark" />

      <Testimonials heading="What Customers Say" />

      <ProjectGallery
        heading="Recent Tree Removal & Stump Grinding Projects"
        photos={STUMP_REMOVAL_GALLERY}
      />

      <RelatedServices excludeSlug={data.slug} />

      <AreasWeServe />

      <InternalLinkHubBlock excludeServiceSlug={data.slug} />

      <section className="bg-surface py-14 text-surface-foreground">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold">{client.content.ctaHeadline || "Discuss your project"}</h2>
          <p className="mt-3 text-surface-foreground/75">{client.content.ctaBody}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a href={`tel:${BUSINESS.phoneRaw}`} className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-6 py-3 text-base font-bold text-accent-foreground shadow-amber">
              Call {BUSINESS.phoneDisplay}
            </a>
            <Link to="/contact" className="inline-flex items-center gap-2 rounded-md border border-white/20 px-6 py-3 text-base font-semibold">
              Contact us <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <JsonLd data={breadcrumbJsonLd([{name:'Home',path:'/'},{name:service.name,path:service.href}])} />
    </SiteShell>
  );
}
