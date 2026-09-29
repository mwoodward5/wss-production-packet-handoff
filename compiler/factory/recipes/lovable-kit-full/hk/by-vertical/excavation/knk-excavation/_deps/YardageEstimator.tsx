import { useMemo, useState } from "react";
import { Truck, Layers, Ruler, ArrowRight } from "lucide-react";

const SOIL = {
  topsoil: { label: "Topsoil", weight: 1.4 },
  clay: { label: "Clay / Fill", weight: 1.6 },
  gravel: { label: "Gravel / Stone", weight: 1.7 },
  rocky: { label: "Rocky / Mixed", weight: 1.9 },
} as const;

type SoilKey = keyof typeof SOIL;

export function YardageEstimator() {
  const [length, setLength] = useState(40);
  const [width, setWidth] = useState(20);
  const [depth, setDepth] = useState(3);
  const [soil, setSoil] = useState<SoilKey>("clay");

  const { yards, loads, tons } = useMemo(() => {
    const cubicFt = length * width * depth;
    const cubicYards = cubicFt / 27;
    const swelled = cubicYards * 1.25; // bulking factor
    const truckYd = 12;
    const truckLoads = Math.max(1, Math.ceil(swelled / truckYd));
    const tonnage = swelled * SOIL[soil].weight;
    return {
      yards: swelled,
      loads: truckLoads,
      tons: tonnage,
    };
  }, [length, width, depth, soil]);

  return (
    <aside
      aria-label="Excavation yardage and load estimator"
      className="relative overflow-hidden rounded-2xl border border-[var(--knk-line)] bg-[var(--knk-ink)]/55 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-7"
    >
      {/* Inner aurora */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 20% 0%, oklch(0.82 0.19 80 / 0.18), transparent 55%), radial-gradient(circle at 100% 100%, oklch(0.62 0.18 50 / 0.18), transparent 55%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--knk-bone)]/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--knk-amber)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--knk-amber)]" />
            </span>
            Live Estimate
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--knk-bone)]/50">KNK//001</div>
        </div>

        <h2 className="mt-3 text-2xl font-black uppercase leading-none tracking-tight text-[var(--knk-bone)]">
          Yardage <span className="text-[var(--knk-amber)]">&amp;</span> Load Estimator
        </h2>
        <p className="mt-2 text-sm text-[var(--knk-bone)]/65">
          Plug your dig dimensions in. We'll calculate cubic yards, dump-truck loads, and tonnage in real time.
        </p>

        <div className="mt-5 grid gap-4">
          <Slider icon={<Ruler className="h-3.5 w-3.5" />} label="Length" unit="ft" value={length} min={5} max={200} step={1} onChange={setLength} />
          <Slider icon={<Ruler className="h-3.5 w-3.5 rotate-90" />} label="Width" unit="ft" value={width} min={5} max={200} step={1} onChange={setWidth} />
          <Slider icon={<Layers className="h-3.5 w-3.5" />} label="Depth" unit="ft" value={depth} min={1} max={20} step={0.5} onChange={setDepth} />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--knk-bone)]/60">Soil Type</span>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-[var(--knk-line)] bg-[var(--knk-ink)]/60 p-1">
              {(Object.keys(SOIL) as SoilKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSoil(k)}
                  className={`rounded-md px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--knk-amber)] ${
                    soil === k
                      ? "bg-[var(--knk-amber)] text-[var(--knk-ink)]"
                      : "text-[var(--knk-bone)]/70 hover:text-[var(--knk-bone)]"
                  }`}
                >
                  {SOIL[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="mt-6 grid grid-cols-3 gap-2 rounded-xl border border-[var(--knk-line)] bg-[var(--knk-ink)]/70 p-4">
          <Stat value={yards.toFixed(1)} label="Cu. Yards" />
          <Stat value={loads.toString()} label="Truck Loads" />
          <Stat value={tons.toFixed(1)} label="Tons" />
        </div>
        <div className="mt-1 text-right font-mono text-[9px] uppercase tracking-widest text-[var(--knk-bone)]/40">
          incl. 25% bulking · 12 yd³ trucks
        </div>

        <a
          href="#contact"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--knk-amber)] px-5 py-3.5 text-sm font-black uppercase tracking-wider text-[var(--knk-ink)] shadow-[0_10px_30px_-8px_oklch(0.82_0.19_80_/_0.6)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--knk-amber)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--knk-ink)]"
        >
          <Truck className="h-4 w-4" />
          Lock In This Quote
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </aside>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-2xl font-black tabular-nums text-[var(--knk-bone)]">{value}</div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--knk-bone)]/55">{label}</div>
    </div>
  );
}

function Slider({
  icon,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--knk-bone)]/60">
          {icon}
          {label}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-[var(--knk-amber)]">
          {value} <span className="text-[var(--knk-bone)]/50 text-[10px]">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={`${label} in ${unit}`}
        className="knk-range w-full"
        style={{
          background: `linear-gradient(to right, var(--knk-amber) 0%, var(--knk-amber) ${pct}%, oklch(0.3 0.01 60) ${pct}%, oklch(0.3 0.01 60) 100%)`,
        }}
      />
    </div>
  );
}
