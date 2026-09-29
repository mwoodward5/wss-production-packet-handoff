import { useEffect, useRef } from "react";

/**
 * Tiny scroll-coupled parallax hook.
 * Returns a ref to attach to the element you want to translate.
 * Uses rAF + transform for GPU-accelerated, jank-free motion.
 * SSR-safe and respects prefers-reduced-motion.
 */
export function useParallax<T extends HTMLElement>(speed = 0.3) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const offset = rect.top + window.scrollY;
      const y = (window.scrollY - offset) * speed;
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(1.08)`;
      frame = 0;
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [speed]);

  return ref;
}
