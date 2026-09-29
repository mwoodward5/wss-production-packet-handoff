import { Phone } from "lucide-react";
import { BUSINESS } from "@/lib/business";

export function StickyCta({contactHref="#contact"}:{contactHref?:string} = {}) {
  return (
    <div className="lg:hidden fixed bottom-3 left-3 right-3 z-40 flex gap-2">
      <a
        href={BUSINESS.phoneHref}
        aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone}`}
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3.5 text-sm font-medium shadow-[var(--shadow-elev)]"
      >
        <Phone className="h-4 w-4" /> Call now
      </a>
      <a
        href={contactHref}
        className="flex-1 inline-flex items-center justify-center rounded-full bg-accent text-accent-foreground px-5 py-3.5 text-sm font-medium shadow-[var(--shadow-elev)]"
      >
        Contact
      </a>
    </div>
  );
}
