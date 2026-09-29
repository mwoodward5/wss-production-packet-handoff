/**
 * Editorial-Heritage schematic: hairline contour rings (topo) + cross-marks.
 * Subtle drift via CSS keyframes; respects reduced motion.
 */
export function SchematicOverlay() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] mix-blend-screen ft3-schematic"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <radialGradient id="topo-fade" cx="22%" cy="40%" r="70%">
          <stop offset="0%" stopColor="white" stopOpacity="0.65" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Topo contour rings — Editorial Heritage motif */}
      <g
        fill="none"
        stroke="var(--ft3-cream)"
        strokeWidth="0.6"
        opacity="0.55"
        style={{ transformOrigin: "350px 420px" }}
      >
        {Array.from({ length: 14 }).map((_, i) => (
          <ellipse
            key={i}
            cx="350"
            cy="420"
            rx={80 + i * 38}
            ry={50 + i * 24}
            transform={`rotate(${-12 + i * 0.4} 350 420)`}
            strokeDasharray={i % 3 === 0 ? "" : "2 6"}
          />
        ))}
      </g>

      {/* Right schematic block — survey crosshair grid */}
      <g stroke="var(--ft3-cream)" strokeWidth="0.5" opacity="0.45">
        {Array.from({ length: 9 }).map((_, r) =>
          Array.from({ length: 6 }).map((_, c) => {
            const x = 1100 + c * 70;
            const y = 120 + r * 90;
            return (
              <g key={`${r}-${c}`}>
                <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
                <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
              </g>
            );
          })
        )}
      </g>

      {/* Diagonal hairline rule */}
      <line
        x1="0"
        y1="940"
        x2="1600"
        y2="780"
        stroke="var(--ft3-accent)"
        strokeWidth="0.8"
        strokeDasharray="1 7"
        opacity="0.6"
      />

      {/* Soft fade mask */}
      <rect width="1600" height="1000" fill="url(#topo-fade)" opacity="0.4" />
    </svg>
  );
}
