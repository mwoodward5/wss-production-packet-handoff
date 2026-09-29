import { ReactNode } from "react";
import { motion, useReducedMotion as fmReduced } from "framer-motion";

interface SectionRevealProps {
  children: ReactNode;
  /** Stagger delay for child elements (seconds). */
  delay?: number;
  className?: string;
  /** When true, animation re-plays on every entry (default: once). */
  repeat?: boolean;
  /** Direction of the entrance translate. */
  from?: "bottom" | "left" | "right";
}

/**
 * SectionReveal — soft section entrance.
 * Fades + slides children in once they cross 12% of the viewport.
 * Honors prefers-reduced-motion automatically (no transform, instant fade).
 */
export const SectionReveal = ({
  children,
  delay = 0,
  className,
  repeat = false,
  from = "bottom",
}: SectionRevealProps) => {
  const reduced = fmReduced();

  const offset = reduced
    ? { x: 0, y: 0 }
    : from === "left"
      ? { x: -28, y: 0 }
      : from === "right"
        ? { x: 28, y: 0 }
        : { x: 0, y: 32 };

  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: !repeat, amount: 0.12, margin: "-80px" }}
      transition={{
        duration: reduced ? 0.2 : 0.85,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
