import { Phone, Calendar } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";

export function StickyMobileCta() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden border-t border-border bg-background/95 backdrop-blur-md">
      <div className="grid grid-cols-2 gap-2 p-3">
        <a
          href={BUSINESS.phoneHref}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background"
        >
          <Phone className="h-4 w-4" /> Call
        </a>
        <Link
          to="/contact"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--ink)]"
        >
          <Calendar className="h-4 w-4" /> Estimate
        </Link>
      </div>
    </div>
  );
}
