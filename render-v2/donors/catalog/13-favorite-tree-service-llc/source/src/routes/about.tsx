import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { InlineCtas } from "@/components/CtaButtons";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";
import { BUSINESS } from "@/lib/business";
import { Heart, Shield, BadgeCheck, Trees } from "lucide-react";

import { client, bodyCopy } from '@/lib/wss-bridge';
const HERO_IMG = client.media.find(m => m.role === 'about')?.path;
export function AboutPage() {
  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-hero py-20 text-surface-foreground sm:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30">
          {HERO_IMG && <img src={HERO_IMG} alt="" loading="eager" className="h-full w-full object-cover" />}
        </div>
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-glow sm:text-6xl">{BUSINESS.name}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-surface-foreground/80">
            {BUSINESS.city}, {BUSINESS.region}
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">Our Story</h2>
            <p className="mt-5 whitespace-pre-line text-muted-foreground">{bodyCopy('about', client.content.about)}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {client.content.values.map(v => ({i:Heart,t:v.title,d:v.body})).map((v) => (
              <div key={v.t} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <v.i className="h-7 w-7 text-primary" aria-hidden />
                <h3 className="mt-3 text-lg font-bold">{v.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {client.trust.badges.length > 0 && <section className="bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">Credentials</h2>
          <ul className="mt-6 space-y-4 text-muted-foreground">{client.trust.badges.map(b => <li key={b.label}><strong className="text-foreground">{b.label}</strong> {b.sublabel} {b.meta}</li>)}</ul>
          <div className="mt-8"><InlineCtas /></div>
        </div>
      </section>}

      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "About", path: "/about" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: `About ${BUSINESS.name}`,
          mainEntity: { "@id": `https://${BUSINESS.domain}/#business` },
        }}
      />
    </SiteShell>
  );
}
