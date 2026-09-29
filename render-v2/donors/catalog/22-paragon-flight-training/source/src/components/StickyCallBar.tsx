import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { Phone, MessageSquare, ArrowRight } from "lucide-react";

/**
 * Mobile sticky CTA — three tiles: Call, Text (SMS), Request Info.
 * Premium Web 3.0 button language, large touch targets, ripple on press.
 */
export const StickyCallBar = () => {
  const base =
    "group relative flex items-center justify-center gap-2 overflow-hidden px-3 py-4 font-display text-[12px] font-semibold tracking-wide transition-[color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset";
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-3 gap-px bg-border/80">
        <a
          href={client.identity.phoneTel}
          aria-label={`Call ${client.identity.businessName} at ${client.identity.phoneDisplay}`}
          className={`${base} bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface))_100%)] text-foreground hover:text-primary`}
        >
          <Phone className="h-4 w-4 text-primary transition-transform group-active:scale-95" />
          Call
        </a>
        <a
          href={client.identity.email ? `mailto:${client.identity.email}` : "/#programs"}
          aria-label={client.identity.email ? "Email" : "Programs"}
          className={`${base} bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface))_100%)] text-foreground hover:text-primary`}
        >
          <MessageSquare className="h-4 w-4 text-primary transition-transform group-active:scale-95" />
          {client.identity.email ? "Email" : "Programs"}
        </a>
        <a
          href="/#contact"
          className={`${base} bg-[linear-gradient(180deg,hsl(var(--primary-glow))_0%,hsl(var(--primary))_55%,hsl(var(--horizon))_100%)] text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.3)_inset]`}
        >
          Info
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </a>
      </div>
    </div>
  );
};
