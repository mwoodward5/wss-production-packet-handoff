import { useState } from "react";
import { X } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import p1 from "@/assets/projects/project-01.jpg";
import p2 from "@/assets/projects/project-02.jpg";
import p3 from "@/assets/projects/project-03.jpg";
import p4 from "@/assets/projects/project-04.jpg";
import p5 from "@/assets/projects/project-05.jpg";
import p6 from "@/assets/projects/project-06.jpg";
import p7 from "@/assets/projects/project-07.jpg";
import p8 from "@/assets/projects/project-08.jpg";
import p9 from "@/assets/projects/project-09.jpg";
import p10 from "@/assets/projects/project-10.jpg";
import p11 from "@/assets/projects/project-11.jpg";
import p12 from "@/assets/projects/project-12.jpg";

// PHOTO SLOTS — the twelve gallery tiles are the donor's ONLY photo slots (one
// .jpg per tile: the engine fills one file per slot, so a webp/jpg pair would
// burn two of the client's photos per visible tile). Neutral subjects + the
// client's own name — never the donor's cities.
export const projectPhotos = [
  { src: p1, alt: "Concrete flatwork project by {{BUSINESS_NAME}}" },
  { src: p2, alt: "Commercial concrete pour by {{BUSINESS_NAME}}" },
  { src: p3, alt: "Residential driveway installation by {{BUSINESS_NAME}}" },
  { src: p4, alt: "Foundation excavation work by {{BUSINESS_NAME}}" },
  { src: p5, alt: "Concrete demolition project by {{BUSINESS_NAME}}" },
  { src: p6, alt: "Bathroom remodel by {{BUSINESS_NAME}}" },
  { src: p7, alt: "Tile flooring installation by {{BUSINESS_NAME}}" },
  { src: p8, alt: "Home renovation interior work by {{BUSINESS_NAME}}" },
  { src: p9, alt: "Concrete deck pour by {{BUSINESS_NAME}}" },
  { src: p10, alt: "Commercial tenant improvement by {{BUSINESS_NAME}}" },
  { src: p11, alt: "Vinyl plank flooring installation by {{BUSINESS_NAME}}" },
  { src: p12, alt: "Finished concrete patio by {{BUSINESS_NAME}}" },
];

export function ProjectGallery({
  title = "Recent projects",
  eyebrow = "Our Work",
  subtitle = "A glimpse of concrete, renovation, and flooring jobs delivered by our crews.",
  limit,
}: {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  limit?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const items = limit ? projectPhotos.slice(0, limit) : projectPhotos;

  return (
    <section id="projects" className="bg-secondary py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <SectionHeading eyebrow={eyebrow} title={title} subtitle={subtitle} />
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(i)}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elegant focus:outline-none focus:ring-2 focus:ring-gold"
              aria-label={`View larger: ${p.alt}`}
            >
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      {open !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={items[open].src}
            alt={items[open].alt}
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain shadow-elegant"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
