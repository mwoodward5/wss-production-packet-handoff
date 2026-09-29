interface Props {
  /** FMA-style angle of attack: 1=high forehand diagonal, 2=high backhand,
   *  3=mid horizontal, 4=mid horizontal backhand, 5=thrust to centerline */
  angle: 1 | 2 | 3 | 4 | 5;
  className?: string;
}

/**
 * The blade vocabulary shared across the traditions Rami trains — Sayoc,
 * Pekiti-Tirsia, Ilustrisimo — reads the same first five numbered angles:
 *  1 · high forehand diagonal (temple → opposite hip)
 *  2 · high backhand diagonal
 *  3 · horizontal forehand at ribs
 *  4 · horizontal backhand at ribs
 *  5 · straight thrust to centerline
 * The silhouette is deliberately abstract — a receiver's body outline, not
 * a technical anatomy chart. Currently-active angle is drawn in edge; the
 * rest linger as ghost strokes so the whole vocabulary is visible.
 */
export function AngulationDiagram({ angle, className = "" }: Props) {
  // All five paths in centerline coords. Attacker on right, receiver on left.
  const paths: Array<{ n: number; d: string; label: string }> = [
    { n: 1, d: "M 170 40 L 60 145",  label: "1 · high forehand" },
    { n: 2, d: "M 170 40 L 60 40",   label: "2 · high backhand" }, // will re-map below
    { n: 3, d: "M 170 100 L 60 100", label: "3 · horizontal fore" },
    { n: 4, d: "M 170 130 L 60 100", label: "4 · horizontal back" },
    { n: 5, d: "M 170 85 L 60 85",   label: "5 · thrust centerline" },
  ];
  // Redefine #2 as opposite diagonal
  paths[1].d = "M 170 145 L 60 40";

  return (
    <svg
      viewBox="0 0 220 200"
      className={`w-full h-auto ${className}`}
      fill="none"
    >
      <style>{`
        .draw { stroke-dasharray: 240; stroke-dashoffset: 240; animation: bef-draw 1.1s cubic-bezier(.2,.7,.1,1) forwards; }
        @keyframes bef-draw { to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .draw { animation: none; stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Receiver silhouette — abstract standing figure, left side */}
      <g stroke="currentColor" strokeWidth="0.8" opacity="0.35" fill="none">
        <circle cx="45" cy="45" r="12" />
        <line x1="45" y1="57" x2="45" y2="130" />
        <line x1="45" y1="75" x2="30" y2="105" />
        <line x1="45" y1="75" x2="60" y2="105" />
        <line x1="45" y1="130" x2="32" y2="175" />
        <line x1="45" y1="130" x2="58" y2="175" />
      </g>

      {/* Attacker hint — just a hand + blade origin dot on right */}
      <g opacity="0.5">
        <circle cx="175" cy={paths[angle - 1].d.split(" ")[2]} r="2.5" fill="currentColor" />
      </g>

      {/* Ghost strokes of the other angles */}
      {paths.map((p) =>
        p.n === angle ? null : (
          <path
            key={p.n}
            d={p.d}
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.15"
          />
        )
      )}

      {/* Active angle */}
      <g key={angle}>
        <path
          className="draw"
          d={paths[angle - 1].d}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* Blade tip indicator */}
        <circle
          cx={paths[angle - 1].d.split(" ")[4]}
          cy={paths[angle - 1].d.split(" ")[5]}
          r="3"
          fill="currentColor"
          opacity="0.9"
        />
      </g>

      {/* Numeral badge */}
      <g>
        <circle cx="200" cy="20" r="12" fill="none" stroke="currentColor" opacity="0.6" />
        <text
          x="200"
          y="25"
          fontSize="14"
          fontFamily="Fraunces, serif"
          fill="currentColor"
          textAnchor="middle"
          fontStyle="italic"
        >
          {angle}
        </text>
      </g>

      <text
        x="110"
        y="195"
        fontSize="7"
        fill="currentColor"
        textAnchor="middle"
        opacity="0.65"
        letterSpacing="0.15em"
        style={{ textTransform: "uppercase" }}
      >
        {paths[angle - 1].label}
      </text>
    </svg>
  );
}
