/**
 * JobGallery — real Project photos with shadcn Dialog lightbox.
 * Renders up to `initialCount` (default 12); a "Show all" toggle reveals the rest.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Expand } from "lucide-react";
import { Button } from "@/components/ui/button";

import { bridge } from '@/wss/bridge';
export interface Shot {src:string;alt:string}
export function JobGallery({
  shots = bridge.gallery,
  initialCount = 12,
}: {
  shots?: Shot[];
  initialCount?: number;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? shots : shots.slice(0, initialCount);
  const hidden = shots.length - visible.length;
  return (
    <>
      <div className="flex flex-wrap justify-center gap-4 md:gap-5">
        {visible.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpenIdx(i)}
            style={{ animationDelay: `${Math.min(i, 11) * 70}ms` }}
            className="group relative basis-[calc(50%-0.5rem)] sm:basis-[calc(33.333%-0.75rem)] md:basis-[calc(25%-0.9375rem)] lg:basis-[260px] aspect-[4/3] overflow-hidden rounded-2xl bg-muted shadow-lg shadow-black/10 ring-1 ring-border transition-all duration-500 ease-out hover:-translate-y-1.5 hover:rotate-[0.5deg] hover:shadow-2xl hover:shadow-primary/30 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary animate-fade-in"
          >
            <img
              src={s.src}
              alt={s.alt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="pointer-events-none absolute inset-2 rounded-xl ring-1 ring-white/25 transition-all duration-500 group-hover:inset-3 group-hover:ring-primary/70" />
            <span className="pointer-events-none absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-primary opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:top-3 group-hover:left-3" />
            <span className="pointer-events-none absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-primary opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:top-3 group-hover:right-3" />
            <span className="pointer-events-none absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-primary opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:bottom-3 group-hover:left-3" />
            <span className="pointer-events-none absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-primary opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:bottom-3 group-hover:right-3" />
            <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 group-hover:translate-x-full transition-transform duration-1000 ease-out" />
            <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold tracking-widest uppercase border border-white/10">
              {String(i + 1).padStart(2, "0")} / {String(shots.length).padStart(2, "0")}
            </div>
            <div className="absolute top-3 right-3 p-1.5 rounded-md bg-primary text-primary-foreground shadow-lg opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
              <Expand className="w-3.5 h-3.5" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-3 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
              <div className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase">Project photo</div>
              <div className="text-white text-sm font-semibold leading-tight line-clamp-1">Recent Project</div>
            </div>
          </button>
        ))}
      </div>
      {hidden > 0 && (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => setShowAll(true)}>
            Show all ({shots.length}) photos
          </Button>
        </div>
      )}
      {showAll && shots.length > initialCount && (
        <div className="mt-5 flex justify-center">
          <Button variant="ghost" onClick={() => setShowAll(false)}>
            Show fewer
          </Button>
        </div>
      )}

      <Dialog open={openIdx !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden bg-black border-border animate-scale-in">
          <DialogTitle className="sr-only">Project photo</DialogTitle>
          {openIdx !== null && (
            <img
              src={visible[openIdx].src}
              alt={visible[openIdx].alt}
              className="w-full h-auto max-h-[85vh] object-contain bg-black"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


