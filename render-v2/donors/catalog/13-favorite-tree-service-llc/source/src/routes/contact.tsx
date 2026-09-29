import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { ContactForm } from "@/components/ContactForm";
import { BUSINESS, TEL_HREF, SMS_HREF, REVIEW_URL, MAPS_LINK } from "@/lib/business";
import { Phone, MessageSquare, Mail, MapPin, Clock, Star, Facebook } from "lucide-react";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import {
  InShortBlock,
  HiringGuideBlock,
  ProblemsSolvedBlock,
  StormBucketSnowBlock,
  ServiceAreaInlineBlock,
  InternalLinkHubBlock,
} from "@/components/LongFormDepth";

import { client, bodyCopy } from '@/lib/wss-bridge';
const HERO_IMG = client.hero.poster;
export function ContactPage() {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-24">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-25">
          <img src={HERO_IMG} alt="" loading="eager" className="h-full w-full object-cover" />
        </div>
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-glow sm:text-5xl">Contact {BUSINESS.name}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-surface-foreground/80">
            {bodyCopy("contact")}
          </p>
        </div>
      </section>

      <section className="py-14 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-5 lg:px-8">
          <div className="space-y-6 lg:col-span-2">
            <a href={TEL_HREF} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-smooth hover:shadow-glow">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Phone className="h-5 w-5" /></span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call us</span>
                <span className="block text-lg font-bold">{BUSINESS.phoneDisplay}</span>
              </span>
            </a>
            <a href={SMS_HREF} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-smooth hover:shadow-glow">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MessageSquare className="h-5 w-5" /></span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact us</span>
                <span className="block text-lg font-bold">{BUSINESS.phoneDisplay}</span>
              </span>
            </a>
            {BUSINESS.email && <a href={`mailto:${BUSINESS.email}`} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-smooth hover:shadow-glow">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Mail className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</span>
                <span className="block break-all text-base font-bold">{BUSINESS.email}</span>
              </span>
            </a>}
            {MAPS_LINK && <a href={MAPS_LINK} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-smooth hover:shadow-glow">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MapPin className="h-5 w-5" /></span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Map and directions</span>
                <span className="block text-base font-bold">{BUSINESS.city}, {BUSINESS.region}</span>
              </span>
            </a>}
            {typeof client.trust.hours === 'object' && client.trust.hours && 'text' in client.trust.hours && typeof client.trust.hours.text === 'string' && <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm"><Clock className="h-5 w-5" /><span>{client.trust.hours.text}</span></div>}
            {REVIEW_URL && <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><a href={REVIEW_URL} className="text-sm font-semibold">Read customer reviews</a></div>}
          </div>

          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </div>
      </section>



      <ServiceAreaInlineBlock />


      <InternalLinkHubBlock />

      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: `Contact ${BUSINESS.name}`,
          mainEntity: { "@id": `https://${BUSINESS.domain}/#business` },
        }}
      />
    </SiteShell>
  );
}
