import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Check, Phone, Mail } from "lucide-react";
import { z } from "zod";
import Seo from "@/components/Seo";
import SideRail from "@/components/SideRail";
import Breadcrumbs from "@/components/Breadcrumbs";
import Monogram from "@/components/Monogram";
import {useSite} from "@/wss/bridge";

const REFERRALS = ["Google search", "Instagram", "Friend or past client", "Wedding planner", "Other"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  email: z.string().trim().email("Valid email required").max(255),
  phone: z.string().trim().min(7, "Phone required").max(40),
  sessionType: z.string().min(1),
  eventDate: z.string().trim().max(40).optional().or(z.literal("")),
  venue: z.string().trim().max(200).optional().or(z.literal("")),
  message: z.string().trim().min(1, "Tell me a little about the day").max(2000),
  referral: z.string().trim().max(60).optional().or(z.literal("")),
});

export default function Reserve() {
  const {client}=useSite();
  const BRAND={name:client.identity.businessName,email:client.identity.email,phone:client.identity.phoneDisplay,phoneHref:client.identity.phoneTel};
  const SESSION_TYPES=client.services.map(s=>s.name);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }
    if(!SESSION_TYPES.includes(parsed.data.sessionType)){setErrors({sessionType:"Select an available session"});return;}
    setErrors({});
    const d = parsed.data;
    const subject = `New inquiry — ${d.sessionType}${d.eventDate ? ` · ${d.eventDate}` : ""} — ${d.name}`;
    const body =
`Name: ${d.name}
Email: ${d.email}
Phone: ${d.phone}
Session: ${d.sessionType}
Event date: ${d.eventDate || "—"}
Venue / location: ${d.venue || "—"}
Referral: ${d.referral || "—"}

${d.message}

`;
    const mailto = `mailto:${BRAND.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setDone(true);
  };

  return (
    <>
      <Seo
        title={`Reserve · ${client.identity.businessName}`}
        description={client.content.ctaBody || client.hero.support}
        path="/reserve"

      />
      <Breadcrumbs trail={[{ name: "Reserve", path: "/reserve" }]} hideVisual />

      <section className="relative pt-44 pb-12 bg-paper overflow-hidden">
        <SideRail label="RESERVE · 010" meta={["INQUIRY"]} />
        <div className="container max-w-5xl">
          <div className="label-eyebrow text-molten mb-6">Folio 010 · Reserve</div>
          <h1 className="font-display text-[9.6vw] md:text-[5.6vw] lg:text-[4.4vw] text-ivory leading-[0.88] tracking-[-0.03em] text-balance">
            Reserve <span className="italic text-molten">your date</span>.
          </h1>
          <p className="mt-8 max-w-2xl text-ivory/70 text-lg">
            Ask {client.identity.businessName} about your date.
          </p>
        </div>
      </section>

      <section className="bg-paper-soft py-20 md:py-28 border-y border-ivory/10">
        <div className="container max-w-3xl">
          {!client.identity.email ? <a href={client.identity.phoneTel}>Call {client.identity.phoneDisplay}</a> : done ? (
            <ThankYou />
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-7">
              <Row>
                <Field name="name" label="Full name" required error={errors.name} />
                <Field name="email" label="Email" type="email" required error={errors.email} />
              </Row>
              <Row>
                <Field name="phone" label="Phone" type="tel" required error={errors.phone} />
                <Select name="sessionType" label="Session type" required options={[...SESSION_TYPES]} error={errors.sessionType} />
              </Row>
              <Row>
                <Field name="eventDate" label="Event date (or month)" placeholder="e.g. October 2026" error={errors.eventDate} />
                <Field name="venue" label="Venue or location" placeholder="Venue or city" error={errors.venue} />
              </Row>
              <Textarea name="message" label="Tell me about the day" required rows={6}
                placeholder="A few sentences about who you are, what you imagine, and what matters most." error={errors.message} />
              <Select name="referral" label="How did you hear about us?" options={[...REFERRALS]} error={errors.referral} />

              <div className="flex flex-wrap items-center gap-4 pt-4">
                <button type="submit" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">
                  Open Email Draft <ArrowRight className="w-4 h-4" />
                </button>
                <a href={BRAND.phoneHref} className="inline-flex items-center gap-3 px-8 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
                  <Phone className="w-4 h-4" /> {BRAND.phone}
                </a>
                <a href={`mailto:${BRAND.email}`} className="inline-flex items-center gap-3 px-8 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
                  <Mail className="w-4 h-4" /> Direct email
                </a>
              </div>
              <p className="text-xs text-ivory/50 font-mono pt-4">
                Submission opens your email client addressed to {BRAND.email} with every field included.
              </p>
            </form>
          )}
        </div>
      </section>
    </>
  );
}

export function BookingRedirect() { return <Navigate to="/reserve" replace />; }

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid md:grid-cols-2 gap-6">{children}</div>;
}

function Label({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label htmlFor={name} className="label-eyebrow text-ivory/60 mb-2 block">
      {label}{required && <span className="text-molten ml-1">*</span>}
    </label>
  );
}

function Field({ name, label, required, type = "text", placeholder, error }: { name: string; label: string; required?: boolean; type?: string; placeholder?: string; error?: string; }) {
  return (
    <div>
      <Label name={name} label={label} required={required} />
      <input id={name} name={name} type={type} required={required} placeholder={placeholder}
        className="w-full bg-paper border border-ivory/15 px-4 py-3 text-ivory focus:border-molten focus:outline-none transition" />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Textarea({ name, label, required, rows = 5, placeholder, error }: { name: string; label: string; required?: boolean; rows?: number; placeholder?: string; error?: string; }) {
  return (
    <div>
      <Label name={name} label={label} required={required} />
      <textarea id={name} name={name} required={required} rows={rows} placeholder={placeholder}
        className="w-full bg-paper border border-ivory/15 px-4 py-3 text-ivory focus:border-molten focus:outline-none transition" />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Select({ name, label, options, required, error }: { name: string; label: string; options: string[]; required?: boolean; error?: string; }) {
  return (
    <div>
      <Label name={name} label={label} required={required} />
      <select id={name} name={name} required={required} defaultValue=""
        className="w-full bg-paper border border-ivory/15 px-4 py-3 text-ivory focus:border-molten focus:outline-none transition">
        <option value="" disabled>Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ThankYou() {
  return (
    <div className="text-center py-16">
      <Monogram size={72} className="text-molten mb-8 mx-auto" />
      <div className="label-eyebrow text-molten mb-4">Email draft</div>
      <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory mb-6 text-balance">
        Complete your <span className="italic text-molten">email</span>.
      </h2>
      <p className="max-w-xl mx-auto text-ivory/70 mb-10">
        Your email app may have opened with these details. Send it there to complete your inquiry. Nothing has been sent by this website.
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <Link to="/portfolio" className="inline-flex items-center gap-3 px-7 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
          <Check className="w-4 h-4" /> Browse the archive
        </Link>
        <Link to="/about" className="inline-flex items-center gap-3 px-7 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
          About
        </Link>
      </div>
    </div>
  );
}
