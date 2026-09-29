import { useMemo, useState } from "react";
import { SITE } from "@/lib/site";

type ProjectType =
  | "slab" | "flatwork" | "stamped" | "demo-interior"
  | "demo-wall" | "demo-structure" | "unsure";

type Condition = "greenfield" | "existing-pad" | "removal-needed" | "unknown";
type Urgency = "this-week" | "2-4-weeks" | "1-3-months" | "planning";

const TYPE_LABEL: Record<ProjectType, string> = {
  slab: "Commercial Slab",
  flatwork: "Flat Work",
  stamped: "Stamped Concrete",
  "demo-interior": "Interior Demo",
  "demo-wall": "Wall Demo",
  "demo-structure": "Total Demo",
  unsure: "Not sure yet",
};

const CONDITION_LABEL: Record<Condition, string> = {
  greenfield: "Greenfield",
  "existing-pad": "Existing pad",
  "removal-needed": "Removal needed",
  unknown: "Not sure",
};

const URGENCY_LABEL: Record<Urgency, string> = {
  "this-week": "This week",
  "2-4-weeks": "2–4 weeks",
  "1-3-months": "1–3 months",
  planning: "Just planning",
};

function bandFor(type: ProjectType, sqft: number, cond: Condition) {
  // demo bands
  if (type === "demo-structure") return { band: "Enterprise", days: "5–15 crew-days", flag: "Permits + utility coordination included" };
  if (type === "demo-wall" || type === "demo-interior") {
    if (sqft >= 5000) return { band: "Large", days: "4–8 crew-days", flag: "Dust control + shoring planned" };
    return { band: "Mid", days: "2–4 crew-days", flag: "Selective demo with clean haul-off" };
  }
  // concrete bands
  const scale = cond === "removal-needed" ? 1.4 : cond === "existing-pad" ? 1.15 : 1;
  const adj = sqft * scale;
  if (type === "stamped" || type === "flatwork") {
    if (adj < 800) return { band: "Small", days: "1–2 crew-days", flag: "Hand-finished" };
    if (adj < 4000) return { band: "Mid", days: "2–5 crew-days", flag: "Hand-finished with proper jointing" };
    return { band: "Large", days: "5–10 crew-days", flag: "Multi-pour staging" };
  }
  if (adj < 2500) return { band: "Small", days: "2–3 crew-days", flag: "Standard slab build" };
  if (adj < 6000) return { band: "Mid", days: "3–6 crew-days", flag: "Engineered sub-base + finish" };
  if (adj < 20000) return { band: "Large", days: "6–14 crew-days", flag: "Laser screed recommended" };
  return { band: "Enterprise", days: "14+ crew-days", flag: "Laser screed + FF/FL spec" };
}

