import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Phone, MapPin, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";



const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  email: z.string().trim().email("Please enter a valid email").max(255),
  phone: z.string().trim().min(7, "Please enter a valid phone").max(20),
  interest: z.string().min(1),
  city: z.string().trim().max(60).optional(),
  message: z.string().trim().max(1000).optional(),
  // Honeypot — must remain empty.
  company: z.string().max(0).optional(),
});

type FormData = z.infer<typeof schema>;

// The copied contract supplies no certified delivery endpoint.
export const Contact = () => {
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { interest: client.services[0].name },
  });

  const onSubmit = () => { toast({ title: "Online requests are unavailable", description: "Please use the phone or email link." }); };

  return (
    <section id="contact" className="relative py-24 md:py-32">
      <div className="container-page">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          {/* Left: Info + admissions journey */}
          <div className="lg:col-span-5">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> 07 — Admissions
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
              {client.content.ctaHeadline || "Contact"}
            </h2>
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              {paragraphs(sitePlan?.content?.contact).join(' ') || client.content.ctaBody}
            </p>

            {/* Admissions journey */}
            <ol className="mt-10 space-y-3">
              {client.trust.badges.map((b,i) => [String(i+1),b.label,b.sublabel]).map(([n,t,d]) => (
                <li
                  key={n}
                  className="flex gap-4 rounded-sm border border-border bg-surface p-4"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-sm bg-gradient-runway font-mono text-xs font-semibold text-primary-foreground">
                    {n}
                  </span>
                  <div>
                    <div className="font-display text-sm font-semibold text-foreground">{t}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>

            {client.trust.reviews.slice(0, 3).map(r => <blockquote key={r.sourceUrl + r.author} className="mt-4 rounded-sm border border-border bg-surface p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{r.text}</p>
              <a href={r.sourceUrl} className="mt-2 block font-mono text-xs text-primary">{r.author}</a>
            </blockquote>)}
            {typeof client.trust.hours?.text === 'string' && <p className="mt-6 font-mono text-xs text-muted-foreground">{client.trust.hours.text}</p>}
            {client.trust.bookingUrl && <a href={client.trust.bookingUrl} className="mt-6 inline-block rounded-sm border border-primary px-5 py-3 text-primary">Booking information</a>}

            <div className="mt-8 space-y-4">
              <a
                href={client.identity.phoneTel}
                aria-label={`Call ${client.identity.businessName}`}
                className="group flex items-center gap-4 rounded-sm border border-border bg-surface p-5 transition-all hover:border-primary hover:shadow-runway focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-surface-elevated"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-gradient-runway text-primary-foreground">
                  <Phone className="h-4 w-4" />
                </div>
                <div>
                  <div className="hud-tag">Call admissions</div>
                  <div className="font-display text-lg font-semibold text-foreground">
                    {client.identity.phoneDisplay}
                  </div>
                </div>
              </a>
              <div className="flex items-center gap-4 rounded-sm border border-border bg-surface p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-gradient-instrument text-primary-foreground">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <div className="hud-tag">Home base</div>
                  <div className="font-display text-lg font-semibold text-foreground">
                    {client.identity.city}, {client.identity.state}
                  </div>
                </div>
              </div>
            </div>

            {mediaSlot("contact-cockpit") && <div className="mt-8 overflow-hidden rounded-sm border border-border">
              <img
                src={mediaSlot("contact-cockpit")}
                alt={client.identity.businessName}
                loading="lazy"
                width={1600}
                height={1200}
                className="h-44 w-full object-cover"
              />
            </div>}
          </div>

          {/* Right: Form — cockpit instrument panel */}
          <motion.form
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            onSubmit={handleSubmit(onSubmit)}
            className="relative rounded-sm border border-border bg-gradient-to-b from-surface to-surface-elevated p-6 shadow-deep sm:p-10 lg:col-span-7"
            aria-label="Admissions inquiry form"
          >
            {/* Top brushed accent line */}
            <div className="absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

            {/* Corner brackets */}
            <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l-2 border-t-2 border-primary/60" />
            <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r-2 border-t-2 border-primary/60" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 h-3 w-3 border-b-2 border-l-2 border-primary/60" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 h-3 w-3 border-b-2 border-r-2 border-primary/60" />

            {/* Screw-head dots */}
            <span aria-hidden="true" className="pointer-events-none absolute left-4 top-4 h-1.5 w-1.5 rounded-full bg-foreground/30 ring-1 ring-foreground/10" />
            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 h-1.5 w-1.5 rounded-full bg-foreground/30 ring-1 ring-foreground/10" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-4 left-4 h-1.5 w-1.5 rounded-full bg-foreground/30 ring-1 ring-foreground/10" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-4 right-4 h-1.5 w-1.5 rounded-full bg-foreground/30 ring-1 ring-foreground/10" />

            {/* Placard header */}
            <div className="mb-6 flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-armed shadow-[0_0_8px_hsl(var(--armed)/0.8)]" />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-primary">
                    Request Info Panel
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Contact options
                  </div>
                </div>
              </div>
              <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:flex">
                <span className="h-1 w-1 rounded-full bg-primary" /> Online form unavailable
              </div>
            </div>

            {/* Honeypot — visually hidden */}
            <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
              <label>
                Company
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  {...register("company")}
                />
              </label>
            </div>

            <fieldset disabled aria-label="Online request form unavailable" className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Full name" error={errors.name?.message}>
                <input
                  {...register("name")}
                  type="text"
                  autoComplete="name"
                  className="field-input"
                  placeholder="Your name"
                />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <input
                  {...register("email")}
                  type="email"
                  autoComplete="email"
                  className="field-input"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Phone" error={errors.phone?.message}>
                <input
                  {...register("phone")}
                  type="tel"
                  autoComplete="tel"
                  className="field-input"
                  placeholder="Your phone number"
                />
              </Field>
              <Field label="City" error={errors.city?.message}>
                <select {...register("city")} className="field-input" defaultValue="">
                  <option value="">Select your city</option>
                  {client.trust.areas.map(a => <option key={a}>{a}</option>)}
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Primary interest" error={errors.interest?.message}>
                <select {...register("interest")} className="field-input">
                  {client.services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Goal timing" error={undefined}>
                <select className="field-input" defaultValue="explore">
                  <option value="now">Ready now</option>
                  <option value="3mo">Next 1–3 months</option>
                  <option value="6mo">3–6 months</option>
                  <option value="explore">Just exploring</option>
                </select>
              </Field>
            </fieldset>

            <div className="mt-5">
              <Field label="Tell us about your goals (optional)" error={errors.message?.message}>
                <textarea
                  {...register("message")}
                  disabled
                  rows={4}
                  className="field-input resize-none"
                  placeholder="A little background on why you want to fly..."
                />
              </Field>
            </div>

            <div className="mt-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <p className="flex max-w-sm items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-primary" />
                Online requests are unavailable. Please call.
              </p>
              <div className="flex flex-wrap gap-4">
                <a className="text-primary underline" href={client.identity.phoneTel}>Call {client.identity.phoneDisplay}</a>
                {client.identity.email && <a className="text-primary underline" href={`mailto:${client.identity.email}`}>Email {client.identity.email}</a>}
              </div>
            </div>
          </motion.form>
        </div>
      </div>

      <style>{`
        .field-input {
          width: 100%;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
          font-family: var(--font-body);
          font-size: 1rem;
          padding: 0.85rem 1rem;
          border-radius: var(--radius);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .field-input::placeholder { color: hsl(var(--muted-foreground)); }
        .field-input:focus {
          outline: none;
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15);
        }
      `}</style>
    </section>
  );
};

const Field = ({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="mb-2 flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      {error && (
        <span className="font-mono text-[10px] text-destructive">{error}</span>
      )}
    </span>
    {children}
  </label>
);
