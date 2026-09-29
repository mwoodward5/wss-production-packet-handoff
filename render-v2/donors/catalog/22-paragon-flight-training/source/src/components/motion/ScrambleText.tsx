import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface ScrambleTextProps {
  text: string;
  className?: string;
  duration?: number;
  trigger?: "mount" | "view";
  as?: keyof JSX.IntrinsicElements;
}

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789·/";

/**
 * Scramble decode effect — characters cycle through random glyphs
 * before locking to their final state. Spaces preserved, punctuation
 * locks immediately for legibility.
 */
export const ScrambleText = ({
  text,
  className,
  duration = 900,
  trigger = "view",
  as: Tag = "span",
}: ScrambleTextProps) => {
  const reduced = useReducedMotion();
  const [out, setOut] = useState(reduced ? text : "");
  const ref = useRef<HTMLElement | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (reduced) {
      setOut(text);
      return;
    }
    const run = () => {
      if (ranRef.current) return;
      ranRef.current = true;
      const start = performance.now();
      let raf = 0;
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const reveal = Math.floor(text.length * p);
        let next = "";
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (i < reveal || ch === " " || /[.,!?']/.test(ch)) {
            next += ch;
          } else {
            next += CHARS[Math.floor(Math.random() * CHARS.length)];
          }
        }
        setOut(next);
        if (p < 1) raf = requestAnimationFrame(tick);
        else setOut(text);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    };

    if (trigger === "mount") {
      return run();
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            run();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [text, duration, reduced, trigger]);

  const Tagged = Tag as any;
  return (
    <Tagged ref={ref} className={className} aria-label={text}>
      {out || "\u00A0"}
    </Tagged>
  );
};
