/**
 * Gallery — optional lightbox.
 * Accepts images via props or falls back to assets-manifest placeholder.
 */
import { useState } from "react";
import { FEATURES } from "@/config";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

export interface GalleryItem {
  src: string;
  alt: string;
  caption?: string;
}

export function Gallery({ items = [] }: { items?: GalleryItem[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-12">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setIndex(i); setOpen(FEATURES.galleryLightbox); }}
            className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted group"
          >
            <img src={it.src} alt={it.alt} loading="lazy" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
          </button>
        ))}
      </div>
      {FEATURES.galleryLightbox && (
        <Lightbox open={open} close={() => setOpen(false)} index={index} slides={items.map((it) => ({ src: it.src, alt: it.alt, description: it.caption }))} />
      )}
    </section>
  );
}
