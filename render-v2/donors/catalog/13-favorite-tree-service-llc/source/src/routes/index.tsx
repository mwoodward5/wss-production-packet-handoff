import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { Hero } from "@/components/site/Hero";
import { FAQ, type FAQItem } from "@/components/FAQ";
import { JsonLd } from "@/components/JsonLd";
import { StatsStrip } from "@/components/StatsStrip";
import { Testimonials } from "@/components/Testimonials";
import { ProjectGallery } from "@/components/ProjectGallery";
import { FieldVideoGallery } from "@/components/FieldVideoGallery";
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
import { BUSINESS, REVIEW_URL, TESTIMONIALS } from "@/lib/business";
import { SERVICES as ALL_SERVICES } from "@/lib/services-data";
import {
  TreePine, Truck, Scissors, Snowflake, Sprout, Zap,
  Shield, Clock, BadgeCheck, MapPin, Phone, Star, ArrowRight,
} from "lucide-react";

import { client, sectionCopy, sectionItems } from '@/lib/wss-bridge';
import { localBusinessJsonLd } from '@/lib/business';
const SERVICES = ALL_SERVICES.map(s => ({icon:TreePine,title:s.title,desc:s.blurb,to:s.path}));
const WHY_US = client.content.values.map(v => ({icon:BadgeCheck,t:v.title,d:v.body}));
const FAQ_ITEMS = client.content.faqs;

export function HomePage() {
  return (
    <SiteShell>
      {/* Flagship 3.0 cinematic hero */}
      <Hero />

      <StatsStrip />

      {/* Services */}
      <section className="py-20 sm:py-28" aria-labelledby="services-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">What we do</p>
            <h2 id="services-heading" className="mt-2 text-3xl font-bold sm:text-5xl">Services</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {client.content.serviceIntro}
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <Link
                key={s.title}
                to={s.to}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
              >
                <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary-glow/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-5 text-xl font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section className="bg-muted/40 py-20 sm:py-24" aria-labelledby="why-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-primary">About us</p>
              <h2 id="why-heading" className="mt-2 text-3xl font-bold sm:text-5xl">{client.content.whyHeadline || "About us"}</h2>
              <p className="mt-5 text-lg text-muted-foreground">
                {client.content.about}
              </p>
              <div className="mt-8">
                <InlineCtas />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {WHY_US.map((w) => (
                <div key={w.t} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <w.icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{w.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{w.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {sectionCopy('Pricing') && sectionCopy('Choosing a tree service') && <section className="py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"><h2 className="text-3xl font-bold">Pricing</h2><p className="mt-4 whitespace-pre-line text-muted-foreground">{sectionCopy('Pricing')}</p></div>
          <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"><h2 className="text-3xl font-bold">Choosing a tree service</h2><p className="mt-4 whitespace-pre-line text-muted-foreground">{sectionCopy('Choosing a tree service')}</p></div>
        </div>
      </section>}

      {/* Service area + reviews CTA */}
      {(client.trust.areas.length > 0 || REVIEW_URL) && <section className="bg-surface py-20 text-surface-foreground sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary-glow">Service area</p>
            <h2 className="mt-2 text-3xl font-bold sm:text-5xl">Service Areas</h2>
            <p className="mt-4 text-surface-foreground/75">
              {client.trust.areas.join(" · ")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {BUSINESS.serviceAreas.map((a) => (
                <span key={a} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs">{a}</span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/service-area" className="inline-flex items-center gap-2 rounded-md bg-primary-glow px-5 py-2.5 text-sm font-bold text-primary-foreground transition-smooth hover:opacity-95">
                Full Service Area <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={`tel:${BUSINESS.phoneRaw}`} className="inline-flex items-center gap-2 rounded-md border border-white/20 px-5 py-2.5 text-sm font-semibold text-surface-foreground hover:bg-white/10">
                <Phone className="h-4 w-4" /> {BUSINESS.phoneDisplay}
              </a>
            </div>
          </div>
          {REVIEW_URL && <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur sm:p-10">
            <Star className="h-10 w-10 text-accent" aria-hidden />
            <h3 className="mt-4 text-2xl font-bold">Customer reviews</h3>
            <p className="mt-2 text-surface-foreground/75">Read customer feedback.</p>
            <a
              href={REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-cta-gradient px-5 py-3 text-sm font-bold text-accent-foreground shadow-amber transition-smooth hover:opacity-95"
            >
              <Star className="h-4 w-4" /> Read reviews
            </a>
          </div>}
        </div>
      </section>}

      <InShortBlock topic="At a glance" bullets={sectionCopy('In short').split('\n').filter(Boolean)} />

      <ProblemsSolvedBlock />

      <CostFactorsBlock serviceLabel="tree service" />

      <ProcessBlock />

      <StormBucketSnowBlock />

      <HiringGuideBlock />

      <Testimonials />

      <ProjectGallery />

      <FieldVideoGallery />

      <ServiceAreaInlineBlock />

      <FAQ items={FAQ_ITEMS} />

      <InternalLinkHubBlock />

      <JsonLd data={localBusinessJsonLd} />
    </SiteShell>
  );
}
