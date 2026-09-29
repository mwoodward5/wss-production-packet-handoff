import { ReactNode } from "react";

export function Marquee({ items }: { items: ReactNode[] }) {
  const row = [...items, ...items];
  return (
    <div
      className="group relative flex w-full overflow-hidden border-y border-white/10 bg-black/40 py-3 backdrop-blur-sm"
      aria-label="Service ticker"
    >
      <div className="flex shrink-0 animate-[marquee_38s_linear_infinite] gap-12 pr-12 [animation-play-state:running] group-hover:[animation-play-state:paused]">
        {row.map((it, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--ft3-accent)" }}
              aria-hidden
            />
            {it}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[marquee_38s_linear_infinite\\] { animation: none; }
        }
      `}</style>
    </div>
  );
}
