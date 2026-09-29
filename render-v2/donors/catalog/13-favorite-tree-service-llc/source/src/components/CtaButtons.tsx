import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowRight } from "lucide-react";
import { TEL_HREF, SMS_HREF, BUSINESS } from "@/lib/business";

export function HeroCtas() {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <a
        href={TEL_HREF}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cta-gradient px-6 py-3.5 text-base font-bold text-accent-foreground shadow-amber transition-smooth hover:scale-[1.02] sm:w-auto animate-pulse-glow"
      >
        <Phone className="h-5 w-5" aria-hidden /> Call {BUSINESS.phoneDisplay}
      </a>
      <Link
        to="/contact"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 text-base font-semibold text-surface-foreground backdrop-blur transition-smooth hover:bg-white/10 sm:w-auto"
      >
        Discuss your project <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
      <a
        href={SMS_HREF}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 text-base font-semibold text-surface-foreground backdrop-blur transition-smooth hover:bg-white/10 sm:w-auto"
      >
        <MessageSquare className="h-5 w-5" aria-hidden /> Contact
      </a>
    </div>
  );
}

export function InlineCtas() {
  return (
    <div className="flex flex-wrap gap-3">
      <a
        href={TEL_HREF}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow transition-smooth hover:bg-primary/90"
      >
        <Phone className="h-4 w-4" /> Call {BUSINESS.phoneDisplay}
      </a>
      <a
        href={SMS_HREF}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-smooth hover:bg-muted"
      >
        <MessageSquare className="h-4 w-4" /> Contact
      </a>
      <Link
        to="/contact"
        className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-5 py-2.5 text-sm font-bold text-accent-foreground shadow-amber transition-smooth hover:opacity-95"
      >
        Request an estimate <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
