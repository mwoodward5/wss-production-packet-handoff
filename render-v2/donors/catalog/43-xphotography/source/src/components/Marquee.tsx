interface Props {
  text?: string;
  phrases?: string[];
  className?: string;
}

const DEFAULT_PHRASES: string[] = [];

export default function Marquee({ text, phrases, className = "" }: Props) {
  const items = phrases ?? (text ? text.split("·").map((s) => s.trim()).filter(Boolean) : DEFAULT_PHRASES);
  return (
    <div className={`overflow-hidden whitespace-nowrap py-12 ${className}`}>
      <div className="marquee-track">
        {Array.from({ length: 2 }).map((_, loop) => (
          <span key={loop} className="font-display text-ivory/90 text-[8.4vw] md:text-[3.6vw] leading-none inline-flex items-center">
            {items.map((p, i) => (
              <span key={`${loop}-${i}`} className="inline-flex items-center gap-12 px-8">
                {p}
                <span className="inline-block w-3 h-3 rounded-full bg-molten/80 align-middle" />
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
