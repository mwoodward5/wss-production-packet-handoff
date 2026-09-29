import { client } from "@/lib/wss-bridge";
/**
 * Homepage video gallery — real Favorite Tree Service field clips,
 * presented as cinematic "projector screens in the forest" panels.
 *
 * Aesthetic: editorial heritage — loam background, copper hairlines,
 * cream serif type, drifting topo schematic, film grain, parallax
 * canopy silhouettes, and an inset projector frame around each video.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize2, X } from "lucide-react";

export type FieldClip = {
  src: string;
  poster?: string;
  label: string;
  caption: string;
};

const DEFAULT_CLIPS: FieldClip[] = []; // No certified field-video role in CSD.

/* ------------------------------------------------------------------ */
/* Atmospheric forest backdrop — drifting canopy silhouettes + topo   */
/* ------------------------------------------------------------------ */
function ForestBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* loam wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 20% 20%, oklch(0.32 0.05 145 / 0.55), transparent 65%)," +
            "radial-gradient(ellipse 60% 50% at 90% 80%, oklch(0.68 0.155 55 / 0.18), transparent 65%)," +
            "linear-gradient(180deg, oklch(0.16 0.022 120) 0%, oklch(0.10 0.018 120) 100%)",
        }}
      />
      {/* topographic schematic */}
      <svg
        className="absolute inset-0 h-full w-full ft3-schematic"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="topoFade" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="oklch(0.94 0.018 92)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="oklch(0.94 0.018 92)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="oklch(0.94 0.018 92)" strokeWidth="0.6" opacity="0.22">
          {Array.from({ length: 14 }).map((_, i) => (
            <ellipse
              key={i}
              cx="800"
              cy="450"
              rx={140 + i * 70}
              ry={70 + i * 36}
            />
          ))}
        </g>
        <rect width="1600" height="900" fill="url(#topoFade)" />
      </svg>

      {/* canopy silhouette — back */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[55%] w-full opacity-70"
        viewBox="0 0 1600 400"
        preserveAspectRatio="none"
      >
        <path
          d="M0,400 L0,260 C80,210 140,250 220,220 C300,190 340,260 420,235 C500,210 560,255 640,225 C720,195 780,250 860,220 C940,190 1000,255 1080,225 C1160,195 1220,250 1300,220 C1380,190 1460,250 1540,225 L1600,235 L1600,400 Z"
          fill="oklch(0.14 0.020 130)"
        />
      </svg>
      {/* canopy silhouette — front (parallax) */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[42%] w-full"
        viewBox="0 0 1600 320"
        preserveAspectRatio="none"
      >
        <path
          d="M0,320 L0,200 C90,170 160,210 240,180 C320,150 380,205 460,175 C540,145 620,210 700,180 C780,150 860,210 940,180 C1020,150 1100,205 1180,175 C1260,145 1340,205 1420,175 C1500,150 1560,205 1600,185 L1600,320 Z"
          fill="oklch(0.08 0.015 130)"
        />
      </svg>

      {/* drifting amber haze */}
      <div
        className="absolute -left-1/4 top-1/3 h-[60vh] w-[60vh] rounded-full blur-3xl opacity-30 animate-amber-radiate"
        style={{ background: "radial-gradient(circle, oklch(0.68 0.155 55 / 0.55), transparent 70%)" }}
      />
      <div
        className="absolute -right-1/4 top-10 h-[40vh] w-[40vh] rounded-full blur-3xl opacity-25"
        style={{ background: "radial-gradient(circle, oklch(0.55 0.06 145 / 0.6), transparent 70%)" }}
      />

      {/* film grain */}
      <div className="absolute inset-0 ft3-grain" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Projector card — single video framed as a forest-screen reel       */
/* ------------------------------------------------------------------ */
function ProjectorCard({
  clip,
  index,
  onExpand,
}: {
  clip: FieldClip;
  index: number;
  onExpand: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  return (
    <figure
      className="group relative isolate"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ animationDelay: `${index * 0.12}s` }}
    >
      {/* lift halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 rounded-[28px] opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, oklch(0.68 0.155 55 / 0.45), transparent 70%)",
        }}
      />

      {/* projector light beam (above the screen, angled) */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-36%] h-[55%] w-[120%] -translate-x-1/2 opacity-0 mix-blend-screen transition-opacity duration-700 group-hover:opacity-90"
        style={{
          background:
            "conic-gradient(from 270deg at 50% 100%, transparent 0deg, oklch(0.94 0.018 92 / 0.18) 8deg, oklch(0.68 0.155 55 / 0.10) 18deg, transparent 30deg)",
          filter: "blur(8px)",
        }}
      />

      {/* outer projector chassis */}
      <div className="relative rounded-[22px] border border-[oklch(0.68_0.155_55)]/35 bg-[oklch(0.12_0.018_120)]/85 p-3 shadow-[0_30px_80px_-30px_oklch(0_0_0/0.85)] backdrop-blur-md">
        {/* corner crop marks */}
        <CropMarks />

        {/* screen bezel */}
        <div className="relative overflow-hidden rounded-[14px] ring-1 ring-[oklch(0.94_0.018_92)]/10">
          {/* subtle CRT vignette */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 rounded-[14px]"
            style={{
              boxShadow:
                "inset 0 0 60px oklch(0 0 0 / 0.6), inset 0 0 12px oklch(0 0 0 / 0.4)",
            }}
          />
          {/* scanlines */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 opacity-[0.10] mix-blend-overlay"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, oklch(0 0 0 / 0.6) 0px, oklch(0 0 0 / 0.6) 1px, transparent 1px, transparent 3px)",
            }}
          />
          {/* shine sweep — triggers on hover */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
          >
            <div className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[oklch(0.94_0.018_92)]/35 to-transparent opacity-0 translate-x-0 transition-all duration-[1100ms] ease-out group-hover:opacity-100 group-hover:translate-x-[420%]" />
          </div>

          {/* video */}
          <video
            ref={videoRef}
            src={clip.src}
            poster={clip.poster}
            muted
            loop
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="relative z-10 aspect-[9/16] w-full bg-black object-contain transition-[filter] duration-700 ease-out group-hover:brightness-110"
            style={{
              filter:
                "contrast(1.04) saturate(1.02) brightness(1.0)",
            }}
          />

          {/* center play / pause */}
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause clip" : "Play clip"}
            className="absolute inset-0 z-30 grid place-items-center"
          >
            <span
              className={`grid h-16 w-16 place-items-center rounded-full border border-[oklch(0.68_0.155_55)]/70 bg-[oklch(0.12_0.018_120)]/65 text-[oklch(0.94_0.018_92)] backdrop-blur-md transition-all duration-500 ${
                playing
                  ? "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
                  : "opacity-100 scale-100 animate-pulse-glow"
              }`}
            >
              {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-[1px]" />}
            </span>
          </button>

          {/* expand */}
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand clip"
            className="absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-[oklch(0.94_0.018_92)]/20 bg-[oklch(0.12_0.018_120)]/60 text-[oklch(0.94_0.018_92)] backdrop-blur-md transition hover:border-[oklch(0.68_0.155_55)] hover:text-[oklch(0.68_0.155_55)]"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          {/* reel index plate */}
          <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full border border-[oklch(0.94_0.018_92)]/15 bg-[oklch(0.12_0.018_120)]/60 px-3 py-1 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.155_55)] shadow-[0_0_10px_oklch(0.68_0.155_55)]" />
            <span className="font-serif text-[11px] uppercase tracking-[0.28em] text-[oklch(0.94_0.018_92)]/85">
              № {String(index + 1).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* projector base / caption plate */}
        <figcaption className="relative mt-4 flex items-start justify-between gap-4 px-2 pb-1">
          <div>
            <div className="font-serif text-[11px] uppercase tracking-[0.32em] text-[oklch(0.68_0.155_55)]">
              {clip.label}
            </div>
            <p className="mt-1 max-w-sm font-serif text-sm leading-relaxed text-[oklch(0.94_0.018_92)]/80">
              {clip.caption}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-[oklch(0.55_0.06_145)]" />
            <span className="h-2 w-2 rounded-full bg-[oklch(0.94_0.018_92)]/30" />
            <span className="h-2 w-2 rounded-full bg-[oklch(0.94_0.018_92)]/30" />
          </div>
        </figcaption>

        {/* hairline */}
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.68_0.155_55)]/60 to-transparent" />
      </div>

      {/* tripod stems */}
      <div aria-hidden className="pointer-events-none mx-auto mt-1 flex justify-center gap-24 opacity-40">
        <span className="block h-6 w-px rotate-[8deg] bg-[oklch(0.68_0.155_55)]/40" />
        <span className="block h-6 w-px -rotate-[8deg] bg-[oklch(0.68_0.155_55)]/40" />
      </div>
    </figure>
  );
}

