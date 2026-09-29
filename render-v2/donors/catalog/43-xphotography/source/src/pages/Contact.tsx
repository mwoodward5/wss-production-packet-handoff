import {useSite,richCopy,paragraphs} from "@/wss/bridge";
import { useState } from "react";
import { Phone, Mail, MapPin, Send, Check } from "lucide-react";
import { z } from "zod";
import Seo from "@/components/Seo";
import Monogram from "@/components/Monogram";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Valid email required").max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  type: z.string().min(1, "Please select a session type"),
  date: z.string().max(40).optional().or(z.literal("")),
  location: z.string().max(200).optional().or(z.literal("")),
  budget: z.string().max(80).optional().or(z.literal("")),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

export default function Contact() {
  const {client}=useSite();
  const types=client.services.map(s=>s.name);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd.entries());
    const result = schema.safeParse(data);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }
    if(!types.includes(result.data.type)){setErrors({type:"Select an available session"});return;}
    setErrors({});
    const d = result.data;
    const subject = encodeURIComponent(`New Inquiry — ${d.type} — ${d.name}`);
    const body = encodeURIComponent(
      `Name: ${d.name}\nEmail: ${d.email}\nPhone: ${d.phone || "-"}\nSession Type: ${d.type}\nDate: ${d.date || "-"}\nLocation: ${d.location || "-"}\nBudget: ${d.budget || "-"}\n\nMessage:\n${d.message}`
    );
    window.location.href = `mailto:${client.identity.email}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  return (
    <>
      <Seo title={`Contact · ${client.identity.businessName}`}
        description={client.content.ctaBody || client.hero.support}
        path="/contact" />

      <section className="pt-44 pb-12 bg-paper relative overflow-hidden">
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container max-w-6xl">
          <div className="label-eyebrow text-molten mb-6">Reserve · Folio 008</div>
          <h1 className="font-display text-[11.2vw] md:text-[7.2vw] lg:text-[6.4vw] text-ivory leading-[0.88] tracking-[-0.04em] text-balance">
            Let's begin <span className="italic text-molten">your story</span>.
          </h1>
          <p className="mt-8 max-w-2xl text-ivory/70 text-lg">
            Contact {client.identity.businessName}.
          </p>
        </div>
      </section>

      <section className="pb-32 bg-paper">
        <div className="container grid lg:grid-cols-12 gap-10">
          <aside className="lg:col-span-4 space-y-6">
            <div className="bg-paper-soft border border-ivory/10 p-8">
              <Monogram size={40} className="text-molten mb-4" />
              <div className="label-eyebrow text-molten mb-3">Studio</div>
              <h3 className="font-display text-2xl mb-6 text-ivory">{client.identity.businessName} · {client.identity.city}</h3>
              <div className="space-y-4 text-sm text-ivory/80">
                <a href={client.identity.phoneTel} className="flex items-center gap-3 hover:text-molten"><Phone className="w-4 h-4 text-molten" /> {client.identity.phoneDisplay}</a>
                {client.identity.email && <a href={`mailto:${client.identity.email}`} className="flex items-center gap-3 hover:text-molten"><Mail className="w-4 h-4 text-molten" /> {client.identity.email}</a>}
                <div className="flex items-center gap-3"><MapPin className="w-4 h-4 text-molten" /> {client.identity.city}, {client.identity.state}</div>
              </div>
            </div>
            {paragraphs(richCopy('contact')).map((p,i)=><p key={i} className="text-ivory/75 text-sm">{p}</p>)}
            {client.trust.hours && typeof client.trust.hours==='object' && 'text' in client.trust.hours && typeof client.trust.hours.text==='string' && <p>{client.trust.hours.text}</p>}
            {client.trust.mapUrl && <a href={client.trust.mapUrl} className="label-eyebrow text-molten">Map and directions</a>}
            {client.trust.bookingUrl && <a href={client.trust.bookingUrl} className="label-eyebrow text-molten">Booking</a>}
          </aside>

          <div className="lg:col-span-8">
            {!client.identity.email ? <a href={client.identity.phoneTel}>Call {client.identity.phoneDisplay}</a> : sent ? (
              <div className="glass p-16 text-center border border-molten/30">
                <Check className="w-12 h-12 text-molten mx-auto mb-4" />
                <h3 className="font-display text-4xl text-ivory mb-3">Complete your email.</h3>
                <p className="text-ivory/70">Your email app may have opened. Send it there to complete your inquiry, or email {client.identity.email}. Nothing has been sent by this website.</p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-6 glass p-8 md:p-10 border border-ivory/10">
                <div className="grid md:grid-cols-2 gap-6">
                  <Field label="Full Name" name="name" error={errors.name} required />
                  <Field label="Email" name="email" type="email" error={errors.email} required />
                  <Field label="Phone" name="phone" type="tel" error={errors.phone} />
                  <Select label="Session Type" name="type" options={types} error={errors.type} required />
                  <Field label="Event / Session Date" name="date" type="date" error={errors.date} />
                  <Field label="Location" name="location" placeholder="Venue or city" error={errors.location} />
                </div>
                <Field label="Budget / Package Interest" name="budget" error={errors.budget} />
                <div>
                  <label htmlFor="contact-message" className="label-eyebrow text-ivory/60 block mb-2">Tell me about your vision *</label>
                  <textarea id="contact-message" required name="message" rows={6} maxLength={2000} className="w-full bg-paper/50 border border-ivory/15 px-4 py-3 focus:border-molten outline-none text-ivory" />
                  {errors.message && <div className="text-destructive text-xs mt-1">{errors.message}</div>}
                </div>
                <button type="submit" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">
                  Open Email Draft <Send className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Field({ label, name, type = "text", error, required, placeholder }: any) {
  return (
    <div>
      <label htmlFor={name} className="label-eyebrow text-ivory/60 block mb-2">{label}{required && " *"}</label>
      <input id={name} required={required} type={type} name={name} placeholder={placeholder} maxLength={200} className="w-full bg-paper/50 border border-ivory/15 px-4 py-3 focus:border-molten outline-none text-ivory" />
      {error && <div className="text-destructive text-xs mt-1">{error}</div>}
    </div>
  );
}
function Select({ label, name, options, error, required }: any) {
  return (
    <div>
      <label htmlFor={name} className="label-eyebrow text-ivory/60 block mb-2">{label}{required && " *"}</label>
      <select id={name} required={required} name={name} defaultValue="" className="w-full bg-paper/50 border border-ivory/15 px-4 py-3 focus:border-molten outline-none text-ivory">
        <option value="" disabled>Select…</option>
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <div className="text-destructive text-xs mt-1">{error}</div>}
    </div>
  );
}
