import { Phone, FileText } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { trackPhoneClick } from "@/lib/track";
import { useLiveIdentity } from "@/lib/wssc";

/** Sticky mobile bar — the call half collapses whole when no phone exists. */
export function StickyCallBar() {
  const id = useLiveIdentity();
  const digits = id.phoneDigits.replace(/\D/g, "").replace(/^1/, "");

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md shadow-elegant lg:hidden">
      <div className="flex items-center gap-2">
        {id.phone && (
          <a
            href={`tel:${digits ? `+1${digits}` : id.phone}`}
            onClick={() => trackPhoneClick("sticky-bar")}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-gold px-4 py-3 text-sm font-bold text-gold-foreground shadow-glow"
          >
            <Phone className="h-4 w-4" /> Call {id.phone}
          </a>
        )}
        <Link
          to="/contact"
          className={`flex ${id.phone ? "flex-1" : "w-full"} items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold`}
        >
          <FileText className="h-4 w-4" /> Get an Estimate
        </Link>
      </div>
    </div>
  );
}
