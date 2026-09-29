import { motion, useScroll, useSpring } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Thin gradient progress rail pinned to the very top of the viewport.
 * Reads document scroll, smooths it through a spring, and renders a
 * left-to-right gold/horizon ribbon. Disabled for reduced-motion users.
 */
export const ScrollProgress = () => {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX, transformOrigin: "0% 50%" }}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-[linear-gradient(90deg,hsl(var(--primary))_0%,hsl(var(--primary-glow))_50%,hsl(var(--horizon))_100%)] shadow-[0_0_12px_hsl(var(--primary)/0.55)]"
    />
  );
};
