import { useState } from "react";
import { X } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import {gallery,site} from "@/lib/site";
export const projectPhotos=gallery.map((m,i)=>({src:m.path,alt:`${site.name} — project photo ${i+1}`}));

export function ProjectGallery({
  title = "Project gallery",
  eyebrow = "Our Work",
  subtitle = "",
  limit,
}: {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  limit?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const items = limit ? projectPhotos.slice(0, limit) : projectPhotos;

  if (!items.length) return null;
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
