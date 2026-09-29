import {RichCopy} from "@/components/RichCopy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, ArrowRight } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { SectionHeading } from "@/components/SectionHeading";
import { site, richCopy } from "@/lib/site";
import { citiesData } from "@/lib/cities-data";
import { breadcrumbSchema, jsonLd } from "@/lib/schema";

export const Route=createFileRoute('/service-area/')({head:()=>({meta:[{title:site.name + ' — ServiceArea'}]}),component:ServiceAreaPage});

export function ServiceAreaPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-primary/40" />
          <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            {site.name} <span className="text-gold">Service area</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            {citiesData.map(c=>c.name).join(" · ")}
          </p>
          <div className="mt-7"><CallButton variant="gold" location="hero-service-area" label={`Call ${site.phone}`} className="cta-conic" /></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="Cities We Serve" title="Areas we serve" />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {citiesData.map((c) => (
            <Link
              key={c.slug}
              to="/service-area/$citySlug"
              params={{ citySlug: c.slug }}
              className="group rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-1 hover:border-gold hover:shadow-elegant"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                <MapPin className="h-4 w-4" />
              </div>
              <h2 className="font-display text-xl font-semibold">{c.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{c.distanceFromHQ}</p>
              <p className="mt-2 text-sm text-muted-foreground">{c.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                See {c.name} page <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {site.mapLink && <section className="bg-secondary py-16"><div className="mx-auto max-w-7xl px-4 lg:px-6"><div className="overflow-hidden rounded-3xl border border-border shadow-elegant p-8"><a href={site.mapLink} className="underline">Map and directions</a></div></div></section>}
      {richCopy('service-area') && <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6"><RichCopy text={richCopy('service-area')}/></section>}

      <section className="mx-auto max-w-3xl px-4 py-20 text-center lg:px-6">
        <h2 className="font-display text-3xl font-semibold md:text-4xl">Don't see your city?</h2>
        <p className="mt-3 text-muted-foreground">Call to discuss your project location.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <CallButton variant="gold" location="service-area-bottom" label={`Call ${site.phone}`} />
          <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold">Get Quote</Link>
        </div>
      </section>
    </>
  );
}
