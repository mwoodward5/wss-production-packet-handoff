/**
 * ProofGallery — asymmetric, framed gallery with captions and lightbox.
 * Breaks the uniform-grid look. Uses available real client photos only.
 */
import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { gallery } from "@/wss/bridge";
const FRAMES = gallery.slice(0, 6).map((media, index) => ({
  src: media.src, caption: media.caption || media.alt, tag: "Gallery",
  span: index === 0 ? "lg:col-span-2 lg:row-span-2 aspect-[4/5]" : index < 3 ? "lg:col-span-1 aspect-[4/3]" : "lg:col-span-1 aspect-square",
}));

export function ProofGallery() {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  if (!FRAMES.length) return null;
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 lg:grid-rows-2 gap-3 lg:gap-4">
        {FRAMES.map((f, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setIdx(i); setOpen(true); }}
            className={`group relative overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elevated)] transition-shadow ${f.span}`}
          >
            <img
              src={f.src}
              alt={f.caption}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent opacity-90" />
            <div className="absolute top-3 left-3 inline-flex items-center rounded-full bg-white/85 backdrop-blur px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#FF9400] border border-[#FF9400]/20">
              {f.tag}
            </div>
            <div className="absolute bottom-3 left-3 right-3 text-white">
              <div className="text-sm font-semibold drop-shadow leading-tight">{f.caption}</div>
            </div>
          </button>
        ))}
      </div>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={idx}
        slides={FRAMES.map((f) => ({ src: f.src, alt: f.caption, description: f.caption }))}
      />
    </div>
  );
}
