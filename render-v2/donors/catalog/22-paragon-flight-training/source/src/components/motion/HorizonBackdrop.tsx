import { useScroll, useTransform, motion, useSpring } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * HorizonBackdrop — fixed, page-level atmospheric parallax.
 * Renders a faint runway-light pathway and horizon glow that drift slowly
 * with global scroll. Pointer-events: none, behind everything.
 * Honors reduced-motion (renders static).
 */
export const HorizonBackdrop = () => {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();

  const horizonRaw = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "-18%"]);
  const runwayRaw = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "32%"]);
  const glowRaw = useTransform(scrollYProgress, [0, 1], [0.35, reduced ? 0.35 : 0.08]);

  const horizonY = useSpring(horizonRaw, { stiffness: 40, damping: 20 });
  const runwayY = useSpring(runwayRaw, { stiffness: 40, damping: 20 });

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Distant horizon glow */}
      <motion.div
        style={{ y: horizonY, opacity: glowRaw }}
        className="absolute left-1/2 top-[28%] h-[60vh] w-[140vw] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.18),transparent_60%)] blur-3xl"
      />
      {/* Runway-light pathway, drifting opposite */}
      <motion.svg
        style={{ y: runwayY }}
        className="absolute bottom-[-10%] left-1/2 h-[60vh] w-[80vw] -translate-x-1/2 opacity-[0.07]"
        viewBox="0 0 800 600"
        fill="none"
      >
        <defs>
          <linearGradient id="runway-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M 350 0 L 200 600 L 600 600 L 450 0 Z"
          fill="url(#runway-fade)"
        />
        {/* center dashed line */}
        <line
          x1="400" y1="60" x2="400" y2="600"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeDasharray="4 18"
          opacity="0.6"
        />
      </motion.svg>
    </div>
  );
};
