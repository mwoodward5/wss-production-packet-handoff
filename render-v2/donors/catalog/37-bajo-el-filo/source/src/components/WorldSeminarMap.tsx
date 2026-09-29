import { useState } from "react";
import { seminarJourney } from "@/data/seminar-journey";

/**
 * Indiana Jones expedition map. Parchment ground, sepia-toned coastlines
 * sketched by hand, dashed red flight-path connecting the seminar stops,
 * wax-seal markers with hover-parchment tooltips.
 */

const W = 900;
const H = 520;

// Simplified continent silhouettes tuned for this crop — Atlantic-centered
// so Mexico anchors bottom-left, Europe top-right.
const COASTLINES = [
  // North America
  "M 30 180 Q 90 130 200 170 Q 250 220 240 300 Q 200 360 160 380 Q 120 380 100 340 Q 60 280 40 240 Z",
  // South America (partial)
  "M 210 380 Q 240 380 250 420 Q 260 470 240 500 L 210 500 Q 200 450 205 400 Z",
  // Europe outline
  "M 430 160 Q 470 130 520 150 Q 560 170 590 180 Q 620 190 640 220 Q 620 260 570 250 Q 520 230 490 240 Q 460 240 440 220 Q 420 190 430 160 Z",
  // Africa
  "M 470 260 Q 520 260 540 300 Q 560 360 540 420 Q 510 460 480 440 Q 460 380 460 320 Q 460 280 470 260 Z",
];

