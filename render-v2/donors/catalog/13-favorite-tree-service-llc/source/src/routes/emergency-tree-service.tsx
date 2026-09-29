import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { Testimonials } from "@/components/Testimonials";
import {
  InShortBlock,
  CostFactorsBlock,
  ProcessBlock,
  HiringGuideBlock,
  ProblemsSolvedBlock,
  StormBucketSnowBlock,
  ServiceAreaInlineBlock,
  InternalLinkHubBlock,
} from "@/components/LongFormDepth";
import { BUSINESS, TEL_HREF } from "@/lib/business";
import { Phone, Zap, Clock, Shield, AlertTriangle, Truck } from "lucide-react";

import { client } from '@/lib/wss-bridge';
import { serviceBinding } from '@/lib/service-bindings';
import type { Service } from '@/lib/wss-types';
export function EmergencyPage({ service }: { service: Service }) {
  const data = serviceBinding(service);
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <AlertTriangle className="h-3.5 w-3.5" /> {service.shortLabel}
          </div>
          <h1 className="mt-6 text-4xl font-bold text-glow sm:text-6xl">{service.name}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {data.heroSub}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={TEL_HREF} className="inline-flex items-center gap-2 rounded-lg bg-cta-gradient px-7 py-4 text-lg font-bold text-accent-foreground shadow-amber animate-pulse-glow">
              <Phone className="h-5 w-5" /> Call {BUSINESS.phoneDisplay} Now
            </a>
          </div>
        </div>
      </section>

      {client.trust.badges.length > 0 && <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
          {client.trust.badges.map(b => ({i:Shield,t:b.label,d:b.sublabel})).map((c) => (
            <div key={c.t} className="rounded-2xl border border-border bg-card p-7 shadow-sm">
              <c.i className="h-8 w-8 text-primary" aria-hidden />
              <h2 className="mt-3 text-xl font-bold">{c.t}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </section>}

      <section className="bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">{service.name}</h2>
          <p className="mt-4 whitespace-pre-line text-muted-foreground">{data.intro}</p>
          <div className="mt-8"><InlineCtas /></div>
        </div>
      </section>

      <FAQ items={client.content.faqs} />
      <Testimonials />
      <ServiceAreaInlineBlock />
      <InternalLinkHubBlock excludeServiceSlug={data.slug} />
      <JsonLd data={breadcrumbJsonLd([{name:'Home',path:'/'},{name:service.name,path:service.href}])} />
    </SiteShell>
  );
}

// re-export icons used in JSX so they're not flagged
void Zap;
void Link;
