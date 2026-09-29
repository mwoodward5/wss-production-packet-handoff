import { getSite, sectionCopy, hoursText, mapEmbed } from "@/lib/wss";
import { useEffect, useState } from "react";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { BUSINESS } from "@/lib/business";

export function Contact({initialService=""}:{initialService?:string} = {}) {
  const c=getSite();
  const [service,setService]=useState(c.services.some(s=>s.name===initialService) ? initialService : "");
  const [notice,setNotice]=useState("");
  useEffect(()=>{const select=(e:Event)=>{const name=(e as CustomEvent<string>).detail;if(c.services.some(s=>s.name===name))setService(name);};window.addEventListener("wss-select-service",select);return ()=>window.removeEventListener("wss-select-service",select);},[c]);
  const osmEmbed=mapEmbed();
  function onSubmit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); setNotice(c.identity.email ? "Online sending is unavailable. Please call or email us with these details." : "Online sending is unavailable. Please call us with these details."); }

  return (
    <section id="contact" className="relative py-24 sm:py-32 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-5">
          <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">§ 07 — Book your vehicle</span>
          <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
            {c.content.ctaHeadline || <>Tell us about the <em className="text-accent not-italic">vehicle</em>.</>}
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed max-w-md text-pretty whitespace-pre-line">
            {sectionCopy('contact',c.content.ctaBody) || (c.identity.email ? "Call or email to discuss your vehicle." : "Call to discuss your vehicle.")}
          </p>
          {c.content.seasonalNote && <p className="mt-3 text-sm text-muted-foreground">{c.content.seasonalNote}</p>}

          <div className="mt-10 space-y-5">
            {c.trust.bookingUrl && <a className="inline-flex rounded-full bg-accent px-7 py-3 text-accent-foreground" href={c.trust.bookingUrl}>Book an appointment</a>}
            <a href={BUSINESS.phoneHref} className="flex items-start gap-4 group">
              <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background group-hover:bg-accent transition-colors"><Phone className="h-4 w-4" /></span>
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Call · click to dial</div>
                <div className="font-display text-2xl">{BUSINESS.phone}</div>
              </div>
            </a>
            {BUSINESS.email && <a href={`mailto:${BUSINESS.email}`} className="flex items-start gap-4 group">
              <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background group-hover:bg-accent transition-colors"><Mail className="h-4 w-4" /></span>
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Email</div>
                <div className="font-display text-base sm:text-lg break-all">{BUSINESS.email}</div>
              </div>
            </a>}
            <div className="flex items-start gap-4">
              <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background"><MapPin className="h-4 w-4" /></span>
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Location</div>
                <div className="font-display text-lg">{c.identity.city}, {c.identity.state}</div>
              </div>
            </div>
            {hoursText() && <>
            <div className="flex items-start gap-4">
              <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background"><Clock className="h-4 w-4" /></span>
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Hours</div>
                <div className="font-display text-lg">{hoursText()}</div>
              </div>
            </div>
            </>}
          </div>

          {(osmEmbed || c.trust.mapUrl) && <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            {osmEmbed && <div className="relative aspect-[16/10] w-full bg-secondary">
              <iframe
                title={`Map for ${c.identity.businessName}`}
                src={osmEmbed}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-t border-border">
              {c.trust.areas.length > 0 && <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Service area</div>
                <div className="text-sm">{c.trust.areas.join(" · ")}</div>
              </div>}
              <div className="flex flex-wrap gap-2">
                {c.trust.mapUrl && <a
                  href={BUSINESS.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-xs font-medium tracking-wide hover:bg-secondary transition"
                >
                  Map and directions
                </a>}
              </div>
            </div>
          </div>}
        </div>

        <div className="col-span-12 lg:col-span-7">
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-border bg-card p-7 sm:p-10 shadow-[var(--shadow-card)]"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Your name" name="name" required />
              <Field label="Phone" name="phone" type="tel" required />
              <Field label="Email" name="email" type="email" className="sm:col-span-2" />
              <Field label="Vehicle (year, make, model)" name="location" placeholder="Year, make, model" className="sm:col-span-2" />
              <Select
                label="What service?"
                name="service"
                options={BUSINESS.services}
                value={service}
                onChange={setService}
                className="sm:col-span-2"
              />
              <div className="sm:col-span-2">
                <label htmlFor="message" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Tell us what the vehicle needs</label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  className="mt-2 w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring resize-none"
                  placeholder="Condition, problem areas and timing."
                />
              </div>
            </div>

            <div className="mt-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-xs text-muted-foreground max-w-sm">
                Prepare your enquiry here, then {c.identity.email ? "call or email" : "call"}. This form does not send data.
              </p>
              <button
                type="submit"
                disabled
                className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-7 py-3.5 text-accent-foreground text-sm font-medium hover:bg-foreground transition disabled:opacity-70 min-w-[180px]"
              >
                Online sending unavailable
              </button>
            </div>
            {notice && <p role="status">{notice}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  className = "",
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</label>
      <input
        type={type}
        id={name}
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
      />
    </div>
  );
}

function Select({
  label,
  name,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (value:string)=>void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</label>
      <select
        id={name}
        name={name}
        className="mt-2 w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
        value={value}
        onChange={e=>onChange(e.target.value)}
      >
        <option value="" disabled>Choose one…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
