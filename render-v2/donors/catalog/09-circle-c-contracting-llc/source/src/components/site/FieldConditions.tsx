import { useClient } from "@/wss/bridge";
export function FieldConditions({ variant = "spine" }: { variant?: "spine" | "ribbon" }) {
  const {client} = useClient();
  if (!client.content.seasonalNote) return null;
  const p = {badgeColor:"var(--accent)", badge:"Field Notes", label:"Field Notes", months:"", focus:client.content.seasonalNote, ground:client.content.seasonalNote, cadence:"", note:""};
  if (variant === "ribbon") {
    return (
      <div
        className="rounded-md border px-3 py-2 mono-cap flex items-center gap-3 overflow-x-auto whitespace-nowrap"
        style={{
          background: "rgba(10,9,8,0.55)",
          borderColor: "oklch(0.82 0.16 70 / 0.4)",
          color: "oklch(0.97 0.01 80 / 0.85)",
          backdropFilter: "blur(6px)",
        }}
        aria-label="Field notes"
      >
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider"
          style={{ background: p.badgeColor, color: "oklch(0.16 0.015 60)" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "oklch(0.16 0.015 60)" }}
          />
          {p.badge}
        </span>
        <span style={{ color: "var(--accent)" }}>{p.label.toUpperCase()}</span>
        <span>· {p.months}</span>
        <span>· {p.focus}</span>
      </div>
    );
  }

  return (
    <div
      className="px-5 py-4 border-y"
      style={{
        borderColor: "oklch(0.82 0.16 70 / 0.25)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)",
      }}
      aria-label="Field notes"
    >
      <div className="mono-cap" style={{ color: "var(--accent)" }}>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2" style={{ background: "var(--accent)" }} />
          FIELD&nbsp;NOTES
        </div>
        <div className="mt-1 opacity-70 text-[10px]">{p.label.toUpperCase()} · {p.months.toUpperCase()}</div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-display font-bold uppercase tracking-[0.18em] text-[10px]"
          style={{ background: p.badgeColor, color: "oklch(0.16 0.015 60)" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "oklch(0.16 0.015 60)" }}
          />
          {p.badge}
        </span>
        <span className="mono-cap" style={{ color: "oklch(0.97 0.01 80 / 0.55)" }}>
          {client.identity.city}
        </span>
      </div>

      <dl
        className="mt-4 space-y-2.5 mono-cap text-[10px]"
        style={{ color: "oklch(0.97 0.01 80 / 0.78)" }}
      >
        <div>
          <dt style={{ color: "oklch(0.97 0.01 80 / 0.5)" }}>PROJECT NOTE</dt>
          <dd className="normal-case tracking-normal text-[11px]">{p.ground}</dd>
        </div>

      </dl>

      <div
        className="mt-2 mono-cap text-[10px]"
        style={{ color: "oklch(0.97 0.01 80 / 0.35)" }}
      >
        {client.identity.city}, {client.identity.state}
      </div>
    </div>
  );
}
