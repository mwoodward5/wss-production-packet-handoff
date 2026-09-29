import { CLIENT, hoursText, emailDraft } from "@/lib/wss";
import { Phone, Mail, MessageSquare, MapPin, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export function Contact() {

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const phone = String(fd.get("phone") ?? "").trim();
    const project = String(fd.get("project") ?? "").trim();
    if (!name || !phone) {
      toast.error("Please add your name and phone number.");
      return;
    }
    const subject = `Estimate request — ${name}`;
    const body = `Name: ${name}\nPhone: ${phone}\nEmail: ${fd.get("email") ?? ""}\nService: ${fd.get("service") ?? ""}\n\nProject:\n${project}`;
    const href=emailDraft(subject,body);
    if (href) window.location.href=href;
  };

  return (
    <section id="contact" className="relative py-24 md:py-32 bg-secondary/40 border-t border-border">
      <div className="container mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-12 lg:gap-16">
        <div>
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            Get in touch
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            {CLIENT.content.ctaHeadline || "Discuss your project."}
          </h2>
          <p className="mt-5 text-muted-foreground text-lg font-sans">
            {CLIENT.content.ctaBody}
          </p>

          <div className="mt-10 space-y-5">
            {hoursText() && <p className="text-sm whitespace-pre-line"><strong>Hours</strong><br />{hoursText()}</p>}
            <a href={CLIENT.identity.phoneTel} className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-sm bg-gradient-warm flex items-center justify-center shadow-glow">
                <Phone className="h-5 w-5 text-[var(--ink)]" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Call</div>
                <div className="font-display uppercase group-hover:text-[var(--coral)] transition">{CLIENT.identity.phoneDisplay}</div>
              </div>
            </a>
            {CLIENT.identity.email && <a href={`mailto:${CLIENT.identity.email}`} className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-sm bg-secondary border border-border flex items-center justify-center">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Email</div>
                <div className="font-sans font-semibold group-hover:text-[var(--coral)] transition break-all">{CLIENT.identity.email}</div>
              </div>
            </a>}
            {CLIENT.trust.mapUrl && <a href={CLIENT.trust.mapUrl} target="_blank" rel="noreferrer" className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-sm bg-secondary border border-border flex items-center justify-center">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Based in</div>
                <div className="font-display uppercase group-hover:text-[var(--coral)] transition">{CLIENT.identity.city}, {CLIENT.identity.state}</div>
              </div>
            </a>}
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-sm bg-card border border-border p-6 md:p-8 shadow-elegant"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field name="name" label="Full name" required placeholder="Your name" />
            <Field name="phone" label="Phone" required type="tel" placeholder="Your phone" />
          </div>
          <div className="mt-4">
            <Field name="email" label="Email (optional)" type="email" placeholder="you@example.com" />
          </div>
          <label className="block mt-4 text-sm font-semibold">Service<select name="service" className="block mt-1.5 w-full rounded-sm border border-input bg-background px-4 py-3">{CLIENT.services.map(s=><option key={s.name}>{s.name}</option>)}</select></label>
          <div className="mt-4">
            <label className="text-sm font-semibold">Tell us about the project</label>
            <textarea
              name="project"
              rows={5}
              placeholder="Describe your project"
              className="mt-1.5 w-full rounded-sm border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring resize-none font-sans"
            />
          </div>
          <button
            type="submit"
            disabled={!CLIENT.identity.email}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-sm bg-primary text-primary-foreground py-3.5 font-bold uppercase tracking-wider hover:opacity-90 transition disabled:opacity-60"
          >
            Open email draft
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-3 text-xs text-muted-foreground text-center font-sans">
            {CLIENT.identity.email ? "Opens your email app. Nothing is sent until you send the draft." : "Email is unavailable. Please use the phone link."}
          </p>
        </form>
      </div>
    </section>
  );
}

function Field({
  name, label, type = "text", required, placeholder,
}: { name: string; label: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}{required && <span className="text-[var(--coral)]"> *</span>}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-sm border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring font-sans"
      />
    </label>
  );
}
