import { Link } from "@tanstack/react-router";
import { ScrollFrame } from "@/components/frames/ScrollFrame";
import { ProofVideo } from "@/components/ProofVideo";
import { media } from "@/data/media";
import type { EdgeStage } from "@/data/edge-progression";
import { EdgeStatusChip } from "./EdgeStatusChip";

interface Props {
  stage: EdgeStage;
  layout?: "desktop" | "mobile";
}

/**
 * Category → 1px accent line at the top of the media well.
 * Sambo red is spent ONLY on sambo/combat-sambo. Blade family gets edge.
 * Everything else takes a quiet bone-dim rule.
 */
function accentColor(cat: EdgeStage["category"]): string {
  if (cat === "sambo" || cat === "combat-sambo") return "var(--sambo)";
  if (cat === "blade" || cat === "lineage") return "var(--edge)";
  return "color-mix(in oklab, var(--bone-dim) 65%, transparent)";
}

export function EdgeStageCard({ stage, layout = "desktop" }: Props) {
  const accent = accentColor(stage.category);

  return (
    <article
      className={
        layout === "desktop"
          ? "flex h-full flex-col"
          : "flex flex-col"
      }
    >
      <div style={{ borderTop: `1px solid ${accent}` }}>
        <MediaWell stage={stage} />
      </div>

      <header className="mt-5 flex items-center gap-3">
        <span className="numeral text-lg text-edge">{stage.n}</span>
        <span className="h-px flex-1" style={{ background: "color-mix(in oklab, var(--edge) 40%, transparent)" }} />
        <span className="eyebrow text-bone-dim">{stage.stage}</span>
        <EdgeStatusChip status={stage.status} />
      </header>

      <h3 className="mt-3 font-serif text-2xl leading-tight text-bone md:text-3xl">
        {stage.title}
      </h3>

      <p className="mt-4 text-[13px] uppercase tracking-[0.14em]" style={{ color: "var(--bone-dim)" }}>
        <span style={{ color: "var(--edge)" }}>For · </span>
        {stage.audience}
      </p>

      <p className="mt-3 text-[15px] leading-relaxed text-bone-dim">
        {stage.focus}
      </p>

      {stage.note ? (
        <p
          className="mt-3 border-l pl-3 text-[12px] leading-relaxed"
          style={{ color: "var(--bone-dim)", borderColor: "color-mix(in oklab, var(--edge) 55%, transparent)" }}
        >
          {stage.note}
        </p>
      ) : null}

      <div className="mt-5">
        <Link
          to={stage.cta.href}
          className="inline-flex items-center gap-2 border-b border-edge/60 pb-1 text-xs uppercase tracking-[0.18em] text-edge transition-transform hover:-translate-y-0.5"
        >
          {stage.cta.label} <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

function MediaWell({ stage }: { stage: EdgeStage }) {
  const m = stage.media;
  if (m.kind === "pending") {
    return (
      <ScrollFrame aspect="4/5" seal={m.seal}>
        <PendingPanel note={m.note} />
      </ScrollFrame>
    );
  }
  const item = media.find((x) => x.id === m.mediaId);
  if (!item) {
    return (
      <ScrollFrame aspect="4/5" seal={m.seal}>
        <PendingPanel note="Media pending" />
      </ScrollFrame>
    );
  }
  return (
    <ScrollFrame aspect="4/5" seal={m.seal}>
      <ProofVideo item={item} className="h-full w-full" />
    </ScrollFrame>
  );
}

function PendingPanel({ note }: { note: string }) {
  return (
    <div className="relative h-full w-full bg-ink-2">
      {/* Two thin edge rules crossing off-center */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 h-px"
        style={{ top: "38%", background: "color-mix(in oklab, var(--edge) 65%, transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 top-0 w-px"
        style={{ left: "62%", background: "color-mix(in oklab, var(--edge) 45%, transparent)" }}
      />
      <div className="absolute inset-0 flex flex-col items-start justify-end p-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="anim-breath inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--edge)" }}
          />
          <span className="text-[11px] uppercase tracking-[0.22em] text-edge">
            {note}
          </span>
        </div>
      </div>
    </div>
  );
}
