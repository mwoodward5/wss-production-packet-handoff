import { Phone, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { BUSINESS } from "@/lib/business";

export const StickyMobileCta = () => (
  <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-accent bg-primary text-primary-foreground shadow-elevated lg:hidden">
    <div className="grid grid-cols-2 divide-x divide-primary-foreground/15">
      <a
        href={`tel:${BUSINESS.phoneTel}`}
        data-event="contact_call_sticky"
        className="inline-flex items-center justify-center gap-2 px-4 py-3.5 font-display text-sm font-bold uppercase tracking-wider"
      >
        <Phone className="h-4 w-4 text-signal" /> Call now
      </a>
      <Link
        to="/contact"
        data-event="contact_quote_sticky"
        className="inline-flex items-center justify-center gap-2 bg-accent px-4 py-3.5 font-display text-sm font-bold uppercase tracking-wider text-accent-foreground"
      >
        <FileText className="h-4 w-4" /> Contact us
      </Link>
    </div>
  </div>
);
