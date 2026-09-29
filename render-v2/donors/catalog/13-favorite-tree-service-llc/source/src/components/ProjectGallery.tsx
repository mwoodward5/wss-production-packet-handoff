import { useState } from "react";
import { JsonLd } from "@/components/JsonLd";
import { CinematicLightbox } from "@/components/site/CinematicLightbox";
import { Maximize2 } from "lucide-react";

import { client } from '@/lib/wss-bridge';
export type GalleryPhoto = { src: string; alt: string };
export const HOME_GALLERY: GalleryPhoto[] = client.media.filter(m => m.role === 'gallery').map((m,i) => ({src:m.path,alt:client.identity.businessName+' — photo '+(i+1)}));
export const STUMP_REMOVAL_GALLERY: GalleryPhoto[] = [];
export const TREE_PRUNING_GALLERY: GalleryPhoto[] = [];
export const BUCKET_TRUCK_GALLERY: GalleryPhoto[] = [];

export function ProjectGallery({
  heading = "Project Gallery",
  photos = HOME_GALLERY,
}: {
  heading?: string;
  photos?: GalleryPhoto[];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!photos.length) return null;
  return (
    <section
      className="relative overflow-hidden py-20 sm:py-28"
      aria-labelledby="gallery-heading"
      style={{ backgroundColor: "oklch(0.96 0.012 92)" }}
    >
      {/* Editorial backdrop â€” topo lines + warm wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 10%, oklch(0.55 0.06 145) 0, transparent 40%), radial-gradient(circle at 90% 90%, oklch(0.68 0.155 55) 0, transparent 45%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-10" style={{ backgroundColor: "oklch(0.68 0.155 55)" }} />
            <p
              className="text-xs font-semibold uppercase tracking-[0.3em]"
              style={{ color: "oklch(0.68 0.155 55)" }}
            >
              The Field Archive
            </p>
            <span className="h-px w-10" style={{ backgroundColor: "oklch(0.68 0.155 55)" }} />
          </div>
          <h2
            id="gallery-heading"
            className="mt-4 font-serif text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
            style={{ color: "oklch(0.18 0.022 120)" }}
          >
            {heading}
          </h2>
          <p className="mt-5 text-muted-foreground">
            Tap a frame to view the full image.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {photos.map((p, i) => (
            <figure
              key={`${p.src}-${i}`}
              className="group relative rounded-[6px] bg-[oklch(0.97_0.012_92)] p-3 shadow-[0_2px_18px_-6px_oklch(0_0_0/0.18)] ring-1 ring-[oklch(0.18_0.022_120/0.08)] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_30px_60px_-20px_oklch(0.18_0.022_120/0.4)]"
            >
              <button
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="relative block w-full cursor-zoom-in overflow-hidden rounded-[3px] ring-1 ring-[oklch(0.18_0.022_120/0.12)]"
                aria-label={`Open image: ${p.alt}`}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-[oklch(0.92_0.012_92)]">
                  <img
                    src={p.src}
                    alt={p.alt}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[oklch(0.08_0.015_120/0.7)] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  />
                  <span
                    aria-hidden
                    className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-[oklch(0.18_0.022_120/0.55)] text-[oklch(0.94_0.018_92)] opacity-0 backdrop-blur-md transition-opacity duration-500 group-hover:opacity-100"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </span>
                  <figcaption className="absolute inset-x-4 bottom-3 translate-y-1 font-serif text-[13px] leading-snug text-[oklch(0.94_0.018_92)] opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                    {p.alt}
                  </figcaption>
                </div>
              </button>
              <figcaption className="mt-3 flex items-center justify-between px-1 font-serif text-[11px] tracking-[0.28em] uppercase text-[oklch(0.18_0.022_120)]/60">
                <span>â„–&nbsp;{String(i + 1).padStart(2, "0")}</span>
                <span className="mx-3 h-px flex-1 bg-[oklch(0.18_0.022_120/0.15)]" />
                <span style={{ color: "oklch(0.68 0.155 55)" }}>{client.identity.businessName}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      {lightboxIndex !== null && (
        <CinematicLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ImageGallery",
          name: heading,
          image: photos.map((p) => ({
            "@type": "ImageObject",
            contentUrl: p.src,
            description: p.alt,
          })),
        }}
      />
    </section>
  );
}
