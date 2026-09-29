/** Prepares an email draft. The visitor sends it from their email app. */
import { useState } from "react";
import { CLIENT, SERVICES } from "@/config";



type Status = "idle" | "draft";

export function LeadForm({
  topic = "General Inquiry",
  cta = "Open email draft",
  className = "",
}: {
  topic?: string;
  cta?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mailtoHref, setMailtoHref] = useState<string>("");

  function validate(data: Record<string, string>) {
    const e: Record<string, string> = {};
    if (!data.name?.trim()) e.name = "Name is required";
    if (!data.phone?.trim() || data.phone.replace(/\D/g, "").length < 7) e.phone = "Valid phone is required";
    if (!data.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) e.email = "Valid email is required";
    if (!data.service?.trim()) e.service = "Select a service";
    if (!data.message?.trim()) e.message = "Message is required";
    return e;
  }

  function buildMailto(data: Record<string, string>) {
    const subject = encodeURIComponent(`Inquiry for ${CLIENT.businessName} — ${data.service || topic}`);
    const body = encodeURIComponent(
      `Name: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email}\nService: ${data.service}\nAddress: ${data.address || "(not provided)"}\n\nMessage:\n${data.message}`,
    );
    return `mailto:${CLIENT.email}?subject=${subject}&body=${body}`;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (data.website || !CLIENT.email) return; // honeypot

    const fieldErrors = validate(data);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;

    
    const href = buildMailto(data);
    setMailtoHref(href);

    window.location.href = href;
    setStatus("draft");
  }

  const inputCls = "rounded-lg border border-border bg-background px-4 py-3 text-sm";
  const errCls = "text-xs text-destructive mt-1";

  return (
    <form onSubmit={onSubmit} noValidate className={`grid gap-3 ${className}`}>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1">
          <input name="name" placeholder="Your name *" className={inputCls} aria-invalid={!!errors.name} />
          {errors.name && <span className={errCls}>{errors.name}</span>}
        </div>
        <div className="grid gap-1">
          <input type="tel" name="phone" placeholder="Phone *" className={inputCls} aria-invalid={!!errors.phone} />
          {errors.phone && <span className={errCls}>{errors.phone}</span>}
        </div>
      </div>

      <div className="grid gap-1">
        <input type="email" name="email" placeholder="Email *" className={inputCls} aria-invalid={!!errors.email} />
        {errors.email && <span className={errCls}>{errors.email}</span>}
      </div>

      <div className="grid gap-1">
        <select name="service" defaultValue="" className={inputCls} aria-invalid={!!errors.service}>
          <option value="" disabled>Select a service *</option>
          {SERVICES.map((s) => <option key={s.slug} value={s.name}>{s.name}</option>)}
        </select>
        {errors.service && <span className={errCls}>{errors.service}</span>}
      </div>

      <input name="address" placeholder="Service address (optional)" className={inputCls} />

      <div className="grid gap-1">
        <textarea name="message" rows={4} placeholder="How can we help? *" className={inputCls} aria-invalid={!!errors.message} />
        {errors.message && <span className={errCls}>{errors.message}</span>}
      </div>

      <button
        type="submit"
        disabled={!CLIENT.email}
        className="rounded-lg bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-60"
      >
        {cta}
      </button>

      {!CLIENT.email && <p className="text-sm">Call {CLIENT.phone} to discuss your request.</p>}
      {status === "draft" && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm grid gap-3">
          <p className="text-foreground">
            Your email app was asked to open a draft. Send it there to submit your request,
            or use the contact options below:{" "}
            <a href={`tel:${CLIENT.phoneE164}`} className="text-primary font-semibold underline">{CLIENT.phone}</a>.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${CLIENT.phoneE164}`} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">
              Call {CLIENT.phone}
            </a>
            {CLIENT.smsE164 && (
              <a href={`sms:${CLIENT.smsE164}`} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">
                Text us
              </a>
            )}
            <a href={mailtoHref} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">
              Open email draft
            </a>
          </div>
        </div>
      )}
    </form>
  );
}
