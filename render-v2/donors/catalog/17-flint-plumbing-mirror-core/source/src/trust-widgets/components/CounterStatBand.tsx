import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useReducedMotion } from "../hooks/useReducedMotion";

function useCountUp(target: number, run: boolean, ms = 1200) {
  const [v, setV] = React.useState(run ? 0 : target);
  React.useEffect(() => {
    if (!run) { setV(target); return; }
    let raf = 0; const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function Stat({ value, label, prefix, suffix, animate }: { value: number; label: string; prefix?: string; suffix?: string; animate: boolean }) {
  const [seen, setSeen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) setSeen(true); }, { threshold: 0.4 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const shown = useCountUp(value, animate && seen);
  return (
    <div ref={ref} style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "var(--tw-font-heading)", fontSize: "clamp(1.8rem,4vw,2.8rem)", lineHeight: 1 }}>
        {prefix}{shown.toLocaleString()}{suffix}
      </div>
      <div className="tw-muted" style={{ fontSize: ".82rem", marginTop: ".4rem" }}>{label}</div>
    </div>
  );
}

/** Proof-in-numbers band: jobs completed, years in business, response time, etc. */
export function CounterStatBand() {
  const cfg = useTrust();
  const stats = cfg.proof.stats ?? [];
  const reduced = useReducedMotion();
  return (
    <Gate id="CounterStatBand" when={stats.length > 0}>
      <div className="tw-card tw-grid" style={{ gridTemplateColumns: `repeat(auto-fit,minmax(150px,1fr))`, gap: "1.4rem" }}>
        {stats.map((s) => (
          <Stat key={s.id} value={s.value} label={s.label} prefix={s.prefix} suffix={s.suffix} animate={!reduced} />
        ))}
      </div>
    </Gate>
  );
}
