import type { EdgeStatus } from "@/data/edge-progression";

const config: Record<
  EdgeStatus,
  { label: string; mark: "ring" | "dot" | "square" }
> = {
  pending:        { label: "Details pending", mark: "ring" },
  confirmed:      { label: "Confirmed",       mark: "dot" },
  "media-backed": { label: "Media-backed",    mark: "square" },
};

export function EdgeStatusChip({ status }: { status: EdgeStatus }) {
  const c = config[status];
  return (
    <span
      className="inline-flex items-center gap-2 border border-hairline px-2 py-1 text-[10px] uppercase tracking-[0.18em]"
      style={{
        color: "var(--bone-dim)",
        background: "color-mix(in oklab, var(--ink) 60%, transparent)",
      }}
    >
      <Mark kind={c.mark} />
      {c.label}
    </span>
  );
}

function Mark({ kind }: { kind: "ring" | "dot" | "square" }) {
  if (kind === "ring") {
    return (
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full border"
        style={{ borderColor: "var(--bone-dim)" }}
      />
    );
  }
  if (kind === "dot") {
    return (
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--edge)" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5"
      style={{ background: "var(--edge)" }}
    />
  );
}
