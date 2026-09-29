/**
 * Circle C — Subsurface Section A–A′
 *
 * A premium surveyor / cross-section diagram showing the typical soil
 * column under Onawa, IA (Loess Hills) with a trench cut to common
 * utility depths. All depths are TYPICAL / code-minimum reference values,
 * never live measurements.
 *
 * Design intent: editorial blueprint card — high legibility, amber
 * focal accents on a deep ink ground, generous typography.
 */

export function SoilProfile() {
  // Static reference frost depth — Iowa code minimum.
  const frostInches = 42;

  // Larger viewBox for legible type. 1 vertical unit ≈ 1.25 inches depth.
  const VW = 200;
  const VH = 130;
  const surfaceY = 22;
  const ftToY = (ft: number) => surfaceY + ft * 11;
  const inToY = (inches: number) => surfaceY + (inches / 12) * 11;

  const trenchX = 122;
  const trenchW = 28;
  const trenchDepthFt = 6.5;
  const trenchBottomY = ftToY(trenchDepthFt);

  const amber = "var(--accent)";
  const amberDim = "oklch(0.78 0.16 70 / 0.55)";
  const cream = "oklch(0.97 0.01 80)";
  const ice = "oklch(0.88 0.10 220)";

  return (
    <figure
      className="relative pointer-events-none select-none rounded-xl overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 30% 0%, oklch(0.20 0.03 60 / 0.95) 0%, oklch(0.10 0.012 60 / 0.95) 70%)",
        border: "1px solid oklch(0.82 0.16 70 / 0.45)",
        boxShadow:
          "0 30px 80px -30px oklch(0.78 0.16 65 / 0.45), 0 1px 0 oklch(1 0 0 / 0.06) inset",
      }}
      aria-label="Illustrative subsurface drawing, not a site survey or depth specification"
    >
      {/* Header bar */}
      <header
        className="flex items-center justify-between px-4 md:px-5 py-2.5 border-b"
        style={{
          borderColor: "oklch(0.82 0.16 70 / 0.25)",
          background:
            "linear-gradient(180deg, oklch(0.18 0.02 60 / 0.85), oklch(0.10 0.012 60 / 0.4))",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: amber, boxShadow: `0 0 12px ${amber}` }}
          />
          <span
            className="font-display text-[11px] md:text-[12px] tracking-[0.28em] uppercase"
            style={{ color: cream, opacity: 0.92 }}
          >
            Section&nbsp;A–A′ &middot; Subsurface Illustration
          </span>
        </div>
        <span
          className="hidden md:inline font-display text-[10px] tracking-[0.32em] uppercase"
          style={{ color: amber }}
        >
          Not a site survey
        </span>
      </header>

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-[260px] md:h-[300px] xl:h-[340px] block"
      >
        <defs>
          <linearGradient id="sp-topsoil" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(70,46,26,0.95)" />
            <stop offset="1" stopColor="rgba(48,30,18,0.95)" />
          </linearGradient>
          <linearGradient id="sp-loess" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(150,102,56,0.92)" />
            <stop offset="1" stopColor="rgba(110,72,40,0.95)" />
          </linearGradient>
          <linearGradient id="sp-till" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(82,68,54,0.95)" />
            <stop offset="1" stopColor="rgba(48,40,32,0.98)" />
          </linearGradient>
          <linearGradient id="sp-trench" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(0,0,0,0.65)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.98)" />
          </linearGradient>
          <pattern
            id="sp-tillHatch"
            width="3"
            height="3"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line x1="0" y1="0" x2="0" y2="3" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />
          </pattern>
          <filter id="sp-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="sp-cutaway">
            <path
              d={`M0,${surfaceY} L${trenchX},${surfaceY} L${trenchX},${trenchBottomY} L${
                trenchX + trenchW
              },${trenchBottomY} L${trenchX + trenchW},${surfaceY} L${VW},${surfaceY} L${VW},${VH} L0,${VH} Z`}
            />
          </clipPath>
        </defs>

        {/* SURFACE LINE + tufts */}
        <line x1="0" y1={surfaceY} x2={trenchX} y2={surfaceY} stroke={amber} strokeWidth="0.7" />
        <line
          x1={trenchX + trenchW}
          y1={surfaceY}
          x2={VW}
          y2={surfaceY}
          stroke={amber}
          strokeWidth="0.7"
        />
        {Array.from({ length: 60 }).map((_, i) => {
          const x = i * (VW / 60) + 1;
          if (x > trenchX - 1 && x < trenchX + trenchW + 1) return null;
          return (
            <line
              key={i}
              x1={x}
              y1={surfaceY}
              x2={x + 0.4}
              y2={surfaceY - 1.6}
              stroke={amber}
              strokeWidth="0.3"
              opacity="0.6"
            />
          );
        })}

        {/* SOIL LAYERS clipped around trench */}
        <g clipPath="url(#sp-cutaway)">
          <rect x="0" y={surfaceY} width={VW} height={ftToY(1) - surfaceY} fill="url(#sp-topsoil)" />
          <rect x="0" y={ftToY(1)} width={VW} height={ftToY(4.5) - ftToY(1)} fill="url(#sp-loess)" />
          <rect x="0" y={ftToY(4.5)} width={VW} height={ftToY(8.5) - ftToY(4.5)} fill="url(#sp-till)" />
          <rect
            x="0"
            y={ftToY(4.5)}
            width={VW}
            height={ftToY(8.5) - ftToY(4.5)}
            fill="url(#sp-tillHatch)"
          />
        </g>

        {/* Trench fill + walls */}
        <rect
          x={trenchX}
          y={surfaceY}
          width={trenchW}
          height={trenchBottomY - surfaceY}
          fill="url(#sp-trench)"
        />
        {[trenchX, trenchX + trenchW].map((x, i) => (
          <line
            key={i}
            x1={x}
            y1={surfaceY}
            x2={x}
            y2={trenchBottomY}
            stroke={amber}
            strokeWidth="0.55"
            strokeDasharray="2 1.4"
          />
        ))}
        <line
          x1={trenchX}
          y1={trenchBottomY}
          x2={trenchX + trenchW}
          y2={trenchBottomY}
          stroke={amber}
          strokeWidth="0.55"
          strokeDasharray="2 1.4"
        />

        {/* DIG ZONE label inside trench */}
        <text
          x={trenchX + trenchW / 2}
          y={trenchBottomY + 4.5}
          textAnchor="middle"
          fontSize="3.2"
          fill={amber}
          style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.3em" }}
        >
          DIG&nbsp;ZONE
        </text>

        {/* FROST LINE — static IA code reference */}
        <line
          x1="0"
          y1={inToY(frostInches)}
          x2={trenchX}
          y2={inToY(frostInches)}
          stroke={ice}
          strokeWidth="0.55"
          strokeDasharray="3 2"
          opacity="0.9"
        />
        <line
          x1={trenchX + trenchW}
          y1={inToY(frostInches)}
          x2={VW}
          y2={inToY(frostInches)}
          stroke={ice}
          strokeWidth="0.55"
          strokeDasharray="3 2"
          opacity="0.9"
        />
        <text
          x="3"
          y={inToY(frostInches) - 1.6}
          fontSize="3"
          fill={ice}
          style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.14em" }}
        >
          ILLUSTRATIVE SECTION
        </text>

        {/* DEPTH SCALE */}
        {[1, 2, 3, 4, 5, 6, 7, 8].map((ft) => (
          <g key={ft}>
            <line
              x1="0"
              y1={ftToY(ft)}
              x2="2.4"
              y2={ftToY(ft)}
              stroke={cream}
              strokeWidth="0.3"
              opacity="0.55"
            />
            {ft % 2 === 0 && (
              <text
                x="3.2"
                y={ftToY(ft) + 1.2}
                fontSize="3"
                fill={cream}
                opacity="0.75"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                
              </text>
            )}
          </g>
        ))}

        {/* LAYER LABELS — right side */}
        <g style={{ fontFamily: "ui-monospace, monospace" }}>
          <text
            x={VW - 3}
            y={ftToY(0.55) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={cream}
            opacity="0.92"
            style={{ letterSpacing: "0.18em" }}
          >
            LAYER A
          </text>
          <text
            x={VW - 3}
            y={ftToY(2.7) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={cream}
            opacity="0.92"
            style={{ letterSpacing: "0.18em" }}
          >
            LAYER B
          </text>
          <text
            x={VW - 3}
            y={ftToY(6.4) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={cream}
            opacity="0.92"
            style={{ letterSpacing: "0.18em" }}
          >
            LAYER C
          </text>
        </g>

        {/* UTILITIES inside trench (glowing) */}
        <g filter="url(#sp-glow)">
          {/* gas ~2' */}
          <circle cx={trenchX + 8} cy={ftToY(2)} r="2" fill={amber} />
          <circle
            cx={trenchX + 8}
            cy={ftToY(2)}
            r="3.4"
            fill="none"
            stroke={amber}
            strokeWidth="0.4"
            opacity="0.55"
          />
          {/* sewer ~4' */}
          <circle
            cx={trenchX + 14}
            cy={ftToY(4)}
            r="3"
            fill={cream}
            stroke="oklch(0.16 0.015 60)"
            strokeWidth="0.4"
          />
          {/* water ~6' */}
          <circle
            cx={trenchX + 21}
            cy={ftToY(6)}
            r="2.4"
            fill="oklch(0.62 0.18 240)"
            stroke={cream}
            strokeWidth="0.35"
          />
        </g>

        {/* Callouts (no glow, crisp) */}
        <g style={{ fontFamily: "ui-monospace, monospace" }}>
          {/* gas */}
          <line
            x1={trenchX + 8}
            y1={ftToY(2)}
            x2={trenchX - 14}
            y2={ftToY(2)}
            stroke={amberDim}
            strokeWidth="0.3"
          />
          <text
            x={trenchX - 15}
            y={ftToY(2) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={amber}
            style={{ letterSpacing: "0.16em" }}
          >
            
          </text>
          {/* sewer */}
          <line
            x1={trenchX + 14}
            y1={ftToY(4)}
            x2={trenchX - 14}
            y2={ftToY(4)}
            stroke={amberDim}
            strokeWidth="0.3"
          />
          <text
            x={trenchX - 15}
            y={ftToY(4) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={amber}
            style={{ letterSpacing: "0.16em" }}
          >
            
          </text>
          {/* water */}
          <line
            x1={trenchX + 21}
            y1={ftToY(6)}
            x2={trenchX - 14}
            y2={ftToY(6)}
            stroke={amberDim}
            strokeWidth="0.3"
          />
          <text
            x={trenchX - 15}
            y={ftToY(6) + 1.2}
            fontSize="3.2"
            textAnchor="end"
            fill={amber}
            style={{ letterSpacing: "0.16em" }}
          >
            
          </text>
        </g>
      </svg>

      {/* Footer legend */}
      <footer
        className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 md:px-5 py-2.5 border-t mono-cap"
        style={{
          borderColor: "oklch(0.82 0.16 70 / 0.2)",
          background: "oklch(0.10 0.012 60 / 0.6)",
          color: cream,
        }}
      >
        <LegendDot color={amber} label="Illustrative lines" />
        <LegendDot color={cream} label="" outline />
        <LegendDot color="oklch(0.62 0.18 240)" label="" />
        <LegendDot color={ice} label="" dashed />
        <span className="ml-auto opacity-60 text-[10px] tracking-[0.22em]">
          Not to scale · no site or code data
        </span>
      </footer>
    </figure>
  );
}

function LegendDot({
  color,
  label,
  dashed,
  outline,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  outline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.18em]">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          background: outline ? "transparent" : color,
          border: outline
            ? `1.5px solid ${color}`
            : dashed
            ? `1.5px dashed ${color}`
            : "none",
          boxShadow: dashed ? "none" : `0 0 8px ${color}`,
        }}
      />
      <span style={{ opacity: 0.85 }}>{label}</span>
    </span>
  );
}
