import { useSite, projectMailto } from "@/lib/wss";
import { useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";

const urgencies = [
  { id: "storm", label: "This week", note: "Preferred timing." },
  { id: "soon", label: "Within a month", note: "Preferred timing." },
  { id: "planning", label: "Just planning", note: "No date selected." },
];

const stepLabels = ["Lane", "Timing", "Where", "Contact"];

export function Planner() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const lanes=client.services.map(s=>s.name);
  const [step, setStep] = useState(0);
  const [lane, setLane] = useState(lanes[0]);
  const [urgency, setUrgency] = useState(urgencies[1].id);
  const [zip, setZip] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [details, setDetails] = useState("");

  const urgencyLabel = urgencies.find((u) => u.id === urgency)?.label ?? "";

  const mailto = useMemo(() => projectMailto(emailHref,{lane,urgency:urgencyLabel,zip,name,contact,details}),[emailHref,lane,urgencyLabel,zip,name,contact,details]);

  // derive a "completion" pct for the progress rail
  const filled = [true, true, zip.length === 5, !!(name && contact)];
  const pct = (filled.filter(Boolean).length / 4) * 100;

  if(!emailHref) return null;
  return (
    <section id="planner" className="relative bg-ink-deep py-24 text-cream">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-cream/10" />
      <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-4">
          <p className="eyebrow text-clay-soft">Plan a project</p>
          <h2 className="mt-3 font-display text-3xl leading-tight sm:text-4xl lg:text-[44px]">
            {client.content.ctaHeadline || "Tell us what your house needs."}
          </h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-cream/75">
            Four quick steps prepare a draft in your email app. Review and send it to {client.identity.email}.
          </p>
          <div className="mt-8 space-y-3 text-sm">
            {client.trust.badges.map(b=>b.label).map((b) => (
              <div key={b} className="flex items-center gap-2 text-cream/85">
                <Check className="h-4 w-4 text-clay-soft" strokeWidth={2.5} /> {b}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8">
          {/* Brief card */}
          <div className="rounded-2xl border border-cream/15 bg-cream text-ink shadow-warm overflow-hidden">
            {/* Progress rail */}
            <div className="border-b border-line bg-paper px-6 pt-5 pb-4 sm:px-8">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                <span>Project brief</span>
                <span className="font-mono text-clay">BRIEF · {String(Math.round(pct)).padStart(2,"0")}%</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {stepLabels.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStep(i)}
                    className="group text-left"
                  >
                    <div className={`h-1 rounded-full transition ${i <= step ? "bg-ink" : "bg-line"}`} />
                    <div className={`mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${i === step ? "text-clay" : "text-ink-soft group-hover:text-ink"}`}>
                      {String(i+1).padStart(2,"0")} · {s}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <form
              className="grid gap-0 sm:grid-cols-5"
              onSubmit={(e) => { e.preventDefault(); if(mailto && name.trim() && contact.trim()) window.location.href = mailto; }}
            >
              <div className="sm:col-span-3 p-6 sm:p-8">
                {step === 0 && (
                  <Step label="Which lane?">
                    <div className="flex flex-wrap gap-2">
                      {lanes.map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setLane(l)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            lane === l
                              ? "border-ink bg-ink text-cream"
                              : "border-ink/15 bg-paper text-ink hover:border-ink/40"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </Step>
                )}
                {step === 1 && (
                  <Step label="Timing">
                    <div className="grid gap-2 sm:grid-cols-1">
                      {urgencies.map((u) => (
                        <label
                          key={u.id}
                          className={`cursor-pointer rounded-lg border p-3 text-left transition ${
                            urgency === u.id ? "border-clay bg-clay/5" : "border-ink/15 bg-paper hover:border-ink/40"
                          }`}
                        >
                          <input type="radio" name="urgency" value={u.id} checked={urgency === u.id} onChange={() => setUrgency(u.id)} className="sr-only" />
                          <div className="text-sm font-semibold text-ink">{u.label}</div>
                          <div className="mt-0.5 text-[11px] text-ink-soft">{u.note}</div>
                        </label>
                      ))}
                    </div>
                  </Step>
                )}
                {step === 2 && (
                  <Step label="Where is the project?">
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        inputMode="numeric"
                        pattern="\d{5}"
                        maxLength={5}
                        aria-label="ZIP code"
                        placeholder="ZIP code"
                        value={zip}
                        onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        className="w-32 rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay"
                      />
                      {zip.length === 5 && (
                        <span className="text-xs text-ink-soft">Call to confirm coverage.
                        </span>
                      )}
                    </div>
                  </Step>
                )}
                {step === 3 && (
                  <Step label="How to reach you">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input required aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay" />
                      <input required aria-label="Phone or email" placeholder="Phone or email" value={contact} onChange={(e) => setContact(e.target.value)} className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay" />
                      <textarea aria-label="Project details" placeholder="Anything we should know about the project? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1200} className="sm:col-span-2 rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay" />
                    </div>
                  </Step>
                )}

                <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    ← Back
                  </button>
                  {step < 3 ? (
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.min(3, s + 1))}
                      className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-cream transition hover:bg-clay"
                    >
                      Next <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-cream transition hover:bg-clay"
                    >
                      Open email draft <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Live summary */}
              <aside className="sm:col-span-2 border-t border-line bg-cream-soft p-6 sm:border-l sm:border-t-0 sm:p-8">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Your project brief</div>
                <dl className="mt-4 space-y-3 text-sm">
                  <SumRow k="Lane" v={lane} />
                  <SumRow k="Timing" v={urgencyLabel} />
                  <SumRow k="ZIP" v={zip || "—"} />
                  <SumRow k="Contact" v={contact || name || "—"} />
                </dl>
                <p className="mt-6 text-[11px] leading-relaxed text-ink-soft">
                  Submitting opens your email app prepared to send. Nothing is stored on this page.
                </p>
              </aside>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-xl text-ink">{label}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SumRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2 last:border-b-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">{k}</dt>
      <dd className="text-right text-[13px] text-ink truncate max-w-[60%]">{v}</dd>
    </div>
  );
}
