import { useEffect, useRef } from "react";
import type { MediaItem } from "@/data/media";

interface Props {
  item: MediaItem;
  frameCount?: number;
}

/**
 * CSS-only "bullet time" strip. Four <video> elements share the same
 * clip, each offset to a different currentTime, playing at 0.25× so a
 * single motion beat is stretched across the row.
 */
export function SlowMoStrip({ item, frameCount = 4 }: Props) {
  const refs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    refs.current.forEach((v, i) => {
      if (!v) return;
      const offset = (i / frameCount) * 0.9; // 0..0.9 of clip
      const setup = () => {
        v.playbackRate = 0.25;
        v.currentTime = offset * v.duration;
        v.play().catch(() => {});
      };
      if (v.readyState >= 1) setup();
      else v.addEventListener("loadedmetadata", setup, { once: true });
    });
  }, [item.src, frameCount]);

  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: frameCount }).map((_, i) => (
        <div
          key={i}
          className="relative overflow-hidden bg-ink-2"
          style={{ aspectRatio: "9/16", filter: "grayscale(0.35) contrast(1.1)" }}
        >
          <video
            ref={(el) => {
              refs.current[i] = el;
            }}
            src={item.src}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 border border-edge/40" />
          <div className="pointer-events-none absolute bottom-1 left-1 font-mono text-[10px] text-edge/80">
            f{String(i + 1).padStart(2, "0")}
          </div>
        </div>
      ))}
    </div>
  );
}
