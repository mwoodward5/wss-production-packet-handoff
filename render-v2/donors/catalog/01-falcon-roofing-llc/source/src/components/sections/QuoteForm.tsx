import { useState, FormEvent } from "react";
import { Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { z } from "zod";
import {CLIENT} from "@/lib/wss";
import { BUSINESS } from "@/lib/business";
import { toast } from "@/hooks/use-toast";

const QuoteSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  phone: z.string().trim().min(7, "Please enter a valid phone").max(40),
  email: z.string().trim().email("Please enter a valid email").max(255),
  service: z.string().trim().min(1, "Pick a service"),
  address: z.string().trim().max(255).optional().default(""),
  message: z.string().trim().min(1, "Tell us a little about the project").max(4000),
  website: z.string().max(0).optional().default(""), // honeypot
});

type FieldErrors = Partial<Record<keyof z.infer<typeof QuoteSchema>, string>>;

interface QuoteFormProps {
  variant?: "card" | "bare";
  heading?: string;
  subheading?: string;
}

export const QuoteForm = ({
  variant = "card",
  heading = "Contact us",
  subheading = "Prepare your project details, then open your email app to send them. Nothing is sent by this form.",
}: QuoteFormProps) => {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    setServerMessage(null);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      name: String(fd.get("name") || ""),
      phone: String(fd.get("phone") || ""),
      email: String(fd.get("email") || ""),
      service: String(fd.get("service") || ""),
      address: String(fd.get("address") || ""),
      message: String(fd.get("message") || ""),
      website: String(fd.get("website") || ""), // honeypot
    };

    const parsed = QuoteSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const [k, v] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (v && v[0]) fe[k as keyof FieldErrors] = v[0];
      }
      setErrors(fe);
      setStatus("error");
      return;
    }

    if (!BUSINESS.email) {setStatus("error");setServerMessage("Please call to discuss your project.");return;}
    if (!CLIENT.services.some(s=>s.name===parsed.data.service)) {setStatus("error");setServerMessage("Please choose a listed service.");return;}
    const {name,phone,email,service,address,message}=parsed.data;
    const body=[name,phone,email,service,address,message].join("\n");
    window.location.href=`mailto:${BUSINESS.email}?subject=${encodeURIComponent(service)}&body=${encodeURIComponent(body)}`;
    setStatus("idle");

  };

  const wrapperClass =
    variant === "card"
      ? "rounded-2xl border border-border bg-card p-8 shadow-card md:p-10"
      : "";

  return (
    <div className={wrapperClass} id="quote">
      <h2 className="font-display text-2xl font-bold">{heading}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>

      {status === "error" && serverMessage && (
        <div className="mt-6 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            {serverMessage}{" "}
            <a
              data-event="contact_call_after_error"
              className="font-semibold text-destructive"
              href={`tel:${BUSINESS.phoneTel}`}
            >
              Call {BUSINESS.phoneDisplay}
            </a>{" "}
            or{" "}
            {BUSINESS.email && <a
              data-event="contact_email_after_error"
              className="font-semibold text-destructive"
              href={`mailto:${BUSINESS.email}`}
            >
              email us
            </a>}
            .
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 grid gap-5" noValidate data-event="quote_form">
        {/* Honeypot — visually hidden, not focusable */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name" name="name" required error={errors.name} />
          <Field label="Phone" name="phone" type="tel" required error={errors.phone} />
        </div>
        <Field label="Email" name="email" type="email" required error={errors.email} />
        <div>
          <label htmlFor="service" className="block text-sm font-semibold">
            Service needed
          </label>
          <select
            id="service"
            name="service"
            defaultValue=""
            required
            className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="" disabled>
              Select a service…
            </option>
            {CLIENT.services.map(s=><option key={s.name}>{s.name}</option>)}
          </select>
          {errors.service && <p className="mt-1 text-xs text-destructive">{errors.service}</p>}
        </div>
        <Field
          label="Address or service area (optional)"
          name="address"
          required={false}
          placeholder="Property address"
          error={errors.address}
        />
        <div>
          <label htmlFor="message" className="block text-sm font-semibold">
            How can we help?
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            required
            placeholder="Tell us about your project, timeline, and anything you've noticed (leaks, missing shingles, age of roof, etc.)."
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {errors.message && <p className="mt-1 text-xs text-destructive">{errors.message}</p>}
        </div>

        <button
          type="submit"
          data-event="quote_form_submit"
          disabled={!BUSINESS.email}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-gradient-accent px-6 py-3.5 text-sm font-semibold text-accent-foreground shadow-cta transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Open email app <Send className="h-4 w-4" />
        </button>
        <p className="text-xs text-muted-foreground">
          Prefer to talk?{" "}
          <a
            href={`tel:${BUSINESS.phoneTel}`}
            data-event="contact_call_form_footer"
            className="font-semibold text-accent"
          >
            Call {BUSINESS.phoneDisplay}
          </a>{" "}
          or{" "}
          {BUSINESS.email && <a
            href={`mailto:${BUSINESS.email}`}
            data-event="contact_email_form_footer"
            className="font-semibold text-accent"
          >
            email us
          </a>}
          .
        </p>
      </form>
    </div>
  );
};

const Field = ({
  label,
  name,
  type = "text",
  required,
  placeholder,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
}) => (
  <div>
    <label className="block text-sm font-semibold" htmlFor={name}>
      {label}
    </label>
    <input
      id={name}
      name={name}
      type={type}
      required={required}
      placeholder={placeholder}
      autoComplete={
        name === "email" ? "email" : name === "phone" ? "tel" : name === "name" ? "name" : "off"
      }
      className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
    {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
  </div>
);