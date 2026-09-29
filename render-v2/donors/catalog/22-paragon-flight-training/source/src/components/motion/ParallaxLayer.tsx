import { ReactNode, useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface ParallaxLayerProps {
  children: ReactNode;
  /** Pixel travel across the viewport. Positive = drifts up. Keep small (8–60). */
  offset?: number;
  /** Optional opposite-direction drift for layered depth. */
  reverse?: boolean;
  /** Extra fade-on-exit for atmospheric layers. */
  fadeOnExit?: boolean;
  className?: string;
  as?: "div" | "section" | "aside";
}

/**
 * ParallaxLayer — subtle, GPU-only scroll parallax.
 * Wrap any element to make it drift as it crosses the viewport.
 * Aviation-premium: small offsets, smooth spring, honors reduced-motion.
 */
export const ParallaxLayer = ({
  children,
  offset = 32,
  reverse = false,
  fadeOnExit = false,
  className,
  as = "div",
}: ParallaxLayerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const distance = reduced ? 0 : offset * (reverse ? 1 : -1);
  const yRaw = useTransform(scrollYProgress, [0, 1], [`${-distance}px`, `${distance}px`]);
  const y = useSpring(yRaw, { stiffness: 60, damping: 20, mass: 0.4 });

  const opacity = useTransform(
    scrollYProgress,
    [0, 0.15, 0.85, 1],
    fadeOnExit && !reduced ? [0.4, 1, 1, 0.4] : [1, 1, 1, 1],
  );

  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag
      ref={ref}
      style={{ y, opacity, willChange: "transform" }}
      className={className}
    >
      {children}
    </Tag>
  );
};