function CropMarks() {
  const cls =
    "pointer-events-none absolute h-3 w-3 border-[oklch(0.68_0.155_55)]/70";
  return (
    <>
      <span className={`${cls} left-1 top-1 border-l border-t`} />
      <span className={`${cls} right-1 top-1 border-r border-t`} />
      <span className={`${cls} left-1 bottom-1 border-l border-b`} />
      <span className={`${cls} right-1 bottom-1 border-r border-b`} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cinematic theater modal — full-screen projector view               */
/* ------------------------------------------------------------------ */
function TheaterModal({
  clip,
  onClose,
}: {
  clip: FieldClip;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.18_0.022_120/0.92),oklch(0.06_0.012_120/0.99))] backdrop-blur-xl"
      />
      <div className="absolute inset-0 ft3-grain pointer-events-none" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-6 top-6 z-10 grid h-11 w-11 place-items-center rounded-full border border-[oklch(0.94_0.018_92)]/20 bg-[oklch(0.12_0.018_120)]/60 text-[oklch(0.94_0.018_92)] transition hover:border-[oklch(0.68_0.155_55)] hover:text-[oklch(0.68_0.155_55)]"
      >
        <X className="h-5 w-5" />
      </button>

      <figure className="relative z-[5] mx-auto w-[min(92vw,520px)] animate-scale-in">
        <div className="relative rounded-2xl border border-[oklch(0.68_0.155_55)]/40 bg-[oklch(0.12_0.018_120)]/85 p-3 shadow-[0_60px_140px_-30px_oklch(0_0_0/0.85)]">
          <CropMarks />
          <div className="relative overflow-hidden rounded-xl ring-1 ring-[oklch(0.94_0.018_92)]/10">
            <video
              src={clip.src}
              poster={clip.poster}
              autoPlay
              loop
              controls
              playsInline
              className="aspect-[9/16] w-full bg-black object-contain"
              style={{ filter: "contrast(1.06) saturate(1.08)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ boxShadow: "inset 0 0 100px oklch(0 0 0 / 0.55)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, oklch(0 0 0 / 0.6) 0, oklch(0 0 0 / 0.6) 1px, transparent 1px, transparent 3px)",
              }}
            />
          </div>
          <figcaption className="mt-4 flex items-center justify-between px-2">
            <span className="font-serif text-xs uppercase tracking-[0.32em] text-[oklch(0.68_0.155_55)]">
              {clip.label}
            </span>
            <span className="font-serif text-xs uppercase tracking-[0.28em] text-[oklch(0.94_0.018_92)]/70">
              {client.identity.businessName}
            </span>
          </figcaption>
        </div>
      </figure>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main export                                                        */
