/**
 * ServicesGallery — masonry photo grid for the /services route.
 * Uses the ordered, certified client gallery.
 */
import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

import { gallery } from "@/wss/bridge";
const PHOTOS = gallery.slice(0, 16);

export function ServicesGallery() {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  if (!PHOTOS.length) return null;
  return (
    <div>
      <div className="columns-2 md:columns-3 lg:columns-4 gap-3 lg:gap-4 [column-fill:_balance]">
        {PHOTOS.map((media, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setIdx(i); setOpen(true); }}
            className="group relative mb-3 lg:mb-4 block w-full overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elevated)] transition-shadow break-inside-avoid"
          >
            <img
              src={media.src}
              alt={media.alt}
              loading={i < 4 ? "eager" : "lazy"}
              decoding="async"
              className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={idx}
        slides={PHOTOS.map((media, i) => ({ src: media.src, alt: media.alt }))}
      />
    </div>
  );
}
