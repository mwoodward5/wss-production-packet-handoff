import { useEffect, useRef } from "react";

export function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const dot = dotRef.current!;
    const ring = ringRef.current!;
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let raf = 0;

    const move = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    };
    const tick = () => {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, button, [data-cursor='hover']")) {
        ring.style.width = "60px";
        ring.style.height = "60px";
        ring.style.borderColor = "oklch(0.78 0.13 78)";
        ring.style.backgroundColor = "oklch(0.78 0.13 78 / 0.08)";
      } else {
        ring.style.width = "28px";
        ring.style.height = "28px";
        ring.style.borderColor = "oklch(0.95 0.022 85 / 0.45)";
        ring.style.backgroundColor = "transparent";
      }
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseover", over);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseover", over);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[200] hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bone/40 transition-[width,height,background-color,border-color] duration-200 md:block"
        style={{ marginLeft: "-14px", marginTop: "-14px" }}
      />
      <div
        ref={dotRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[201] hidden h-1.5 w-1.5 rounded-full bg-brass md:block"
        style={{ marginLeft: "-3px", marginTop: "-3px" }}
      />
    </>
  );
}