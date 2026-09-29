import { useEffect, useRef } from "react";

/** Desktop-only cursor-reactive radial light. No-op on touch / reduced motion. */
export function CursorLight() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(hover: none)").matches;
    if (reduce || touch) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const rect = el.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.background = `radial-gradient(420px circle at ${x}% ${y}%, oklch(0.68 0.155 55 / 0.20), transparent 65%)`;
      });
    };
    const parent = el.parentElement;
    parent?.addEventListener("mousemove", onMove);
    return () => {
      parent?.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-[1] hidden lg:block"
      aria-hidden
    />
  );
}
