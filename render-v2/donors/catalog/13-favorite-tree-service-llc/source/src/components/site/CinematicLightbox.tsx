import { client } from "@/lib/wss-bridge";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type LightboxPhoto = { src: string; alt: string };

export function CinematicLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const next = useCallback(
    () => onIndexChange((index + 1) % photos.length),
    [index, photos.length, onIndexChange],
  );
  const prev = useCallback(
    () => onIndexChange((index - 1 + photos.length) % photos.length),
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [next, prev, onClose]);

  if (typeof document === "undefined") return null;
  const photo = photos[index];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Project gallery viewer"
    >
      {/* Backdrop — loam-cream cinematic vignette */}
      <button
        type="button"
        aria-label="Close gallery"
        onClick={onClose}
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.18_0.022_120/0.92),oklch(0.08_0.015_120/0.985))] backdrop-blur-xl"
      />

      {/* Subtle film grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      {/* Top bar — index + brand mark */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="pointer-events-auto flex items-center gap-3 font-serif text-[oklch(0.94_0.018_92)]">
          <span className="inline-block h-px w-10 bg-[oklch(0.68_0.155_55)]" />
          <span className="text-sm tracking-[0.3em] uppercase opacity-80">
            {client.identity.businessName}
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-4">
          <span className="font-serif text-sm tracking-[0.25em] text-[oklch(0.94_0.018_92)]/80">
            {String(index + 1).padStart(2, "0")}
            <span className="mx-2 text-[oklch(0.68_0.155_55)]">/</span>
            {String(photos.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full border border-[oklch(0.94_0.018_92)]/20 bg-[oklch(0.18_0.022_120)]/40 text-[oklch(0.94_0.018_92)] transition hover:border-[oklch(0.68_0.155_55)] hover:text-[oklch(0.68_0.155_55)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Prev / Next */}
      <button
        type="button"
        onClick={prev}
        aria-label="Previous image"
        className="group absolute left-3 sm:left-8 z-10 grid h-14 w-14 place-items-center rounded-full border border-[oklch(0.94_0.018_92)]/15 bg-[oklch(0.18_0.022_120)]/40 text-[oklch(0.94_0.018_92)] transition hover:border-[oklch(0.68_0.155_55)] hover:bg-[oklch(0.18_0.022_120)]/70 hover:text-[oklch(0.68_0.155_55)]"
      >
        <ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5" />
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Next image"
        className="group absolute right-3 sm:right-8 z-10 grid h-14 w-14 place-items-center rounded-full border border-[oklch(0.94_0.018_92)]/15 bg-[oklch(0.18_0.022_120)]/40 text-[oklch(0.94_0.018_92)] transition hover:border-[oklch(0.68_0.155_55)] hover:bg-[oklch(0.18_0.022_120)]/70 hover:text-[oklch(0.68_0.155_55)]"
      >
        <ChevronRight className="h-6 w-6 transition-transform group-hover:translate-x-0.5" />
      </button>

      {/* Stage */}
      <figure
        key={photo.src}
        className="relative z-[5] mx-auto flex max-h-[88vh] max-w-[92vw] flex-col items-center animate-scale-in"
      >
        <div className="relative">
          {/* copper accent frame */}
          <span className="pointer-events-none absolute -inset-px rounded-[14px] bg-gradient-to-br from-[oklch(0.68_0.155_55)]/60 via-transparent to-[oklch(0.55_0.06_145)]/40" />
          <img
            src={photo.src}
            alt={photo.alt}
            className="relative max-h-[78vh] w-auto max-w-[92vw] rounded-[12px] object-contain shadow-[0_40px_120px_-20px_oklch(0_0_0/0.7)]"
          />
        </div>
        <figcaption className="mt-5 max-w-2xl px-4 text-center font-serif text-sm leading-relaxed text-[oklch(0.94_0.018_92)]/85 sm:text-base">
          {photo.alt}
        </figcaption>
      </figure>

      {/* Thumbnail strip */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-5 sm:pb-7">
        <div className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto rounded-full border border-[oklch(0.94_0.018_92)]/10 bg-[oklch(0.18_0.022_120)]/55 p-2 backdrop-blur-md">
          {photos.map((p, i) => (
            <button
              key={p.src + i}
              type="button"
              onClick={() => onIndexChange(i)}
              aria-label={`View image ${i + 1}`}
              className={`relative h-12 w-16 flex-shrink-0 overflow-hidden rounded-md border transition ${
                i === index
                  ? "border-[oklch(0.68_0.155_55)] opacity-100 ring-2 ring-[oklch(0.68_0.155_55)]/40"
                  : "border-transparent opacity-55 hover:opacity-100"
              }`}
            >
              <img src={p.src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
