type Props = {
  /** "down" tilts down-right, "up" tilts up-right */
  direction?: "down" | "up";
  /** Color of the section ABOVE the divider (the SVG fill below it shows the next section through) */
  fill?: string;
  className?: string;
};

export function SectionDivider({ direction = "down", fill = "var(--background)", className }: Props) {
  const points = direction === "down" ? "0,0 1440,80 1440,0" : "0,80 1440,0 1440,0";
  return (
    <div className={className} aria-hidden>
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="block h-12 w-full md:h-20"
      >
        <polygon points={points} fill={fill} />
      </svg>
    </div>
  );
}
