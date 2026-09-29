import {services as clientServices} from "@/lib/wss";
import {openEmailDraft} from "@/lib/contact-draft";
import { site, gallery, portrait, aboutImage, pageCopy, hoursText } from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { useState } from "react";

import { business } from "@/lib/business";

import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { ContactPageSchema } from "@/components/site/Schema";
import { LocationMap } from "@/components/site/LocationMap";




const services = clientServices.map(s=>s.title);

const timelines = [
  "As soon as possible", "Within 1 month", "1–3 months",
  "3–6 months", "Just exploring",
];

const budgets = [
  "Under $5,000", "$5,000 – $15,000", "$15,000 – $50,000",
  "$50,000 – $150,000", "$150,000+", "Not sure yet",
];

export function ContactPage() {
  const search = Object.fromEntries(new URLSearchParams(window.location.search));
  
  
  
  

  // Resolve initial values from search params (deep-link routing)
  const initialService = services.includes(search.service) ? search.service : "";
  const initialCity = search.city ?? "";
  const initialMessage = search.message || "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); openEmailDraft(new FormData(e.currentTarget)); }

  

  return (
    <>
      <ContactPageSchema />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Contact" }]} />
      <section className="border-b border-rule bg-cream py-20 lg:py-28">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <p className="eyebrow">[ Contact ]</p>
          <h1 className="mt-4 display-xl text-[clamp(2.75rem,7vw,6rem)] text-ink">
            Tell us about<br />
            <span className="italic-fraunces text-umber">the project.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-charcoal/80 text-pretty">Prepare your project details, then open your email app to send them. Nothing is sent by this website.</p>
          {pageCopy('contact') && <p className="mt-4 max-w-2xl text-charcoal/80 whitespace-pre-line">{pageCopy('contact')}</p>}
        </div>
      </section>

      <section className="bg-cream py-16 lg:py-24">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-5 lg:grid-cols-12 lg:gap-16 lg:px-10">
          {/* Left: contact card */}
          <aside className="lg:col-span-4">
            <div className="border border-rule bg-bone p-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">[ Direct line ]</p>
              <a href={`tel:${business.phoneTel}`} className="mt-3 block font-display text-3xl text-ink link-underline">
                {business.phone}
              </a>
              {business.email && (<a href={`mailto:${business.email}`} className="mt-2 block break-all text-sm text-charcoal/80 link-underline">
                {business.email}
              </a>)}

              <hr className="my-6 border-rule" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{hoursText ? "[ Hours ]" : ""}</p>
              <p className="mt-3 text-charcoal">{hoursText}</p>
              

              <hr className="my-6 border-rule" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">[ Based in ]</p>
              <p className="mt-3 font-display text-xl text-ink">{business.city}, {business.state}</p>
              <p className="text-sm text-charcoal/70">{site.trust.areas.join(" · ")}</p>
              {site.trust.mapUrl && <a href={site.trust.mapUrl} className="mt-3 block link-underline">Map and directions →</a>}
              {site.trust.bookingUrl && <a href={site.trust.bookingUrl} className="mt-3 block link-underline">Booking →</a>}

              <hr className="my-6 border-rule" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{site.trust.badges.length ? "[ Details ]" : ""}</p>
              <ul className="mt-3 space-y-1 text-sm text-charcoal/80">{site.trust.badges.map(b=><li key={b.label}>◆ {b.label}</li>)}</ul>
            </div>
          </aside>

          {/* Right: form */}
          <div className="lg:col-span-8">
            {(
              <form onSubmit={handleSubmit} className="grid gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Your name" name="name" required autoComplete="name" />
                  <Field label="Email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
                  <Field
                    label="City / Town"
                    name="city"
                    placeholder="City or town"
                    defaultValue={initialCity}
                  />
                </div>

                <SelectField label="What are you considering?" name="service" options={services} required defaultValue={initialService} />

                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField label="Ideal start" name="timeline" options={timelines} defaultValue={search.timeline} />
                  <SelectField label="Approximate budget" name="budget" options={budgets} defaultValue={search.budget} />
                </div>

                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">Project details</label>
                  <textarea
                    name="message"
                    required
                    rows={6}
                    maxLength={2000}
                    defaultValue={initialMessage}
                    className="mt-2 w-full border border-rule bg-cream px-4 py-3 text-charcoal focus:border-ink focus:outline-none"
                    placeholder="Scope, materials, and anything you would like to discuss."
                  />
                </div>

                <fieldset>
                  <legend className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
                    Best way to reach you
                  </legend>
                  <div className="mt-3 flex flex-wrap gap-4">
                    {[
                      { v: "phone", label: "Phone call" },
                      { v: "text", label: "Text message" },
                      { v: "email", label: "Email" },
                      { v: "either", label: "Either is fine" },
                    ].map((o) => (
                      <label key={o.v} className="flex items-center gap-2 text-sm text-charcoal">
                        <input type="radio" name="contactPreference" value={o.v} defaultChecked={o.v === "either"} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                

                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <button type="submit" disabled={!business.email} className="btn-primary disabled:opacity-50">Open email draft →</button>
                  <a href={`tel:${business.phoneTel}`} className="btn-ghost">
                    Or call ☎ {business.phone}
                  </a>
                </div>
                <p className="text-xs text-charcoal/60">{business.email ? "Your email app opens a draft. Review it and send it there." : "Please call to discuss your project."}</p>
              </form>
            )}
          </div>
        </div>
      </section>

      <LocationMap />
    </>
  );
}

function Field({
  label, name, type = "text", required, autoComplete, placeholder, defaultValue,
}: { label: string; name: string; type?: string; required?: boolean; autoComplete?: string; placeholder?: string; defaultValue?: string }) {
  return (
    <div>
      <label htmlFor={name} className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
        {label}{required && " *"}
      </label>
      <input
        id={name} name={name} type={type} required={required} autoComplete={autoComplete}
        placeholder={placeholder} maxLength={200} defaultValue={defaultValue}
        className="mt-2 w-full border border-rule bg-cream px-4 py-3 text-charcoal focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label, name, options, required, defaultValue,
}: { label: string; name: string; options: readonly string[]; required?: boolean; defaultValue?: string }) {
  const initial = defaultValue && options.includes(defaultValue) ? defaultValue : "";
  return (
    <div>
      <label htmlFor={name} className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
        {label}{required && " *"}
      </label>
      <select
        id={name} name={name} required={required} defaultValue={initial}
        className="mt-2 w-full border border-rule bg-cream px-4 py-3 text-charcoal focus:border-ink focus:outline-none"
      >
        <option value="" disabled>Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
