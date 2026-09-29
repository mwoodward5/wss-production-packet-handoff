/**
 * HeadingRose — small SVG compass with 360° tick marks and a
 * marker for the current heading. Aesthetic, not real telemetry.
 */
export const HeadingRose = ({ heading = 230, size = 64 }: { heading?: number; size?: number }) => {
  const ticks = Array.from({ length: 36 });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="text-primary"
    >
      {/* outer ring */}
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.4" />
      {/* tick marks every 10° */}
      {ticks.map((_, i) => {
        const angle = (i * 10 * Math.PI) / 180;
        const isCardinal = i % 9 === 0;
        const r1 = 46;
        const r2 = isCardinal ? 38 : 42;
        const x1 = 50 + r1 * Math.sin(angle);
        const y1 = 50 - r1 * Math.cos(angle);
        const x2 = 50 + r2 * Math.sin(angle);
        const y2 = 50 - r2 * Math.cos(angle);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeOpacity={isCardinal ? 0.9 : 0.45}
            strokeWidth={isCardinal ? 0.8 : 0.4}
          />
        );
      })}
      {/* N marker */}
      <text
        x="50"
        y="14"
        textAnchor="middle"
        fontSize="6"
        fill="currentColor"
        fontFamily="IBM Plex Mono, monospace"
        fontWeight="600"
      >
        N
      </text>
      {/* heading needle */}
      <g transform={`rotate(${heading} 50 50)`}>
        <polygon
          points="50,12 47,50 53,50"
          fill="hsl(var(--horizon))"
          stroke="currentColor"
          strokeWidth="0.3"
        />
        <circle cx="50" cy="50" r="2" fill="hsl(var(--horizon))" />
      </g>
      {/* heading readout */}
      <text
        x="50"
        y="92"
        textAnchor="middle"
        fontSize="7"
        fill="currentColor"
        fontFamily="IBM Plex Mono, monospace"
      >
        {heading.toString().padStart(3, "0")}°
      </text>
    </svg>
  );
};
