import { useMemo, useState } from "react";
import { z } from "zod";
import { SERVICES, URGENCY_OPTIONS } from "@/lib/business";
import { classifyZone, type ServiceZone } from "@/lib/serviceRouting";
import { Loader2, CheckCircle2, AlertCircle, MapPin } from "lucide-react";

const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  email: z.string().trim().email("Enter a valid email").max(160),
  phone: z.string().trim().min(7, "Enter a valid phone").max(30),
  city: z.string().trim().min(2, "Enter your city").max(80),
  service: z.string().min(1),
  urgency: z.string().min(1),
  message: z.string().trim().max(2000).optional(),
  hp: z.string().max(0).optional(), // honeypot
});

type FormState = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [service, setService] = useState<string>(SERVICES[0].slug);
  const [urgency, setUrgency] = useState<string>(URGENCY_OPTIONS[2].id);
  const [city, setCity] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  // Live service-area classification — same logic the server runs
  const liveZone: ServiceZone | null = useMemo(
    () => (city.trim().length >= 2 ? classifyZone(city) : null),
    [city],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setErrorMsg("");
    const fd = new FormData(e.currentTarget);
    const data = {
      name: String(fd.get("name") || ""),
      email: String(fd.get("email") || ""),
      phone: String(fd.get("phone") || ""),
      city: String(fd.get("city") || ""),
      service,
      urgency,
      message: String(fd.get("message") || ""),
      hp: String(fd.get("hp") || ""),
    };
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setState("submitting");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error || "Something went wrong. Please call us at (720) 417-0758.");
      }
      setSuccessMsg(
        typeof j.message === "string"
          ? j.message
          : "Thanks — we received your request and will reach out shortly during business hours.",
      );
      setState("success");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
    }
  }

  if (state === "success") {
    return (
      <div className="text-center py-10">
        <CheckCircle2 className="mx-auto h-14 w-14 text-[var(--gold)]" />
        <h2 className="display mt-5 text-3xl">Message sent.</h2>
        <p className="mt-3 text-muted-foreground max-w-md mx-auto">{successMsg}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          For emergencies, call (720) 417-0758.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div>
        <div className="eyebrow">Get a Free Estimate</div>
        <h2 className="display mt-2 text-3xl">Tell us about your project.</h2>
      </div>

      {/* honeypot */}
      <input type="text" name="hp" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="name" error={errors.name} required />
        <Field label="Phone" name="phone" type="tel" error={errors.phone} required />
        <Field label="Email" name="email" type="email" error={errors.email} required />
        <Field
          label="City"
          name="city"
          placeholder="Longmont, CO"
          error={errors.city}
          required
          value={city}
          onChange={(v) => setCity(v)}
        />
      </div>

      {liveZone && <ZoneIndicator zone={liveZone} />}

      <div>
        <label className="eyebrow mb-2 block">Service</label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => {
            const active = s.slug === service;
            return (
              <button
                type="button"
                key={s.slug}
                onClick={() => setService(s.slug)}
                className={`rounded-xl border p-3 text-left text-sm transition-all ${
                  active
                    ? "border-[var(--gold)] bg-[var(--ink)] text-[var(--bone)]"
                    : "border-border hover:border-foreground/40"
                }`}
              >
                <div className="font-semibold">{s.name}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="eyebrow mb-2 block">Urgency</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {URGENCY_OPTIONS.map((u) => {
            const active = u.id === urgency;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setUrgency(u.id)}
                className={`rounded-xl border p-3 text-left transition-all ${
                  active ? "border-foreground bg-secondary" : "border-border hover:border-foreground/40"
                }`}
              >
                <div className="text-sm font-semibold">{u.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{u.detail}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="message" className="eyebrow mb-2 block">
          Project details (optional)
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          maxLength={2000}
          placeholder="Brief scope, address, panel size, or anything else helpful…"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:border-foreground focus:outline-none"
        />
      </div>

      {state === "error" && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={state === "submitting"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-6 py-4 text-sm font-bold uppercase tracking-wider text-[var(--ink)] transition-colors disabled:opacity-60 sm:w-auto"
      >
        {state === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          <>Send to DN Electric</>
        )}
      </button>

      <p className="text-xs text-muted-foreground">
        By submitting, you consent to be contacted about your inquiry. We don't share your info.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  error,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="eyebrow mb-2 block">
        {label} {required && <span className="text-[var(--gold)]">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        maxLength={200}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={`w-full rounded-xl border bg-background px-4 py-3 text-sm focus:outline-none ${
          error ? "border-destructive" : "border-input focus:border-foreground"
        }`}
      />
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </div>
  );
}

function ZoneIndicator({ zone }: { zone: ServiceZone }) {
  const cfg =
    zone === "primary"
      ? {
          tone: "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--ink)]",
          label: "Primary service area",
          detail: "We work this area regularly — fastest scheduling.",
        }
      : zone === "extended"
        ? {
            tone: "border-amber-300 bg-amber-50 text-amber-900",
            label: "Extended Front Range area",
            detail: "We service this area — scheduling may take a little longer.",
          }
        : {
            tone: "border-destructive/30 bg-destructive/5 text-destructive",
            label: "Outside our regular service area",
            detail:
              "Send your request anyway — we'll review and confirm whether we can help.",
          };
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${cfg.tone}`}
      role="status"
      aria-live="polite"
    >
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold uppercase tracking-wider">{cfg.label}</div>
        <div className="mt-0.5 opacity-80">{cfg.detail}</div>
      </div>
    </div>
  );
}