export function WorldSeminarMap({
  externalActive,
  onActiveChange,
}: {
  externalActive?: string | null;
  onActiveChange?: (code: string | null) => void;
} = {}) {
  const [hover, setHover] = useState<string | null>(null);
  const [lock, setLock] = useState<string | null>(null);
  const active = lock ?? externalActive ?? hover;

  const setHoverLinked = (code: string | null) => {
    setHover(code);
    onActiveChange?.(code);
  };

  // Build a dashed flight path connecting stops in journey order
  const pts = seminarJourney.map((s) => ({ x: (s.x / 100) * W, y: (s.y / 100) * H }));
  const pathD = pts
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `Q ${(pts[i - 1].x + p.x) / 2 + 20} ${Math.min(pts[i - 1].y, p.y) - 40} ${p.x} ${p.y}`))
    .join(" ");

  return (
    <div className="relative w-full">
      {/* Parchment ground */}
      <div
        className="relative aspect-[9/5.2] w-full overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at center, #e8d5a2 0%, #d9c48a 55%, #a8874c 100%)",
          padding: 8,
          boxShadow: "0 30px 60px rgba(0,0,0,.45), inset 0 0 40px rgba(60,40,10,.35)",
        }}
      >
        {/* Burn marks in corners */}
        {(["tl", "tr", "bl", "br"] as const).map((c) => (
          <div
            key={c}
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              width: "18%",
              height: "22%",
              [c[0] === "t" ? "top" : "bottom"]: 0,
              [c[1] === "l" ? "left" : "right"]: 0,
              background:
                "radial-gradient(ellipse at " +
                (c[1] === "l" ? "left " : "right ") +
                (c[0] === "t" ? "top" : "bottom") +
                ", rgba(40,20,5,0.55) 0%, transparent 65%)",
              mixBlendMode: "multiply",
            }}
          />
        ))}

        {/* Fiber grain */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='0.5'/></svg>\")",
            mixBlendMode: "multiply",
          }}
        />

        <svg viewBox={`0 0 ${W} ${H}`} className="relative h-full w-full" role="img" aria-label="Expedition map of Rami's seminar trail across Mexico, Spain, Slovenia, and Romania">
          {/* Faint graticule */}
          <g stroke="#5a3a18" strokeWidth="0.4" opacity="0.18">
            {Array.from({ length: 8 }, (_, i) => (
              <line key={`h${i}`} x1="0" x2={W} y1={((i + 1) * H) / 9} y2={((i + 1) * H) / 9} />
            ))}
            {Array.from({ length: 12 }, (_, i) => (
              <line key={`v${i}`} y1="0" y2={H} x1={((i + 1) * W) / 13} x2={((i + 1) * W) / 13} />
            ))}
          </g>

          {/* Coastlines — sepia ink, double-stroke */}
          <g fill="none" opacity="0.7">
            {COASTLINES.map((d, i) => (
              <g key={i}>
                <path d={d} stroke="#2d1a08" strokeWidth="1.5" />
                <path d={d} stroke="#7a5218" strokeWidth="0.6" transform="translate(1.5 1.5)" opacity="0.5" />
              </g>
            ))}
          </g>

          {/* Compass rose */}
          <g transform={`translate(${W - 80}, 80)`}>
            <circle r="34" fill="none" stroke="#2d1a08" strokeWidth="0.8" opacity="0.6" />
            <circle r="22" fill="none" stroke="#2d1a08" strokeWidth="0.5" opacity="0.4" />
            <path d="M 0 -30 L 4 0 L 0 6 L -4 0 Z" fill="#7c2a1c" opacity="0.85" />
            <path d="M 0 30 L -4 0 L 0 -6 L 4 0 Z" fill="#3a2408" opacity="0.6" />
            <path d="M -30 0 L 0 -4 L 6 0 L 0 4 Z" fill="#3a2408" opacity="0.4" />
            <path d="M 30 0 L 0 4 L -6 0 L 0 -4 Z" fill="#3a2408" opacity="0.4" />
            <text y="-36" fontSize="8" fill="#2d1a08" textAnchor="middle" fontFamily="Fraunces, serif">N</text>
          </g>

          {/* Flight path — dashed red trail with draw-on */}
          <path
            d={pathD}
            fill="none"
            stroke="#8a2418"
            strokeWidth="1.8"
            strokeDasharray="6 5"
            opacity="0.85"
            style={{
              strokeDashoffset: 400,
              animation: "bef-flight 3s cubic-bezier(.2,.7,.1,1) forwards",
            }}
          />
          <style>{`
            @keyframes bef-flight { to { stroke-dashoffset: 0; } }
            @media (prefers-reduced-motion: reduce) {
              path[stroke-dasharray] { animation: none; stroke-dashoffset: 0; }
            }
          `}</style>

          {/* Stops — wax seals */}
          {seminarJourney.map((s) => {
            const x = (s.x / 100) * W;
            const y = (s.y / 100) * H;
            const isActive = active === s.code;
            return (
              <g
                key={s.code}
                transform={`translate(${x}, ${y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverLinked(s.code)}
                onMouseLeave={() => setHoverLinked(null)}
                onClick={() => setLock((l) => (l === s.code ? null : s.code))}
                tabIndex={0}
                role="button"
                aria-label={`${s.name}: ${s.arts.join(", ")}. ${s.note}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLock((l) => (l === s.code ? null : s.code));
                  }
                }}
              >
                {/* Wax seal */}
                <circle r={isActive ? 14 : 10} fill="#7c2a1c" opacity="0.92" />
                <circle r={isActive ? 14 : 10} fill="none" stroke="#3a1008" strokeWidth="0.8" />
                <text y="4" fontSize="9" fill="#e8d5a2" textAnchor="middle" fontFamily="Fraunces, serif" fontWeight="600">
                  {s.code}
                </text>
                {/* Ripple */}
                <circle r="10" fill="none" stroke="#7c2a1c" strokeWidth="0.6" opacity="0.5">
                  <animate attributeName="r" values="10;22;10" dur="4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="4s" repeatCount="indefinite" />
                </circle>

                {/* Name tag */}
                <text x="18" y="-6" fontSize="12" fill="#2d1a08" fontFamily="Fraunces, serif" fontWeight="600">
                  {s.name}
                </text>

                {/* Parchment tooltip */}
                {isActive && (
                  <g transform="translate(20, 10)">
                    <rect
                      width="200"
                      height="90"
                      fill="#f0dfa8"
                      stroke="#3a1008"
                      strokeWidth="0.8"
                      opacity="0.98"
                    />
                    <text x="10" y="20" fontSize="10" fill="#3a1008" fontFamily="Fraunces, serif" fontWeight="600" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      Arts on the mat
                    </text>
                    {s.arts.slice(0, 3).map((a, i) => (
                      <text key={a} x="10" y={36 + i * 12} fontSize="10" fill="#2d1a08" fontFamily="Fraunces, serif">
                        · {a}
                      </text>
                    ))}
                    <text x="10" y="82" fontSize="9" fill="#5a3418" fontFamily="Fraunces, serif" fontStyle="italic">
                      {s.note.slice(0, 42)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-widest text-bone-dim">
        <span>Expedition map · click a seal to pin</span>
        <span>SI · RO · ES · MX</span>
      </div>
    </div>
  );
}
