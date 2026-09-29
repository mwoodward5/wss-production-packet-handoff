import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, AlertCircle } from "lucide-react";
import { trackFormSubmit, trackReviewClick } from "@/lib/track";
import { submitLead } from "@/lib/lead";
import { useLiveIdentity } from "@/lib/wssc";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  phone: z.string().trim().min(7, "Valid phone required").max(30),
  email: z.string().trim().email("Valid email required").max(255),
  service: z.string().trim().min(2).max(100),
  message: z.string().trim().min(5, "Tell us a bit more").max(2000),
});

export function ContactForm({ compact = false }: { compact?: boolean }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const id = useLiveIdentity();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setServerError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      await submitLead(
        {
          name: parsed.data.name,
          phone: parsed.data.phone,
          email: parsed.data.email,
          service: parsed.data.service,
          message: parsed.data.message,
        },
        String(data.company ?? ""),
      );
      trackFormSubmit("contact");
      form.reset();
      setSubmitted(true);
    } catch {
      setServerError("Something went wrong sending your request.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gold/40 bg-card p-8 shadow-card">
        <h3 className="font-display text-2xl font-semibold">Thanks for reaching out!</h3>
        <p className="mt-2 text-muted-foreground">
          Your request has been received. We review new requests every business day — use the estimate form or
          reach out again if anything changes.
        </p>
        {id.profileUrl && (
          <div className="mt-6 rounded-xl bg-secondary p-5">
            <p className="text-sm">
              If we've helped you before, a quick review helps other neighbors find us.
            </p>
            <a
              href={id.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackReviewClick("post-form")}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-glow"
            >
              <Star className="h-4 w-4" /> Leave a Google Review
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className={compact ? "grid gap-4 md:grid-cols-2" : "grid gap-4 md:grid-cols-2"}>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" placeholder="Your name" className="mt-1.5" />
          {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" placeholder="Your phone number" className="mt-1.5" />
          {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="Email address" className="mt-1.5" />
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="service">Service needed</Label>
          <Input id="service" name="service" placeholder="e.g. Commercial slab, driveway, demo" className="mt-1.5" />
          {errors.service && <p className="mt-1 text-xs text-destructive">{errors.service}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="message">Project details</Label>
          <Textarea id="message" name="message" rows={compact ? 3 : 5} placeholder="Approximate size, timeline, and anything else…" className="mt-1.5" />
          {errors.message && <p className="mt-1 text-xs text-destructive">{errors.message}</p>}
        </div>
        <div aria-hidden="true" className="hidden">
          <label htmlFor="company">Company (leave blank)</label>
          <input id="company" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
      </div>
      {serverError && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{serverError} Please try again.</span>
        </div>
      )}
      <Button type="submit" disabled={loading} className="mt-5 w-full bg-gradient-gold text-gold-foreground hover:opacity-95 shadow-glow md:w-auto">
        {loading ? "Sending…" : serverError ? "Try again" : "Request an Estimate"}
      </Button>
      {id.phone && (
        <p className="mt-3 text-xs text-muted-foreground">
          Or call us directly at{" "}
          <a href={`tel:${id.phoneDigits ? `+1${id.phoneDigits.replace(/^1/, "")}` : id.phone}`} className="font-semibold text-foreground underline">
            {id.phone}
          </a>
          .
        </p>
      )}
    </form>
  );
}
