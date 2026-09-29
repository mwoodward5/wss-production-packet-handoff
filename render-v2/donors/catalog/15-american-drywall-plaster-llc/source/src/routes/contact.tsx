import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Phone, Mail, MapPin, MessageSquare, Send, Check } from "lucide-react";
import { business } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | contact", description: client.hero.support, path: "/contact"})}),
  component: ContactPage,
});

function ContactPage() {
  return (
    <section className="bg-bone">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-24">
        <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">Contact</span></nav>
        <div className="mt-6 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <h1 className="font-display text-[44px] lg:text-[68px] leading-[0.98] text-ink">Let’s talk about your <span className="italic">project.</span></h1>
            <p className="mt-6 text-[17px] leading-relaxed text-foreground/75">{pageCopy("contact", "Contact us to discuss your project.")}</p>

            <div className="mt-10 space-y-4">
              <a href={`tel:${business.phoneRaw}`} className="flex items-start gap-4 p-5 rounded-sm border border-border bg-card hover:bg-secondary transition-colors">
                <Phone className="h-5 w-5 text-amber mt-0.5" />
                <div>
                  <div className="eyebrow !text-[10px]">Call</div>
                  <div className="font-display text-[22px] text-ink">{business.phone}</div>
                </div>
              </a>
              <a href="/contact" className="flex items-start gap-4 p-5 rounded-sm border border-border bg-card hover:bg-secondary transition-colors">
                <MessageSquare className="h-5 w-5 text-amber mt-0.5" />
                <div>
                  <div className="eyebrow !text-[10px]">Contact us</div>
                  <div className="font-display text-[22px] text-ink">{business.phone}</div>
                </div>
              </a>
              {business.email && (<a href={`mailto:${business.email}`} className="flex items-start gap-4 p-5 rounded-sm border border-border bg-card hover:bg-secondary transition-colors">
                <Mail className="h-5 w-5 text-amber mt-0.5" />
                <div>
                  <div className="eyebrow !text-[10px]">Email</div>
                  <div className="font-display text-[18px] text-ink break-all">{business.email}</div>
                </div>
              </a>)}
              <div className="flex items-start gap-4 p-5 rounded-sm border border-border bg-card">
                <MapPin className="h-5 w-5 text-amber mt-0.5" />
                <div>
                  <div className="eyebrow !text-[10px]">Based in</div>
                  <div className="font-display text-[18px] text-ink">{business.city}, {business.state} {business.zip}</div>
                  <div className="text-[13px] text-muted-foreground mt-1">{client.trust.areas.join(", ")}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            {client.trust.bookingUrl && <a className="inline-flex mb-6 px-5 py-3 rounded-sm bg-amber text-ink" href={client.trust.bookingUrl}>Request an appointment</a>}
            <ContactForm />
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactForm() {
  const handle = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); };
  return (
    <form onSubmit={handle} className="bg-card border border-border rounded-sm p-8 lg:p-10 shadow-soft space-y-5">
      {/* Honeypot — hidden from users, catches bots */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <div className="eyebrow">Project inquiry</div>
      <h2 className="font-display text-[28px] text-ink">Tell us about the job.</h2>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Your name" name="name" required />
        <Field label="Phone" name="phone" type="tel" required />
        <Field label="Email" name="email" type="email" required />
        <Field label="City" name="city" placeholder={business.city} />
      </div>

      <label className="block">
        <span className="eyebrow !text-[10px]">Project type</span>
        <select name="project" className="mt-2 w-full bg-background border border-input rounded-sm px-4 py-3 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-ring">
          {client.services.map(s=><option key={s.name}>{s.name}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow !text-[10px]">Details</span>
        <textarea name="message" required rows={5} placeholder="Rooms involved, square footage if you know it, timeline…" className="mt-2 w-full bg-background border border-input rounded-sm px-4 py-3 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
      </label>

      <p role="status">Online submission is unavailable. Please call {business.phone}.</p>

      <button
        type="submit"
        disabled
        className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-amber text-ink font-semibold shadow-amber hover:brightness-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Send className="h-4 w-4" /> Online submission unavailable
      </button>
      <p className="text-[12px] text-muted-foreground">This form does not send or save your details. View our <Link to="/privacy-policy" className="underline hover:text-amber">Privacy Policy</Link>.</p>
    </form>
  );
}

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="eyebrow !text-[10px]">{label}{required && <span className="text-amber"> *</span>}</span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full bg-background border border-input rounded-sm px-4 py-3 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
