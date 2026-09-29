/**
 * Lead form — POSTs to /api/lead.
 * Includes protected DEUCES service options + honeypot.
 */
import { useState } from "react";
import { CLIENT, PROTECTED_SERVICE_TERMS } from "@/config";

export function LeadForm({
  topic = "General Inquiry",
  cta = "Send message",
  defaultService,
  className = "",
}: {
  topic?: string;
  cta?: string;
  defaultService?: string;
  className?: string;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); }
  return (
    <form onSubmit={onSubmit} className={`grid gap-3 ${className}`}>
      {/* honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off"
        className="hidden" aria-hidden defaultValue="" />

      <div className="grid sm:grid-cols-2 gap-3">
        <input required name="name" aria-label="Your name" placeholder="Your name"
          className="rounded-lg border border-border bg-background px-4 py-3 text-sm" />
        <input required type="tel" name="phone" aria-label="Phone" placeholder="Phone"
          className="rounded-lg border border-border bg-background px-4 py-3 text-sm" />
      </div>
      <input required type="email" name="email" aria-label="Email" placeholder="Email"
        className="rounded-lg border border-border bg-background px-4 py-3 text-sm" />

      <label className="sr-only" htmlFor="lead-service">Service</label>
      <select
        id="lead-service"
        name="service"
        defaultValue={defaultService ?? ""}
        className="rounded-lg border border-border bg-background px-4 py-3 text-sm capitalize"
      >
        <option value="">What service do you need?</option>
        {PROTECTED_SERVICE_TERMS.map((s) => (
          <option key={s} value={s} className="capitalize">{s}</option>
        ))}
        <option value="other">Something else</option>
      </select>

      <textarea required name="message" aria-label="Project details" rows={4} placeholder="Tell us about the project — location, timing, anything we should know."
        className="rounded-lg border border-border bg-background px-4 py-3 text-sm" />

      <button type="submit" disabled className="btn-gold justify-center disabled:opacity-60">Online sending unavailable</button>
      <p className="text-sm text-muted-foreground">This form does not send messages. Contact us directly.</p>
      <a className="btn-gold justify-center" href={`tel:${CLIENT.phoneE164}`}>Call {CLIENT.phone}</a>
      {CLIENT.email && <a className="btn-ghost-gold justify-center" href={`mailto:${CLIENT.email}`}>Email {CLIENT.email}</a>}
    </form>
  );
}
