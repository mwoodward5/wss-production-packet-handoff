/** Four-step inquiry console. Drafts email for the visitor to send. */
import { useMemo, useState } from "react";
import {
  Leaf,
  Camera,
  Phone,
  MessageSquare,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Zap,
  Clock,
  CalendarDays,
} from "lucide-react";
import { CLIENT, SERVICES } from "@/config";

type ServiceKey = string;
type Urgency = "As soon as possible" | "This week" | "Schedule it";
const SERVICE_TILES = SERVICES.map((service) => ({ key: service.name, icon: Leaf, hint: service.shortDesc }));
const URGENCY_TILES: { key: Urgency; icon: typeof Zap; tone: string }[] = [
  { key: "As soon as possible", icon: Zap, tone: "text-[#FF9400]" },
  { key: "This week", icon: Clock, tone: "text-[var(--gold)]" },
  { key: "Schedule it", icon: CalendarDays, tone: "text-foreground/70" },
];

type Status = "idle" | "draft";

export function JobCommandWidget() {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [service, setService] = useState<ServiceKey | null>(null);
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const [zip, setZip] = useState("");
  const [address, setAddress] = useState("");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [mailtoHref, setMailtoHref] = useState("");

  const canNext = useMemo(() => {
    if (step === 0) return !!service;
    if (step === 1) return !!urgency;
    if (step === 2) return zip.replace(/\D/g, "").length >= 5;
    return true;
  }, [step, service, urgency, zip]);

  function buildMailto() {
    const subject = encodeURIComponent(`New Job Request — ${service ?? "Inquiry"} (${urgency ?? "—"})`);
    const body = encodeURIComponent(
      `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nService: ${service}\nUrgency: ${urgency}\nZIP: ${zip}\nAddress: ${address || "(not provided)"}\nPhoto selected (attach manually): ${photoName ?? "no"}\n\nNotes:\n${notes || "(none)"}`,
    );
    return `mailto:${CLIENT.email}?subject=${subject}&body=${body}`;
  }

  function submit() {
    if (!CLIENT.email) return;
    const href = buildMailto();
    setMailtoHref(href);
    window.location.href = href;
    setStatus("draft");
  }

  return (
    <div className="relative rounded-3xl border border-white/40 bg-white/85 backdrop-blur-xl p-5 sm:p-6 shadow-[0_30px_80px_-30px_rgba(20,30,20,0.55)] ring-1 ring-black/5">
      {/* Metal/glass top bar — looks like a command console */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-[#FF9400] animate-pulse" />
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/70">
            Job Command · {CLIENT.businessName}
          </span>
        </div>
        <span className="text-[10px] font-semibold tracking-wider uppercase text-[var(--gold)]">Request a quote</span>
      </div>

      {/* Step pips */}
      <div className="flex gap-1.5 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-[#FF9400]" : "bg-foreground/10"
            }`}
          />
        ))}
      </div>

      {/* ============ Step 0 — Service ============ */}
      {step === 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/60 mb-3">
            What do you need handled?
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SERVICE_TILES.map((s) => {
              const Icon = s.icon;
              const active = service === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setService(s.key)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    active
                      ? "border-[#FF9400] bg-[#FF9400]/8 shadow-[0_4px_16px_-6px_rgba(255,148,0,0.4)]"
                      : "border-foreground/10 hover:border-[#FF9400]/40 hover:bg-foreground/[0.02]"
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-1.5 ${active ? "text-[#FF9400]" : "text-foreground/70"}`} />
                  <div className="text-sm font-semibold leading-tight">{s.key}</div>
                  <div className="text-[10px] text-foreground/55 mt-0.5">{s.hint}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ Step 1 — Urgency ============ */}
      {step === 1 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/60 mb-3">
            How urgent is it?
          </p>
          <div className="grid gap-2">
            {URGENCY_TILES.map((u) => {
              const Icon = u.icon;
              const active = urgency === u.key;
              return (
                <button
                  key={u.key}
                  type="button"
                  onClick={() => setUrgency(u.key)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                    active
                      ? "border-[#FF9400] bg-[#FF9400]/8"
                      : "border-foreground/10 hover:border-[#FF9400]/40"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${u.tone}`} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{u.key}</div>
                    {u.key === "As soon as possible" && (
                      <div className="text-[11px] text-foreground/60">Call to discuss current availability.</div>
                    )}
                  </div>
                  {active && <CheckCircle2 className="w-4 h-4 text-[#FF9400]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ Step 2 — Property ============ */}
      {step === 2 && (
        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
            Where's the property?
          </p>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <input
              inputMode="numeric"
              maxLength={5}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
              placeholder="ZIP *"
              className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street / cross street (optional)"
              className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
            />
          </div>

          <p className="text-xs text-muted-foreground">Contact us to confirm service at this address.</p>
          <label className="flex items-center gap-3 rounded-xl border border-dashed border-foreground/20 bg-foreground/[0.02] px-3 py-3 cursor-pointer hover:border-[#FF9400]/40 transition-colors">
            <Camera className="w-5 h-5 text-foreground/60" />
            <div className="flex-1 text-sm">
              <div className="font-semibold">{photoName ? "Photo selected locally" : "Snap a photo (optional)"}</div>
              <div className="text-[11px] text-foreground/55 truncate">
                {photoName ?? "Attach this photo yourself when you send your email."}
              </div>
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
        </div>
      )}

      {/* ============ Step 3 — Contact ============ */}
      {step === 3 && (
        <div className="grid gap-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
            How should we reach you?
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name *"
            className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone *"
              className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
            />
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else? (access, gate code, pets, project details…)"
            className="rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF9400]"
          />

          {/* Job ticket recap */}
          <div className="rounded-lg bg-foreground/[0.03] border border-foreground/10 p-3 text-[11px] grid gap-1">
            <div><span className="font-semibold">Service:</span> {service}</div>
            <div><span className="font-semibold">Urgency:</span> {urgency}</div>
            <div><span className="font-semibold">ZIP:</span> {zip || "—"}</div>
            {photoName && <div><span className="font-semibold">Photo:</span> {photoName}</div>}
          </div>
        </div>
      )}

      {/* ============ Fallback notice ============ */}
      {status === "draft" && (
        <div className="mt-3 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-3 text-xs">
          Your email app was asked to open a draft. Send it there to submit your request, or call{" "}
          <a href={`tel:${CLIENT.phoneE164}`} className="text-[#FF9400] font-semibold underline">{CLIENT.phone}</a> now.
          <div className="mt-2 flex gap-2 flex-wrap">
            <a href={mailtoHref} className="rounded-full border border-foreground/20 px-3 py-1.5 font-semibold">Email</a>
            <a href={`tel:${CLIENT.phoneE164}`} className="rounded-full bg-[#FF9400] text-white px-3 py-1.5 font-semibold">Call</a>
            {CLIENT.smsE164 && <a href={`sms:${CLIENT.smsE164}`} className="rounded-full border border-foreground/20 px-3 py-1.5 font-semibold">Text</a>}
          </div>
        </div>
      )}

      {!CLIENT.email && <p className="mt-3 text-xs">Call {CLIENT.phone} to discuss your request.</p>}
      {/* ============ Footer controls ============ */}
      <div className="mt-5 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as 0 | 1 | 2 | 3)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/60 hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        ) : (
          <a
            href={`tel:${CLIENT.phoneE164}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF9400]"
          >
            <Phone className="w-3.5 h-3.5" /> Or call {CLIENT.phone}
          </a>
        )}

        {step < 3 ? (
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2 | 3)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#FF9400] text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-transform"
          >
            Next <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!CLIENT.email || !name.trim() || (!phone.trim() && !email.trim())}
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#FF9400] text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-40 hover:-translate-y-0.5 transition-transform"
          >
            <>Open email draft <MessageSquare className="w-4 h-4" /></>
          </button>
        )}
      </div>
    </div>
  );
}
