import { motion, useMotionValue, useSpring } from "framer-motion";
import { useRef, MouseEvent, ReactNode } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface MagneticButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  strength?: number;
  as?: "a" | "button";
  ariaLabel?: string;
  type?: "button" | "submit";
}

/**
 * Magnetic button — cursor pulls the element on hover.
 * Disabled for reduced-motion + touch devices.
 */
export const MagneticButton = ({
  children,
  href,
  onClick,
  className,
  strength = 18,
  as = "a",
  ariaLabel,
  type,
}: MagneticButtonProps) => {
  const ref = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 200, damping: 18, mass: 0.4 });

  const handleMove = (e: MouseEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - (r.left + r.width / 2);
    const py = e.clientY - (r.top + r.height / 2);
    x.set((px / r.width) * strength);
    y.set((py / r.height) * strength);
  };

  const handleLeave = () => {
    x.set(0);
    y.set(0);
  };

  const Comp = as === "a" ? motion.a : motion.button;

  return (
    <Comp
      // @ts-expect-error - ref typing for polymorphic motion element
      ref={ref}
      href={href}
      onClick={onClick}
      type={type}
      aria-label={ariaLabel}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x: sx, y: sy }}
      className={className}
    >
      <motion.span style={{ x: sx, y: sy, display: "inline-flex" }} className="contents">
        {children}
      </motion.span>
    </Comp>
  );
};
