import { useCallback, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export type LightboxItem = {
  src: string;
  alt: string;
  caption?: string;
};

type Props = {
  items: LightboxItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

export function ImageLightbox({ items, index, onIndexChange, onClose }: Props) {
  const open = index !== null && index >= 0 && index < items.length;

  const goPrev = useCallback(() => {
    if (index === null) return;
    onIndexChange((index - 1 + items.length) % items.length);
  }, [index, items.length, onIndexChange]);

  const goNext = useCallback(() => {
    if (index === null) return;
    onIndexChange((index + 1) % items.length);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  if (!open) return null;
  const item = items[index!];

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--ink)]/90 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-label="Service photo viewer"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 outline-none sm:p-8"
        >
          <DialogPrimitive.Title className="sr-only">{item.alt}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Image {index! + 1} of {items.length}. Use the left and right arrow keys to browse, Escape
            to close.
          </DialogPrimitive.Description>

          <button
            type="button"
            aria-label="Close photo viewer"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 z-0 cursor-default"
          />


          <div
            className="relative z-10 flex max-h-full w-full max-w-5xl flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={item.src}
              alt={item.alt}
              className="max-h-[70vh] w-full rounded-xl object-contain shadow-2xl"
            />
            <figcaption className="mt-4 max-w-2xl text-center text-sm text-[var(--bone)]/80">
              {item.caption ?? item.alt}
              <span className="mt-1 block font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                {index! + 1} / {items.length}
              </span>
            </figcaption>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous photo"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--bone)]/30 text-[var(--bone)] transition-colors hover:bg-[var(--bone)]/10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next photo"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--bone)]/30 text-[var(--bone)] transition-colors hover:bg-[var(--bone)]/10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          <DialogPrimitive.Close
            aria-label="Close photo viewer"
            className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--bone)]/30 text-[var(--bone)] transition-colors hover:bg-[var(--bone)]/10 sm:right-8 sm:top-8"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
