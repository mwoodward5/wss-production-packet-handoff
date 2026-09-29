import {services} from "@/lib/wss";
import {openEmailDraft} from "@/lib/contact-draft";
import { useState } from "react";
import { Link } from "@/lib/navigation";

import { business } from "@/lib/business";


/**
 * Compact inline lead-capture form. Drop into any page section.
 *
 * Pass `defaultService` (free-form or slug) and/or `defaultCity` to pre-fill
 * the form for service / location pages — the confirmation copy then tailors
 * itself to that context.
 */
export function InlineLeadForm({
  variant = "light",
  defaultService = "",
  defaultCity = "",
  eyebrow = "[ Quick estimate request ]",
  heading = "Tell us about the project.",
}: {
  variant?: "light" | "dark";
  defaultService?: string;
  defaultCity?: string;
  eyebrow?: string;
  heading?: string;
}) {
  
  
  
  

  function onSubmit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); openEmailDraft(new FormData(e.currentTarget)); }

  const dark = variant === "dark";
  const labelCls = `font-mono text-[10px] uppercase tracking-[0.22em] ${dark ? "text-amber-glow" : "text-umber"}`;
  const inputCls = `mt-1.5 w-full border-b bg-transparent px-0 py-2 text-sm outline-none transition-colors focus:border-current ${
    dark ? "border-cream/25 text-cream placeholder:text-cream/40" : "border-rule text-ink placeholder:text-charcoal/40"
  }`;

  

  return (
    <form
      onSubmit={onSubmit}
      className={`border p-6 sm:p-8 ${
        dark ? "border-cream/20 bg-ink/40 text-cream backdrop-blur" : "border-rule bg-cream text-ink"
      }`}
    >
      <p className={labelCls}>{eyebrow}</p>
      <h3 className={`mt-3 font-display text-3xl leading-tight ${dark ? "text-cream" : "text-ink"}`}>
        {heading}
      </h3>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="il-name">Your name</label>
          <input id="il-name" name="name" required maxLength={120} className={inputCls} placeholder="Your name" />
        </div>
        <div>
          <label className={labelCls} htmlFor="il-phone">Phone</label>
          <input id="il-phone" name="phone" type="tel" maxLength={40} className={inputCls} placeholder="Your phone number" />
        </div>
        <div>
          <label className={labelCls} htmlFor="il-email">Email</label>
          <input id="il-email" name="email" type="email" required maxLength={200} className={inputCls} placeholder="you@example.com" />
        </div>
        <div>
          <label className={labelCls} htmlFor="il-city">City / town</label>
          <input id="il-city" name="city" defaultValue={defaultCity} maxLength={120} className={inputCls} placeholder="City or town" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="il-service">What do you need?</label>
          <select id="il-service" name="service" required defaultValue={services.some(s=>s.title===defaultService) ? defaultService : ""} className={inputCls}><option value="">Select a service</option>{services.map(s=><option key={s.slug}>{s.title}</option>)}</select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="il-message">A few details</label>
          <textarea
            id="il-message"
            name="message"
            rows={3}
            required
            minLength={5}
            maxLength={2000}
            className={inputCls}
            placeholder="Rough scope, timing, budget if you have one in mind."
          />
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={!business.email}
          className={dark ? "btn-amber" : "btn-primary"}
        >
          Open email draft
          <span aria-hidden>→</span>
        </button>
        <a
          href={`tel:${business.phoneTel}`}
          className={`font-mono text-[11px] uppercase tracking-[0.22em] ${
            dark ? "text-cream/80 hover:text-amber-glow" : "text-charcoal hover:text-ink"
          }`}
        >
          or call · {business.phone}
        </a>
      </div>

      <p className="mt-4 text-sm">{business.email ? "Opens your email app. Review and send the draft there; nothing is sent by this website." : "Please call to discuss your project."}</p>
    </form>
  );
}
