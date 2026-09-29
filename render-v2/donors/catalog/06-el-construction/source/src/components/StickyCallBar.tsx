import { Phone, FileText } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/track";

export function StickyCallBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md shadow-elegant lg:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <a
          href={`tel:${site.phoneTel}`}
          onClick={() => trackPhoneClick("sticky-bar")}
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-gradient-gold px-2 py-3 text-xs font-bold text-gold-foreground shadow-glow sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Phone className="h-4 w-4 shrink-0" /> <span className="truncate">Call {site.phone}</span>
        </a>
        <Link
          to="/contact"
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-border bg-card px-2 py-3 text-xs font-semibold sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <FileText className="h-4 w-4 shrink-0" /> <span className="sm:hidden">Quote</span><span className="hidden sm:inline">Get Quote</span>
        </Link>
      </div>
    </div>
  );
}
