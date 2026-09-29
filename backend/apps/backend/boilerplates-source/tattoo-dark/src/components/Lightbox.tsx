import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";

export type LightboxItem = {
  title: string;
  style: string;
  placement: string;
  size: string;
  image: string;
  note?: string;
};

export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
  onRequest,
}: {
  items: LightboxItem[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  onRequest: (item: LightboxItem) => void;
}) {
  const open = index !== null;
  const item = open ? items[index!] : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index! + 1) % items.length);
      if (e.key === "ArrowLeft") onIndex((index! - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, index, items.length, onClose, onIndex]);

  return (
    <AnimatePresence>
      {open && item && (
        <motion.div
          key="lb"
          role="dialog"
          aria-modal="true"
          aria-label={`${item.title} — ${item.style}`}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute inset-0 bg-ink/85 backdrop-blur-xl"
          />
          <motion.div
            className="relative z-10 grid md:grid-cols-[1.4fr_1fr] gap-6 max-w-6xl w-full max-h-full"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
          >
            <div className="frame-plate self-center">
              <img
                key={item.image}
                src={item.image}
                alt={item.title}
                className="w-full max-h-[75vh] object-contain bg-ink"
              />
            </div>
            <div className="glass p-6 md:p-8 flex flex-col justify-between self-center">
              <div>
                <div className="section-label">{item.style}</div>
                <h3 className="font-display text-3xl font-bold mb-4">{item.title}</h3>
                <dl className="space-y-3 text-sm mb-6">
                  <div className="flex justify-between border-b border-line/50 pb-2">
                    <dt className="text-fadetext uppercase text-xs tracking-widest">Placement</dt>
                    <dd className="text-bone">{item.placement}</dd>
                  </div>
                  <div className="flex justify-between border-b border-line/50 pb-2">
                    <dt className="text-fadetext uppercase text-xs tracking-widest">Size</dt>
                    <dd className="text-bone">{item.size}</dd>
                  </div>
                </dl>
                {item.note && <p className="text-fadetext text-sm leading-relaxed italic">"{item.note}"</p>}
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => { onRequest(item); onClose(); }}
                  className="flex-1 bg-signal text-ink font-semibold px-5 py-3 rounded-full flex items-center justify-center gap-2 hover:brightness-110 transition emboss text-sm"
                >
                  Request similar <ArrowRight size={16} />
                </button>
              </div>
            </div>

            <button
              onClick={() => onIndex((index! - 1 + items.length) % items.length)}
              aria-label="Previous"
              className="absolute left-2 md:-left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full grid place-items-center bg-surface/80 border border-line text-bone hover:text-signal hover:border-signal transition"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => onIndex((index! + 1) % items.length)}
              aria-label="Next"
              className="absolute right-2 md:-right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full grid place-items-center bg-surface/80 border border-line text-bone hover:text-signal hover:border-signal transition"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute -top-2 right-0 md:-top-4 md:-right-4 w-11 h-11 rounded-full grid place-items-center bg-surface border border-line text-bone hover:text-signal hover:border-signal transition"
            >
              <X size={20} />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
