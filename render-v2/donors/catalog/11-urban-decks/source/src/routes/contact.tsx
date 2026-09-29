import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHero } from "./services";
const projectPool = CLIENT.hero.poster;
import { Phone, Mail, Clock, MapPin, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { SITE } from "@/lib/site";
import { LocationMap } from "@/components/site/LocationMap";

import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () =>
    pageHead({
      title: "Contact · " + SITE.name,
      description: SITE.shortDescription,
      path: "/contact",
    }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={<>Tell us about<br />your project.</>}
        intro={PLAN.content?.contact || CLIENT.content.ctaBody}
        image={projectPool}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-12 lg:grid-cols-12">
          <aside className="lg:col-span-5 order-2 lg:order-1 space-y-6">
            <ContactCard
              icon={Phone}
              label="Call us"
              value={SITE.phone}
              href={SITE.phoneHref}
              note={SITE.hoursNote}
            />
            <ContactCard
              icon={Mail}
              label="Email"
              value={SITE.email}
              href={`mailto:${SITE.email}`}
              
            />
            <ContactCard
              icon={MapPin}
              label="Service area"
              value={SITE.city + ", " + SITE.region}
              href="/service-area"
              note={SITE.serviceArea.join(" · ")}
            />
            <ContactCard
              icon={Clock}
              label="Hours"
              value={SITE.hoursNote}
              
            />
          </aside>

          <div className="lg:col-span-7 order-1 lg:order-2">
            <div className="rounded-2xl border border-border bg-card p-7 md:p-9">
              <p className="eyebrow text-cedar">Contact</p>
              <h2 className="mt-2 font-display text-3xl md:text-4xl text-ink">Tell us about your project.</h2>
              <p className="mt-2 text-ink/65 text-sm">
                Online submission is unavailable. Please use the phone or email links below.
              </p>
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      <LocationMap />
    </>
  );
}

function ContactCard({
  icon: Icon, label, value, href, note,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; href?: string; note?: string }) {
  if (!value) return null;
  const inner = (
    <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 hover:border-cedar/60 transition-colors">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-ink text-cedar shrink-0">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="eyebrow text-ink/50">{label}</div>
        <div className="mt-1 font-display text-xl text-ink truncate">{value}</div>
        {note && <div className="mt-1 text-xs text-ink/55">{note}</div>}
      </div>
    </div>
  );
  if (href?.startsWith("/")) return <Link to={href as "/service-area"}>{inner}</Link>;
  if (href) return <a href={href}>{inner}</a>;
  return inner;
}

function ContactForm() {
  const onSubmit=(e:React.FormEvent<HTMLFormElement>)=>e.preventDefault();
  return (
    <form onSubmit={onSubmit} className="mt-7 grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Name *" required />
      <Field name="email" label="Email *" type="email" required />
      <Field name="phone" label="Phone" type="tel" />
      <Field name="address" label="Address (street, city, ZIP)" />
      <div className="sm:col-span-2">
        <Label>Project type</Label>
        <select
          name="projectType"
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cedar"
          defaultValue=""
        >
          <option value="" disabled>Select a project type</option>
          {SITE.services.map(s=><option key={s.slug} value={s.slug}>{s.title}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="message">Tell us about your project</Label>
        <textarea
          id="message"
          name="message"
          rows={5}
          placeholder="Size, materials you have in mind, timing, anything tricky about the site…"
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cedar"
        />
      </div>
      {/* Honeypot */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="sm:col-span-2 flex flex-wrap items-center gap-3 mt-2">
        <button
          type="submit"
          disabled
          className="inline-flex items-center gap-2 rounded-full bg-cedar px-7 py-3.5 text-sm font-semibold text-cream btn-magnetic shadow-cedar disabled:opacity-70"
        >
          Online submission unavailable
        </button>
        <a href={SITE.phoneHref} className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-medium text-ink">
          <Phone className="h-4 w-4" /> {SITE.phone}
        </a>
      </div>
      <p className="sm:col-span-2 text-sm">This form does not send. Please call{SITE.email && <> or <a href={`mailto:${SITE.email}`}>email us</a></>} to discuss your project.</p>
    </form>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
      {children}
    </label>
  );
}

function Field({
  name, label, type = "text", required = false,
}: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cedar"
      />
    </div>
  );
}
