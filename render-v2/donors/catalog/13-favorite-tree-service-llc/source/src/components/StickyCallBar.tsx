import { Phone, MessageSquare } from "lucide-react";
import { TEL_HREF, SMS_HREF, BUSINESS } from "@/lib/business";

export function StickyCallBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-px border-t border-border bg-surface text-surface-foreground shadow-elegant lg:hidden">
      <a
        href={TEL_HREF}
        className="flex items-center justify-center gap-2 bg-cta-gradient py-3 text-sm font-bold text-accent-foreground"
        aria-label={`Call ${BUSINESS.phoneDisplay}`}
      >
        <Phone className="h-4 w-4" aria-hidden /> Call Now
      </a>
      <a
        href={SMS_HREF}
        className="flex items-center justify-center gap-2 py-3 text-sm font-semibold"
        aria-label="Contact us"
      >
        <MessageSquare className="h-4 w-4" aria-hidden /> Contact
      </a>
    </div>
  );
}
