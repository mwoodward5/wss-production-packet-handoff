interface MarqueeProps {
  items: string[];
}

export function Marquee({ items }: MarqueeProps) {
  const doubled = [...items, ...items, ...items, ...items];
  return (
    <div
      className="group relative w-full overflow-hidden border-y border-[var(--knk-line)] bg-[var(--knk-ink)]/95 py-3"
      aria-hidden="true"
    >
      <div className="flex animate-[knk-marquee_45s_linear_infinite] whitespace-nowrap group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {doubled.map((it, i) => (
          <span key={i} className="mx-8 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.3em] text-[var(--knk-bone)]/70">
            <span className="h-1.5 w-1.5 rotate-45 bg-[var(--knk-amber)]" />
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

/* Add to global CSS:
@keyframes knk-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-25%); }
}
*/
