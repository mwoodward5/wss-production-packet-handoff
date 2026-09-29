import { motion, useScroll, useTransform, MotionValue } from "framer-motion";
import { useRef } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface FlightPathProps {
  className?: string;
  /** Optional external scroll progress (0-1) to drive the path. */
  progress?: MotionValue<number>;
  /** SVG path d attribute. Defaults to a long-arc Gulf-coast curve. */
  d?: string;
  /** Stroke color CSS — defaults to primary. */
  stroke?: string;
  /** Show plane glyph riding the tip. */
  showPlane?: boolean;
  viewBox?: string;
}

const DEFAULT_PATH =
  "M 20 480 C 200 380, 360 460, 520 320 S 880 180, 1080 100 S 1380 60, 1580 80";

/**
 * Animated SVG flight path — dashed runway-light line that draws as the
 * user scrolls (or once on view). A small plane glyph rides the tip.
 */
export const FlightPath = ({
  className,
  progress,
  d = DEFAULT_PATH,
  stroke = "hsl(var(--primary))",
  showPlane = true,
  viewBox = "0 0 1600 540",
}: FlightPathProps) => {
  const ref = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref as unknown as React.RefObject<HTMLElement>,
    offset: ["start end", "end start"],
  });
  const driver = progress ?? scrollYProgress;
  const dashLen = useTransform(driver, [0, 1], [0, 1]);
  const planeOffset = useTransform(driver, [0, 1], [0, 1]);
  const planeDistance = useTransform(driver, [0, 1], ["0%", "100%"]);

  return (
    <svg
      ref={ref}
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="fp-fade" x1="0" x2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0" />
          <stop offset="20%" stopColor={stroke} stopOpacity="0.9" />
          <stop offset="80%" stopColor={stroke} stopOpacity="0.9" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <filter id="fp-glow">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Soft glow underlay */}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeOpacity="0.25"
        strokeWidth="6"
        filter="url(#fp-glow)"
      />

      {/* Dashed runway-light path */}
      <motion.path
        d={d}
        fill="none"
        stroke="url(#fp-fade)"
        strokeWidth="1.5"
        strokeDasharray="6 10"
        strokeLinecap="round"
        pathLength={1}
        style={reduced ? { pathLength: 1 } : { pathLength: dashLen }}
      />

      {/* Bright leading edge */}
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="0.04 1"
        style={reduced ? { pathLength: 1 } : { pathLength: planeOffset }}
      />

      {showPlane && (
        <motion.g
          style={
            reduced
              ? ({ offsetPath: `path("${d}")`, offsetDistance: "100%" } as unknown as React.CSSProperties)
              : ({ offsetPath: `path("${d}")`, offsetDistance: planeDistance } as unknown as React.CSSProperties)
          }
        >
          <g transform="translate(-10 -10)">
            <path
              d="M10 2 L12 9 L18 11 L12 13 L10 19 L8 13 L2 11 L8 9 Z"
              fill={stroke}
            />
          </g>
        </motion.g>
      )}
    </svg>
  );
};
