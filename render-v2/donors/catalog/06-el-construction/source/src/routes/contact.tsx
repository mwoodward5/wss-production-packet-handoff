import {RichCopy} from "@/components/RichCopy";
import {FAQ} from "@/components/FAQ";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { ContactForm } from "@/components/ContactForm";
import { QuoteEstimator } from "@/components/QuoteEstimator";
import { SectionHeading } from "@/components/SectionHeading";
import { site, client, richCopy } from "@/lib/site";
import { breadcrumbSchema, jsonLd } from "@/lib/schema";

export const Route=createFileRoute('/contact')({head:()=>({meta:[{title:site.name + ' — Contact'}]}),component:ContactPage});

export function ContactPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-24">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            Contact {site.name}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            Call us or prepare your project details below. The forms create a draft for you to discuss by phone.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CallButton variant="gold" location="hero-contact" label={`Call ${site.phone}`} />
            {site.email && <a href={`mailto:${site.email}`} className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/15">
              <Mail className="h-4 w-4" /> {site.email}
            </a>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Phone, label: "Call", value: site.phone, href: `tel:${site.phoneTel}` },
            { icon: Mail, label: "Email", value: site.email, href: `mailto:${site.email}` },
            { icon: MapPin, label: "Based in", value: `${site.city}, ${site.state}` },
            { icon: Clock, label: "Hours", value: site.hours },
          ].filter(c=>c.value).map((c) => (
            <a key={c.label} href={c.href ?? "#"} className="rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                <c.icon className="h-5 w-5" />
              </div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="mt-1 font-display text-base font-semibold break-words">{c.value}</div>
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Project planner" title="Prepare your project in 4 steps." />
            <div className="mt-6"><QuoteEstimator /></div>
          </div>
          <div>
            <SectionHeading eyebrow="Message draft" title="Prepare your project details." />
            <div className="mt-6"><ContactForm /></div>
          </div>
        </div>
      </section>

      {site.mapLink && <section className="bg-secondary py-16"><div className="mx-auto max-w-7xl px-4 lg:px-6"><div className="overflow-hidden rounded-3xl border border-border shadow-elegant p-8"><a href={site.mapLink} className="underline">Map and directions</a></div></div></section>}
      {richCopy('contact') && <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6"><RichCopy text={richCopy('contact')}/></section>}
      {client.content.faqs.length > 0 && <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6"><SectionHeading eyebrow="FAQ" title="Questions before you call"/><FAQ items={client.content.faqs}/></section>}
    </>
  );
}
