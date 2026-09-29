import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, AlertCircle } from "lucide-react";
import { site, services } from "@/lib/site";
import { trackFormSubmit, trackReviewClick } from "@/lib/track";

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
  const [draft,setDraft]=useState('');
  function onSubmit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result=schema.safeParse(Object.fromEntries(new FormData(e.currentTarget).entries()));
    if(!result.success){setErrors(Object.fromEntries(result.error.issues.map(i=>[String(i.path[0]),i.message])));return;}
    setErrors({});setDraft(Object.values(result.data).join('\n'));
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
          <Input id="phone" name="phone" type="tel" placeholder="Phone number" className="mt-1.5" />
          {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="Email address" className="mt-1.5" />
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="service">Service needed</Label>
          <select id="service" name="service" className="mt-1.5 w-full rounded-xl border border-border p-3">{services.map(s=><option key={s.slug} value={s.title}>{s.title}</option>)}</select>
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
          <span>{serverError} You can retry, or call {site.phone}.</span>
        </div>
      )}
      <Button type="submit" disabled={loading} className="mt-5 w-full bg-gradient-gold text-gold-foreground hover:opacity-95 shadow-glow md:w-auto">
        Prepare message
      </Button>

      <p className="mt-3 text-sm">This form prepares a draft. Nothing is sent from this page.</p>
      {draft && <div role="status" className="mt-4 rounded-xl bg-secondary p-4"><p>Draft ready. Call us to discuss it{site.email ? " or open it in your email app" : ""}.</p><pre className="whitespace-pre-wrap text-sm">{draft}</pre>{site.email && <a href={`mailto:${site.email}?subject=Project%20inquiry&body=${encodeURIComponent(draft)}`} className="underline">Open email draft</a>}</div>}
      <p className="mt-3 text-xs text-muted-foreground">
        Or call us directly at <a href={`tel:${site.phoneTel}`} className="font-semibold text-foreground underline">{site.phone}</a>.
      </p>
    </form>
  );
}
