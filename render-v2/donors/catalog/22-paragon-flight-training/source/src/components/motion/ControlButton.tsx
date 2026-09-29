import { ReactNode, MouseEvent, useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "link";
type Size = "sm" | "md" | "lg";

interface ControlButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  as?: "a" | "button";
  variant?: Variant;
  className?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Magnetic strength in px. 0 disables. */
  magnet?: number;
  size?: Size;

  /** @deprecated kept for back-compat — no longer rendered. */
  code?: string;
  /** @deprecated kept for back-compat — no longer rendered. */
  status?: "armed" | "standby" | "active" | "off";
}

const SIZE: Record<Size, string> = {
  sm: "h-10 px-4 text-[12px]",
  md: "h-12 px-6 text-[13px]",
  lg: "h-14 px-7 text-sm",
};

/**
 * Variant styling — polished Web 3.0:
 * - primary: gold gradient fill, inner light, soft glow
 * - secondary: glass panel with chrome edge lighting
 * - ghost: subtle surface, gradient-border shine on hover
 * - link: borderless underline-style for inline use
 */
const VARIANT: Record<Variant, string> = {
  primary: cn(
    "text-primary-foreground",
    "bg-[linear-gradient(180deg,hsl(var(--primary-glow))_0%,hsl(var(--primary))_55%,hsl(var(--horizon))_100%)]",
    "shadow-[0_1px_0_0_hsl(0_0%_100%/0.35)_inset,0_-1px_0_0_hsl(var(--sky-deep)/0.4)_inset,0_10px_30px_-10px_hsl(var(--primary)/0.55)]",
    "hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.45)_inset,0_-1px_0_0_hsl(var(--sky-deep)/0.4)_inset,0_18px_40px_-12px_hsl(var(--primary)/0.7)]",
  ),
  secondary: cn(
    "text-foreground",
    "bg-[linear-gradient(180deg,hsl(var(--surface-elevated)/0.7)_0%,hsl(var(--surface)/0.6)_100%)] backdrop-blur-md",
    "shadow-[0_1px_0_0_hsl(var(--foreground)/0.08)_inset,0_-1px_0_0_hsl(var(--sky-deep)/0.5)_inset,0_8px_24px_-12px_hsl(var(--sky-deep)/0.6)]",
    "hover:text-primary",
  ),
  ghost: cn(
    "text-foreground",
    "bg-[linear-gradient(180deg,hsl(var(--surface)/0.6)_0%,hsl(var(--surface-elevated)/0.5)_100%)]",
    "shadow-[0_1px_0_0_hsl(var(--foreground)/0.06)_inset,0_8px_20px_-14px_hsl(var(--sky-deep)/0.5)]",
    "hover:text-primary",
  ),
  link:
    "h-auto px-1 py-1 bg-transparent text-foreground/85 hover:text-primary",
};

/**
 * ControlButton — polished Web 3.0 CTA.
 *
 * Square rectangle with:
 * - Gradient fills + inner highlight (top) + inset shadow (bottom) for soft depth
 * - Chrome/glass edge lighting via gradient-border ::before mask (non-link variants)
 * - Diagonal shine sweep on hover (non-link variants)
 * - Magnetic pull toward cursor + spring-back on leave
 * - Press scale + brightness drop for tactile feedback
 * - Visible focus ring, full keyboard support
 */
export const ControlButton = ({
  children,
  href,
  onClick,
  type,
  as = "a",
  variant = "primary",
  className,
  ariaLabel,
  icon,
  trailingIcon,
  magnet = 14,
  size = "lg",
}: ControlButtonProps) => {
  const ref = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const reduced = useReducedMotion();

  // Magnetic offset
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 240, damping: 22, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 240, damping: 22, mass: 0.4 });

  // Cursor-tracked specular highlight (0-100% across the surface)
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const bgX = useTransform(mx, (v) => `${v}%`);
  const bgY = useTransform(my, (v) => `${v}%`);

  const handleMove = (e: MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    mx.set((px / r.width) * 100);
    my.set((py / r.height) * 100);
    if (reduced || magnet === 0) return;
    const cx = px - r.width / 2;
    const cy = py - r.height / 2;
    x.set((cx / r.width) * magnet);
    y.set((cy / r.height) * magnet);
  };

  const handleLeave = () => {
    x.set(0);
    y.set(0);
    mx.set(50);
    my.set(50);
  };

  const Comp = as === "a" ? motion.a : motion.button;
  const isLink = variant === "link";

  return (
    <Comp
      // @ts-expect-error polymorphic ref
      ref={ref}
      href={href}
      onClick={onClick}
      type={type}
      aria-label={ariaLabel}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      whileTap={
        reduced
          ? undefined
          : { scale: 0.97, filter: "brightness(0.95)", transition: { duration: 0.08 } }
      }
      style={{ x: sx, y: sy }}
      className={cn(
        "group relative inline-flex select-none items-center justify-center gap-2.5 overflow-hidden whitespace-nowrap rounded-md",
        "font-display font-semibold tracking-wide",
        "transition-[color,box-shadow,transform] duration-300 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !isLink && SIZE[size],
        VARIANT[variant],
        className,
      )}
    >
      {/* Cursor specular highlight — soft, follows pointer */}
      {!isLink && !reduced && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: useTransform(
              [bgX, bgY],
              ([bx, by]) =>
                `radial-gradient(180px circle at ${bx} ${by}, hsl(var(--foreground) / 0.18), transparent 60%)`,
            ),
          }}
        />
      )}

      {/* Chrome edge lighting — gradient border via mask */}
      {!isLink && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-md p-px",
            "bg-[linear-gradient(180deg,hsl(var(--foreground)/0.35)_0%,hsl(var(--foreground)/0.05)_45%,hsl(var(--sky-deep)/0.4)_100%)]",
            "[mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] [-webkit-mask-composite:xor]",
            variant === "primary" &&
              "bg-[linear-gradient(180deg,hsl(0_0%_100%/0.55)_0%,hsl(var(--primary)/0.2)_50%,hsl(var(--sky-deep)/0.5)_100%)]",
          )}
        />
      )}

      {/* Diagonal shine sweep on hover */}
      {!isLink && !reduced && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -translate-x-full rounded-md bg-[linear-gradient(115deg,transparent_30%,hsl(var(--foreground)/0.18)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover:translate-x-full"
        />
      )}

      {/* Content */}
      <span className="relative z-10 flex items-center gap-2.5">
        {icon && <span className="flex flex-none items-center">{icon}</span>}
        <span className="leading-none">{children}</span>
        {trailingIcon && (
          <span className="flex flex-none items-center transition-transform duration-300 group-hover:translate-x-0.5">
            {trailingIcon}
          </span>
        )}
      </span>

      {/* Link variant: animated underline */}
      {isLink && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1 -bottom-0.5 h-px origin-left scale-x-0 bg-current transition-transform duration-300 group-hover:scale-x-100"
        />
      )}
    </Comp>
  );
};
