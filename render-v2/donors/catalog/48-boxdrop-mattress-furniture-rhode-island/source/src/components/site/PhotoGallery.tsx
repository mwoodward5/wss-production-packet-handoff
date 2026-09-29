import { useState } from "react";
import { X } from "lucide-react";
import { gallery as happyCustomers } from "@/wss/bridge";

export function PhotoGallery() {
  const [active, setActive] = useState<number | null>(null);
  if(!happyCustomers.length)return null;
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {happyCustomers.map((p, i) => (
          <li key={p.src}>
            <button
              type="button"
              onClick={() => setActive(i)}
              className="frame-photo group block aspect-[4/5] w-full overflow-hidden bg-muted"
              aria-label={`Open photo: ${p.alt}`}
            >
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
              />
            </button>
          </li>
        ))}
      </ul>

      {active !== null && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-deep/80 backdrop-blur-sm p-4"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            onClick={() => setActive(null)}
            className="absolute top-4 right-4 rounded-full bg-background p-2 text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={happyCustomers[active].src}
            alt={happyCustomers[active].alt}
            className="max-h-[85vh] max-w-[92vw] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
