import { useEffect, useRef, useState } from "react";

export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<"default" | "link" | "image" | "view">("default");

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.documentElement.classList.add("has-custom-cursor");

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
      }
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("a, button, [data-cursor='link']")) setVariant("link");
      else if (t.closest("[data-cursor='view']")) setVariant("view");
      else if (t.closest("img, [data-cursor='image']")) setVariant("image");
      else setVariant("default");
    };

    const loop = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.classList.remove("has-custom-cursor");
    };
  }, []);

  const size =
    variant === "link" ? 64 :
    variant === "view" ? 96 :
    variant === "image" ? 80 : 28;

  return (
    <>
      <div
        ref={dotRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] hidden md:block"
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "var(--brass)",
          mixBlendMode: "difference",
        }}
      />
      <div
        ref={ringRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] hidden md:flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: "1px solid var(--brass)",
          mixBlendMode: "difference",
          transition: "width .4s cubic-bezier(.2,.8,.2,1), height .4s cubic-bezier(.2,.8,.2,1), background .3s ease",
          background: variant === "view" ? "oklch(0.74 0.085 75 / 0.12)" : "transparent",
          fontFamily: "var(--font-sans)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--brass)",
        }}
      >
        {variant === "view" ? "View" : ""}
      </div>
    </>
  );
}
