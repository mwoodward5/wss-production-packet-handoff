import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { site, services } from "@/lib/site";
import { trackQuoteSubmit, trackReviewClick } from "@/lib/track";

const sizes = ["Under 500 sq ft", "500–2,000 sq ft", "2,000–10,000 sq ft", "10,000+ sq ft"];
const timelines = ["ASAP / This month", "1–3 months", "3–6 months", "Just exploring"];

const schema = z.object({
  service: z.string().min(2).max(100),
  size: z.string().min(2).max(50),
  timeline: z.string().min(2).max(50),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(255),
});

export function QuoteEstimator() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({ service: "", size: "", timeline: "", name: "", phone: "", email: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function next() {
    setError(null);
    setStep((s) => s + 1);
  }

  function submit() {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please fill all fields");
      return;
    }
    trackQuoteSubmit("complete");
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-gold/40 bg-card p-8 shadow-elegant">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
          <Check className="h-5 w-5" />
        </div>
        <h3 className="font-display text-2xl font-semibold">Project summary ready</h3>
        <p className="mt-2 text-muted-foreground">{data.service} — {data.size}, {data.timeline}. Nothing has been sent.</p>
        <a className="mt-6 inline-flex rounded-full bg-gradient-gold px-5 py-3" href={`tel:${site.phoneTel}`}>Call {site.phone}</a>
        {site.email && <a className="ml-3 underline" href={`mailto:${site.email}?subject=Project%20inquiry&body=${encodeURIComponent(Object.values(data).join('\n'))}`}>Open email draft</a>}
      </div>
    );
  }

  const progress = ((step + 1) / 4) * 100;

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-elegant md:p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">Step {step + 1} of 4</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-gradient-gold transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step === 0 && (
        <div>
          <h3 className="font-display text-2xl font-semibold">What do you need?</h3>
          <p className="mt-1 text-sm text-muted-foreground">Pick the service closest to your project.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => setData({ ...data, service: s.title })}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5",
                  data.service === s.title ? "border-gold bg-secondary shadow-glow" : "border-border bg-card",
                )}
              >
                <div className="font-semibold">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.short}</div>
              </button>
            ))}
          </div>
          <Button onClick={next} disabled={!data.service} className="mt-6 w-full bg-primary md:w-auto">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 1 && (
        <div>
          <h3 className="font-display text-2xl font-semibold">Approximate project size?</h3>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setData({ ...data, size: s })}
                className={cn(
                  "rounded-2xl border p-4 text-left text-sm font-medium transition-all hover:-translate-y-0.5",
                  data.size === s ? "border-gold bg-secondary shadow-glow" : "border-border bg-card",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Button onClick={next} disabled={!data.size} className="mt-6 w-full bg-primary md:w-auto">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="font-display text-2xl font-semibold">When do you want it done?</h3>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {timelines.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setData({ ...data, timeline: t })}
                className={cn(
                  "rounded-2xl border p-4 text-left text-sm font-medium transition-all hover:-translate-y-0.5",
                  data.timeline === t ? "border-gold bg-secondary shadow-glow" : "border-border bg-card",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Button onClick={next} disabled={!data.timeline} className="mt-6 w-full bg-primary md:w-auto">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 3 && (
        <div>
          <h3 className="font-display text-2xl font-semibold">Your contact details</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="qe-name">Name</Label>
              <Input id="qe-name" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="qe-phone">Phone</Label>
              <Input id="qe-phone" type="tel" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} className="mt-1.5" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="qe-email">Email</Label>
              <Input id="qe-email" type="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <Button onClick={submit} className="mt-6 w-full bg-gradient-gold text-gold-foreground shadow-glow hover:opacity-95 md:w-auto">
            Prepare project summary
          </Button>
        </div>
      )}
    </div>
  );
}