export function Leveler({ source = "hero-leveler", compact = false }: { source?: "hero-leveler" | "leveler-section"; compact?: boolean }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [type, setType] = useState<ProjectType>("slab");
  const [sqft, setSqft] = useState(2500);
  const [cond, setCond] = useState<Condition>("greenfield");
  const [urgency, setUrgency] = useState<Urgency>("2-4-weeks");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [zip, setZip] = useState("");
  const [hp, setHp] = useState(""); // honeypot

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);

  const result = useMemo(() => bandFor(type, sqft, cond), [type, sqft, cond]);

  async function submit() {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/public/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, phone, email, zip,
          service_type: TYPE_LABEL[type],
          urgency: URGENCY_LABEL[urgency],
          footprint_sqft: sqft,
          condition: CONDITION_LABEL[cond],
          message: `Leveler estimate: ${result.band} · ${result.days}`,
          source,
          company_website: hp,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        setStatus({ ok: true, msg: "We've got it. Card Concrete will reach out shortly." });
        try { localStorage.removeItem("ccc:leveler-draft"); } catch {}
      } else {
        try {
          localStorage.setItem("ccc:leveler-draft", JSON.stringify({ name, phone, email, zip, type, sqft, cond, urgency }));
        } catch {}
        setStatus({ ok: false, msg: data.error || "Couldn't send. Please call (931) 261-9710." });
      }
    } catch {
      setStatus({ ok: false, msg: "Network error. Please call (931) 261-9710." });
    } finally {
      setSubmitting(false);
    }
  }

  const Pill = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-md text-sm font-medium border transition ${
        active
          ? "bg-[var(--brand)] text-[var(--ink)] border-[var(--brand)]"
          : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className={`glass-panel rounded-2xl p-5 sm:p-6 text-white ${compact ? "" : "shadow-2xl"}`} aria-label="Project leveler">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand)] font-semibold">Project Leveler</div>
          <div className="font-display text-lg sm:text-xl mt-1">
            {step < 4 ? "Get a fast read on your project" : status?.ok ? "Request received" : "Send to Card Concrete"}
          </div>
        </div>
        <div className="text-xs text-white/50">Step {Math.min(step + 1, 5)} / 5</div>
      </div>

      {/* Progress */}
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden mb-5">
        <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${((step + 1) / 5) * 100}%` }} />
      </div>

      {step === 0 && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/60 mb-2">Project type</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABEL) as ProjectType[]).map((t) => (
              <Pill key={t} active={type === t} onClick={() => setType(t)}>{TYPE_LABEL[t]}</Pill>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/60 mb-2">
            Approximate footprint — <span className="text-white">{sqft.toLocaleString()} sq ft</span>
          </label>
          <input
            type="range" min={100} max={50000} step={100}
            value={sqft}
            onChange={(e) => setSqft(Number(e.target.value))}
            className="w-full accent-[var(--brand)]"
            aria-label="Project footprint in square feet"
          />
          <div className="grid grid-cols-4 gap-2 mt-3">
            {[250, 1000, 5000, 25000].map((n) => (
              <Pill key={n} active={sqft === n} onClick={() => setSqft(n)}>{n.toLocaleString()}</Pill>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/60 mb-2">Site condition</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
              <Pill key={c} active={cond === c} onClick={() => setCond(c)}>{CONDITION_LABEL[c]}</Pill>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/60 mb-2">Timeline</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => (
              <Pill key={u} active={urgency === u} onClick={() => setUrgency(u)}>{URGENCY_LABEL[u]}</Pill>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand)]">Estimated read</div>
            <div className="mt-1 flex items-baseline gap-3">
              <div className="font-display text-3xl">{result.band}</div>
              <div className="text-white/70 text-sm">{result.days}</div>
            </div>
            <div className="text-white/60 text-xs mt-1">{result.flag}</div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3" role="region" aria-live="polite">
          {status?.ok ? (
            <div className="rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 p-4">
              <div className="font-display text-lg">{status.msg}</div>
              <p className="text-white/70 text-sm mt-1">
                Prefer to talk now?{" "}
                <a href={SITE.phoneHref} className="text-[var(--brand)] underline">{SITE.phone}</a>
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className="bg-white/5 border border-white/10 rounded-md px-3 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:border-[var(--brand)]" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <input className="bg-white/5 border border-white/10 rounded-md px-3 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:border-[var(--brand)]" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
                <input className="bg-white/5 border border-white/10 rounded-md px-3 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:border-[var(--brand)]" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                <input className="bg-white/5 border border-white/10 rounded-md px-3 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:border-[var(--brand)]" placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" />
              </div>
              <input
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
                name="company_website"
              />
              <div className="text-xs text-white/50">
                Estimate: <span className="text-white/80">{result.band} · {result.days}</span>
              </div>
              {status && !status.ok && (
                <div className="text-sm text-red-300">{status.msg}</div>
              )}
            </>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="mt-5 flex items-center justify-between gap-3">
        {step > 0 && !status?.ok ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1) as typeof step)}
            className="text-sm text-white/60 hover:text-white"
          >
            ← Back
          </button>
        ) : <span />}

        {step < 4 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(4, s + 1) as typeof step)}
            className="ml-auto bg-[var(--brand)] text-[var(--ink)] px-5 py-2.5 rounded-md font-semibold hover:brightness-110 transition"
          >
            {step === 3 ? "Continue →" : "Next →"}
          </button>
        )}

        {step === 4 && !status?.ok && (
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name || !phone}
            className="ml-auto bg-[var(--brand)] text-[var(--ink)] px-5 py-2.5 rounded-md font-semibold disabled:opacity-50 hover:brightness-110 transition"
          >
            {submitting ? "Sending…" : "Send to Card Concrete"}
          </button>
        )}

        {step === 4 && status?.ok && (
          <a href={SITE.phoneHref} className="ml-auto bg-white/10 text-white px-5 py-2.5 rounded-md font-semibold hover:bg-white/15">
            Call {SITE.phone}
          </a>
        )}
      </div>
    </div>
  );
}