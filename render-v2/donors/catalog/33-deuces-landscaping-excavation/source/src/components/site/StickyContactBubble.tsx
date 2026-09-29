/**
 * StickyContactBubble — bottom-right floating call button with owner initials.
 * Hides on small screens (MobileCallBar already covers mobile).
 */
import { Phone } from "lucide-react";
import { CLIENT } from "@/config";

export function StickyContactBubble({ ownerName = CLIENT.businessName }: { ownerName?: string }) {
  const initials = ownerName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <a
      href={`tel:${CLIENT.phoneE164}`}
      aria-label={`Call ${ownerName} — ${CLIENT.phone}`}
      className="hidden md:flex fixed bottom-6 right-6 z-40 items-center gap-3 rounded-full bg-card border border-border shadow-2xl pl-2 pr-5 py-2 hover:shadow-[0_20px_50px_-12px_rgba(244,218,22,0.45)] hover:border-primary/50 transition"
    >
      <span className="relative inline-flex w-12 h-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-base shadow-inner">
        {initials}

      </span>
      <span className="flex flex-col text-left">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground leading-none">Call {ownerName.split(" ")[0]}</span>
        <span className="text-sm font-semibold text-foreground leading-tight mt-0.5 inline-flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5 text-primary" /> {CLIENT.phone}
        </span>
      </span>
    </a>
  );
}
