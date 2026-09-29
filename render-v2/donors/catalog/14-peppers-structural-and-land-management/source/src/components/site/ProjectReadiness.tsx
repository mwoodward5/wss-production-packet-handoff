import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Project Readiness — a contextual, non-live intelligence widget.
 * Helps a homeowner self-assess where they are in the project journey
 * before talking to Jim. Pure UX logic — no fake live data.
 */
type Stage = "thinking" | "scoping" | "comparing" | "ready";

const stages: { id: Stage; label: string; copy: string }[] = [
  { id: "thinking", label: "Just thinking", copy: "Most projects start here. Ideas, photos, a budget range. Worth a phone call to sanity-check the scope." },
  { id: "scoping", label: "Scoping it out", copy: "You know roughly what you want. A site visit will turn the idea into a number." },
  { id: "comparing", label: "Comparing bids", copy: "Bring us in. We'll give you a written, line-itemed estimate so you can compare apples to apples." },
  { id: "ready", label: "Ready to build", copy: "We'll schedule a walkthrough this week and get a written estimate to you in days, not weeks." },
];

const services = [
  "Kitchen", "Basement", "Deck or porch", "Addition", "Greenhouse", "Repair / carpentry",
];

export function ProjectReadiness() {
  const [stage, setStage] = useState<Stage>("scoping");
  const [service, setService] = useState<string>("Kitchen");

  const next = useMemo(() => stages.find((s) => s.id === stage)!, [stage]);

  return (
    <aside
      aria-label="Project readiness planner"
      className="relative border border-rule bg-cream/95 p-6 shadow-deep backdrop-blur-sm sm:p-7"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
          [ Project Readiness · 01 ]
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/55">
          Plan your call
        </p>
      </div>

      <h3 className="mt-4 font-display text-2xl leading-tight text-ink">
        Where are you with the <span className="italic-fraunces text-umber">project</span>?
      </h3>

      {/* Stage selector */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden border border-rule bg-rule sm:grid-cols-4">
        {stages.map((s) => {
          const active = s.id === stage;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStage(s.id)}
              aria-pressed={active}
              className={`px-3 py-3 text-left transition-colors ${
                active ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-bone"
              }`}
            >
              <p className={`font-mono text-[9px] uppercase tracking-[0.18em] ${active ? "text-amber-glow" : "text-umber"}`}>
                Stage
              </p>
              <p className="mt-1 font-display text-sm leading-tight">{s.label}</p>
            </button>
          );
        })}
      </div>

      {/* Service routing */}
      <div className="mt-5">
        <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
          What kind of work?
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {services.map((s) => {
            const active = s === service;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setService(s)}
                aria-pressed={active}
                className={`border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-ink bg-ink text-cream"
                    : "border-rule bg-cream text-charcoal hover:border-ink"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Recommendation panel */}
      <div className="mt-6 border-t border-rule pt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
          Honest next step
        </p>
        <p className="mt-2 text-sm leading-relaxed text-charcoal/85">
          {next.copy}
        </p>
        <Link
          to="/contact"
          className="btn-primary mt-5 w-full justify-center"
        >
          Start with {service.toLowerCase()} →
        </Link>
        <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-charcoal/50">
          Free written estimate · No pressure · Owner-operated
        </p>
      </div>
    </aside>
  );
}
