type Props = { items: string[] };

export function Marquee({ items }: Props) {
  const doubled = [...items, ...items];
  return (
    <div className="marquee-mask relative overflow-hidden border-y border-border bg-card py-4">
      <div className="marquee-track flex gap-12 whitespace-nowrap">
        {doubled.map((item, i) => (
          <div key={i} className="flex shrink-0 items-center gap-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
