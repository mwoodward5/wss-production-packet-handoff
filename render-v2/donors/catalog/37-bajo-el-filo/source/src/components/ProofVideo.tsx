import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/data/media";

interface Props {
  item: MediaItem;
  className?: string;
  eager?: boolean;
  autoPlayOnVisible?: boolean;
  objectPosition?: string;
  raw?: boolean;
  /** Reframe strategy for burned-in watermarks. "ig" = zoom + shift to crop out. */
  reframe?: "ig" | "none";
}

export function ProofVideo({
  item,
  className = "",
  eager = false,
  autoPlayOnVisible = true,
  objectPosition = "center",
  raw = false,
  reframe,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Auto-detect reframe when the item has burned-in IG marks.
  const mode: "ig" | "none" = reframe ?? (item.kind === "video" && item.maskCorners?.length ? "ig" : "none");

  useEffect(() => {
    if (item.kind !== "video" || !autoPlayOnVisible) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item.kind, autoPlayOnVisible]);

  const lift = raw ? "" : "media-lift";
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reframe transform crops out top-right IG glyph and bottom watermarks.
  const reframeStyle: React.CSSProperties =
    mode === "ig"
      ? { transform: "scale(1.22) translate(-1.5%, -5%)", transformOrigin: "center" }
      : {};

  const media =
    item.kind === "image" ? (
      <img
        src={item.src}
        alt={item.caption}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`${lift} h-full w-full`}
        style={{ objectFit: "cover", objectPosition, ...reframeStyle }}
      />
    ) : (
      <video
        ref={ref}
        src={item.src}
        poster={item.poster}
        muted
        loop
        playsInline
        autoPlay={!reduce}
        preload={eager ? "auto" : "metadata"}
        aria-label={item.caption}
        onLoadedData={() => setLoaded(true)}
        className={`${lift} h-full w-full`}
        style={{ objectFit: "cover", objectPosition, ...reframeStyle }}
      />
    );

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {/* Loading shimmer under the poster */}
      {item.kind === "video" && !loaded && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, rgba(255,255,255,0.02) 20%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 80%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.6s linear infinite",
          }}
        />
      )}
      {media}
    </div>
  );
}
