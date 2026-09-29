export function SectionDivider({ tone = "cream" }: { tone?: "cream" | "paper" | "ink" }) {
  const bg = tone === "ink" ? "bg-ink" : tone === "paper" ? "bg-paper" : "bg-cream";
  const stroke = tone === "ink" ? "stroke-cream/25" : "stroke-ink/15";
  return (
    <div aria-hidden className={`${bg} px-5 lg:px-8`}>
      <div className="mx-auto max-w-7xl py-2">
        <svg viewBox="0 0 1200 12" preserveAspectRatio="none" className="h-3 w-full">
          <path
            d="M0 6 C 200 2, 400 10, 600 6 S 1000 2, 1200 6"
            fill="none"
            className={stroke}
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