/* ------------------------------------------------------------------ */
export function FieldVideoGallery({
  heading = "From the Field",
  subheading = "Field videos",
  clips = DEFAULT_CLIPS,
}: {
  heading?: string;
  subheading?: string;
  clips?: FieldClip[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!clips.length) return null;

  return (
    <section
      className="relative overflow-hidden py-24 sm:py-32"
      aria-labelledby="field-video-heading"
      style={{ background: "oklch(0.10 0.018 120)" }}
    >
      <ForestBackdrop />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* eyebrow */}
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <span className="h-px w-10 bg-[oklch(0.68_0.155_55)]" />
            <span className="font-serif text-[11px] uppercase tracking-[0.4em] text-[oklch(0.68_0.155_55)]">
              Projection Reel
            </span>
            <span className="h-px w-10 bg-[oklch(0.68_0.155_55)]" />
          </div>
          <h2
            id="field-video-heading"
            className="mt-5 font-serif text-4xl leading-[1.05] text-[oklch(0.94_0.018_92)] sm:text-6xl"
          >
            {heading}
          </h2>
          <p className="mt-5 max-w-xl font-serif text-base leading-relaxed text-[oklch(0.94_0.018_92)]/75 sm:text-lg">
            {subheading}
          </p>
          <div className="fts-amber-line mt-8 w-40" />
        </div>

        {/* gallery — three projector screens in the forest */}
        <div className="mx-auto mt-16 grid max-w-5xl gap-10 sm:gap-12 lg:grid-cols-2">
          {clips.map((clip, i) => (
            <ProjectorCard
              key={clip.src}
              clip={clip}
              index={i}
              onExpand={() => setOpenIndex(i)}
            />
          ))}
        </div>

        {/* footer plate */}
        <div className="mt-14 flex items-center justify-center gap-3 font-serif text-[11px] uppercase tracking-[0.4em] text-[oklch(0.94_0.018_92)]/55">
          <span className="h-px w-10 bg-[oklch(0.94_0.018_92)]/30" />
          <span>Field Reel</span>
          <span className="h-px w-10 bg-[oklch(0.94_0.018_92)]/30" />
        </div>
      </div>

      {openIndex !== null && (
        <TheaterModal clip={clips[openIndex]} onClose={() => setOpenIndex(null)} />
      )}
    </section>
  );
}
