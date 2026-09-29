import { useEffect, useRef, useState } from "react";

export interface HeroMediaSource {
  src: string;
  type: string; // e.g. "video/mp4", "video/webm"
}

interface HeroMediaProps {
  poster?: string;
  posterAlt: string;
  /**
   * Optional video sources. If none are provided (or none can load), the
   * component renders the poster image as a stable still fallback.
   */
  sources?: HeroMediaSource[];
  width?: number;
  height?: number;
  /** Tailwind classes for the gradient overlay above the media. */
  overlayClassName?: string;
  /** Object position for the underlying image/video (mobile-safe cropping). */
  objectPosition?: string;
  priority?: boolean;
}

/**
 * Reusable hero media layer.
 * - Always renders the poster image first so there is no broken-media state.
 * - If `sources` are provided AND the user has not requested reduced motion,
 *   attempts to play a muted, looping, inline video on top of the poster.
 * - If video fails to load or is unsupported, the poster remains visible.
 * - Honors `prefers-reduced-motion: reduce` by disabling all motion.
 */
export const HeroMedia = ({
  poster,
  posterAlt,
  sources,
  width = 1920,
  height = 1080,
  overlayClassName = "bg-gradient-hero",
  objectPosition = "center",
  priority = true,
}: HeroMediaProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [allowVideo, setAllowVideo] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Mobile performance guard: only load the hero video on wider viewports
  // and when the connection isn't flagged as save-data / 2g / slow-2g.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    const slow = conn?.saveData || /^(slow-)?2g$/.test(conn?.effectiveType ?? "");
    const wide = window.matchMedia("(min-width: 768px)").matches;
    setAllowVideo(wide && !slow);
  }, []);

  const showVideo = !!sources?.length && !reducedMotion && allowVideo;
  return (
    <div className="absolute inset-0">
      {poster && <img
        src={poster}
        alt={posterAlt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        style={{ objectPosition }}
        className="h-full w-full object-cover"
      />}
      {showVideo && (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${videoReady ? "opacity-100" : "opacity-0"}`}
          style={{ objectPosition }}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
          aria-hidden="true"
          onPlaying={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
          onPause={() => setVideoReady(false)}
        >
          {sources!.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      )}
      <div className={`absolute inset-0 ${overlayClassName}`} />
    </div>
  );
};
