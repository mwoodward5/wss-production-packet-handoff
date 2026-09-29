import { useClient } from "@/wss/bridge";
import { Phone, Mail, MapPin, ArrowRight } from "lucide-react";
import { useState } from "react";

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold mb-2 text-foreground">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <input
        type={type}
        id={name}
        name={name}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent transition"
      />
    </div>
  );
}

export function Contact() {
  const {client, plan} = useClient();
  const [draft, setDraft] = useState("");
  return (
    <section id="contact" className="py-24 md:py-32 bg-secondary relative">
      <div className="container-tight grid lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2 reveal">
          <span className="eyebrow mb-5">Get In Touch</span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-[3.25rem] font-bold uppercase leading-[0.98] mb-6 text-balance mt-4">
            {client.content.ctaHeadline || "Discuss your project"}
          </h2>
          <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
            {plan?.content?.contact || client.content.ctaBody || "Call to discuss your project."}
          </p>
          <div className="space-y-4">
            {client.trust.bookingUrl && <a className="block p-5 rounded-xl bg-card border border-border underline" href={client.trust.bookingUrl}>Book an appointment</a>}
            {typeof client.trust.hours?.text === 'string' && <p className="p-5 rounded-xl bg-card border border-border">{client.trust.hours.text}</p>}
            <a href={client.identity.phoneTel} className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border shadow-card hover:shadow-deep transition">
              <div className="h-12 w-12 rounded-md bg-gradient-amber flex items-center justify-center text-accent-foreground shrink-0"><Phone className="h-5 w-5" /></div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Call us</div>
                <div className="font-display text-xl font-bold">{client.identity.phoneDisplay}</div>
              </div>
            </a>
            {client.identity.email && <a href={"mailto:" + client.identity.email} className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border shadow-card hover:shadow-deep transition min-w-0">
              <div className="h-12 w-12 rounded-md bg-gradient-amber flex items-center justify-center text-accent-foreground shrink-0"><Mail className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Email us</div>
                <div className="font-display text-base sm:text-lg font-bold break-all">{client.identity.email}</div>
              </div>
            </a>}
            <div className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border shadow-card">
              <div className="h-12 w-12 rounded-md bg-gradient-amber flex items-center justify-center text-accent-foreground shrink-0"><MapPin className="h-5 w-5" /></div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Based in</div>
                <div className="font-display text-xl font-bold">{client.identity.city}, {client.identity.state}</div>
              </div>
            </div>
          </div>
        </div>
        <form
          className="lg:col-span-3 bg-card border border-border rounded-2xl shadow-card p-7 md:p-10"
          onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); setDraft(Array.from(data.entries()).map(([k,v]) => k + ": " + v).join("\n")); }}
        >
          <h3 className="font-display text-2xl font-bold uppercase tracking-wide mb-6">Request a Quote</h3>
          <p className="text-sm text-muted-foreground mb-5">This form prepares a draft only. Call us or open your email app to send it.</p>
          {draft && <div role="status" className="p-6 rounded-md bg-accent/15 border border-accent/40 mb-5"><p>Draft prepared — nothing has been sent.</p><pre className="whitespace-pre-wrap text-sm">{draft}</pre>{client.identity.email && <a className="underline" href={'mailto:' + client.identity.email + '?subject=' + encodeURIComponent('Project inquiry') + '&body=' + encodeURIComponent(draft)}>Open email draft</a>}</div>}
            <div className="grid gap-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Name" name="name" required />
                <Field label="Phone" name="phone" type="tel" />
              </div>
              <Field label="Email" name="email" type="email" required />
              <Field label="Project location" name="location" placeholder="City / address or area" />
              <div>
                <label htmlFor="message" className="block text-sm font-semibold mb-2 text-foreground">Project details</label>
                <textarea
                  id="message" name="message"
                  rows={5}
                  required
                  className="w-full rounded-md border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent transition"
                  placeholder="Describe your project."
                />
              </div>
              <button type="submit" className="inline-flex items-center justify-center gap-2 bg-gradient-amber text-accent-foreground font-bold px-6 py-4 rounded-md shadow-card hover:brightness-105 transition uppercase tracking-wide text-sm">
                Prepare Draft <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-xs text-muted-foreground">Preparing a draft does not deliver a message.</p>
            </div>
        </form>
      </div>
    </section>
  );
}
