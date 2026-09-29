import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Phone, Zap } from "lucide-react";
import { TEL_HREF, BUSINESS } from "@/lib/business";

/**
 * Signature interactive widget — Tree Job Scope Builder.
 * Sliders: tree height (ft), distance from structure (ft), count of trees.
 * Toggle: storm / 24-7 emergency. Lead-capture only — no pricing implied.
 */
export function QuoteConfigurator() {
  const [height, setHeight] = useState(45); // 10 - 90 ft
  const [distance, setDistance] = useState(20); // 0 - 60 ft
  const [count, setCount] = useState(1); // 1 - 6
  const [emergency, setEmergency] = useState(false);

  const { complexity, scope } = useMemo(() => {
    const proxMult =
      distance <= 5 ? 1.55 : distance <= 12 ? 1.32 : distance <= 25 ? 1.12 : 1.0;
    const complexity =
      proxMult >= 1.5 ? "High" : proxMult >= 1.3 ? "Elevated" : proxMult > 1.0 ? "Moderate" : "Standard";
    const scope =
      height >= 65 ? "Large canopy work" :
      height >= 45 ? "Mid-canopy work" :
      height >= 25 ? "Standard tree work" : "Small tree work";
    return { complexity, scope };
  }, [height, distance, count, emergency]);

  return (
    <aside
      aria-label="Tree job scope builder"
      className="relative w-full overflow-hidden rounded-2xl border border-white/15 p-6 backdrop-blur-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)] sm:p-7"
      style={{
        background:
          "linear-gradient(155deg, color-mix(in oklab, var(--ft3-loam) 70%, transparent) 0%, color-mix(in oklab, var(--ft3-loam) 88%, transparent) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-60"
        style={{
          background:
            "radial-gradient(120% 60% at 0% 0%, color-mix(in oklab, var(--ft3-accent) 22%, transparent), transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--ft3-sage) 30%, transparent), transparent 55%)",
        }}
        aria-hidden
      />

      <header className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">
          <span className="relative inline-flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: "var(--ft3-accent)" }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: "var(--ft3-accent)" }}
            />
          </span>
          Scope Builder
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
          {complexity} Job
        </div>
      </header>

      <h2 className="relative mt-3 font-serif text-2xl leading-tight text-[var(--ft3-cream)]">
        Tell us about the job in seconds.
      </h2>
      <p className="relative mt-1 text-xs text-white/65">
        Use the dials to prepare a job summary. This is not a price or safety assessment.
      </p>

      <div className="relative mt-6 space-y-5">
        <SliderRow
          label="Tree height"
          value={height}
          unit="ft"
          min={10}
          max={90}
          step={5}
          onChange={setHeight}
        />
        <SliderRow
          label="Distance from structure"
          value={distance}
          unit="ft"
          min={0}
          max={60}
          step={1}
          onChange={setDistance}
        />
        <SliderRow
          label="Trees in scope"
          value={count}
          unit={count === 1 ? "tree" : "trees"}
          min={1}
          max={6}
          step={1}
          onChange={setCount}
        />

        <button
          type="button"
          onClick={() => setEmergency((v) => !v)}
          aria-pressed={emergency}
          className={`group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold transition-all ${
            emergency
              ? "border-[color:var(--ft3-accent)]/70 bg-[color:var(--ft3-accent)]/15 text-[var(--ft3-cream)]"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Storm-related request
          </span>
          <span
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
              emergency ? "bg-[var(--ft3-accent)]" : "bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                emergency ? "left-4" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      <div
        className="relative mt-6 rounded-xl border border-white/10 p-4"
        style={{
          background:
            "linear-gradient(140deg, color-mix(in oklab, var(--ft3-cream) 4%, transparent), color-mix(in oklab, var(--ft3-cream) 9%, transparent))",
        }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
          Job summary
        </div>
        <div className="mt-1 font-serif text-xl text-[var(--ft3-cream)]">
          {scope} · {count} {count === 1 ? "tree" : "trees"} · {complexity.toLowerCase()} access
          {emergency ? " · emergency" : ""}
        </div>
        <p className="mt-2 text-[11px] text-white/55">
          Keep this summary for your call or email. Nothing has been sent.
        </p>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <Link
          to="/contact"
          search={{ scope: `${height} ft height; ${distance} ft from structure; ${count} trees; storm-related: ${emergency ? "yes" : "no"}` }}
          className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-bold text-[var(--ft3-loam)] shadow-lg transition-transform hover:scale-[1.02]"
          style={{ background: "var(--ft3-accent)" }}
        >
          Contact us <ArrowRight className="h-4 w-4" />
        </Link>
        <a
          href={TEL_HREF}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
        >
          <Phone className="h-4 w-4" /> {BUSINESS.phoneDisplay}
        </a>
      </div>
    </aside>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
          {label}
        </label>
        <span
          className="font-serif text-base text-[var(--ft3-cream)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value} <span className="text-xs text-white/50">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ft3-slider mt-2 w-full"
        style={{
          background: `linear-gradient(to right, var(--ft3-accent) 0%, var(--ft3-accent) ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`,
        }}
        aria-label={label}
      />
    </div>
  );
}
