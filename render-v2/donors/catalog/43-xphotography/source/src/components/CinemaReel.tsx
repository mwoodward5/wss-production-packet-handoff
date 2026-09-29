import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import LightFrame from "./LightFrame";

export interface ReelFrame {
  src: string;
  alt: string;
  w?: number;
  h?: number;
  caption?: string;
  meta?: string;
}

interface Props {
  frames: ReelFrame[];
  reelLabel?: string;
}

export default function CinemaReel({ frames, reelLabel = "REEL 01" }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const scrollTo = (i: number) => {
    const idx = (i + frames.length) % frames.length;
    const el = trackRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setActive(idx);
  };

  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const onScroll = () => {
      const center = t.scrollLeft + t.clientWidth / 2;
      const items = Array.from(t.children) as HTMLElement[];
      let best = 0, bestD = Infinity;
      items.forEach((el, i) => {
        const c = el.offsetLeft + el.offsetWidth / 2;
        const d = Math.abs(c - center);
        if (d < bestD) { bestD = d; best = i; }
      });
      setActive(best);
    };
    t.addEventListener("scroll", onScroll, { passive: true });
    return () => t.removeEventListener("scroll", onScroll);
  }, []);

  const current = frames[active];
  const hasMeta = current?.caption || current?.meta;

  return (
    <section className="relative bg-paper py-12 md:py-20">
      <div className="container flex items-end justify-between mb-8">
        <div className="flex items-center gap-4">
          <span className="pulse-dot" />
          <span className="label-eyebrow text-molten">{reelLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => scrollTo(active - 1)} aria-label="Previous frame" className="w-12 h-12 border border-hairline hover:border-molten hover:text-molten text-ivory/70 inline-flex items-center justify-center transition">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-mono text-ivory/60 text-sm tabular-nums w-20 text-center">
            {String(active + 1).padStart(2, "0")} / {String(frames.length).padStart(2, "0")}
          </span>
          <button onClick={() => scrollTo(active + 1)} aria-label="Next frame" className="w-12 h-12 border border-hairline hover:border-molten hover:text-molten text-ivory/70 inline-flex items-center justify-center transition">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex gap-6 md:gap-8 overflow-x-auto snap-x snap-mandatory scroll-smooth px-[8vw] pb-6 items-center"
        style={{ scrollbarWidth: "none" }}
      >
        {frames.map((f, i) => {
          const ratio = f.w && f.h ? f.w / f.h : 3 / 2;
          return (
            <div
              key={i}
              className="snap-center shrink-0 h-[62vh] md:h-[72vh]"
              style={{ aspectRatio: ratio }}
            >
              <LightFrame>
                <img
                  src={f.src}
                  alt={f.alt}
                  width={f.w}
                  height={f.h}
                  className="block w-full h-full object-contain"
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                />
              </LightFrame>
            </div>
          );
        })}
      </div>

      {hasMeta && (
        <div className="container mt-8 flex items-baseline justify-between gap-8 flex-wrap">
          {current?.caption && (
            <p className="font-display text-xl md:text-2xl text-ivory italic max-w-2xl text-balance">
              "{current.caption}"
            </p>
          )}
          {current?.meta && <span className="label-eyebrow text-ivory/55">{current.meta}</span>}
        </div>
      )}
    </section>
  );
}
