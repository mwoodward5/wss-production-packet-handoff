import { useClient } from "@/wss/bridge";
import { Phone, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

export function StickyMobileCTA() {
  const {client, plan} = useClient();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="bg-background/95 backdrop-blur border-t border-border shadow-deep px-3 py-2.5 flex gap-2">
        <a
          href={client.identity.phoneTel}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-3 rounded-md text-sm uppercase tracking-wide"
        >
          <Phone className="h-4 w-4" /> Call
        </a>
        <a
          href="/#contact"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-amber text-accent-foreground font-bold px-4 py-3 rounded-md text-sm uppercase tracking-wide"
        >
          Request Quote <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}