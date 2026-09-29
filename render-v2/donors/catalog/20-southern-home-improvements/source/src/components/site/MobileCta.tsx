import { useSite } from "@/lib/wss";
import { useEffect, useState } from "react";
import { ArrowRight, Phone } from "lucide-react";

export function MobileCta() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className={`fixed inset-x-3 bottom-3 z-40 lg:hidden transition-all duration-300 ${
        show ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-2 rounded-full border border-ink/15 bg-cream/95 p-1.5 shadow-warm backdrop-blur">
        <a
          href={emailHref ? "/#planner" : client.identity.phoneTel}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-cream"
        >
          Plan my project <ArrowRight className="h-3.5 w-3.5" />
        </a>
        <a
          href={client.identity.phoneTel}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-clay px-4 py-2.5 text-sm font-semibold text-cream"
          aria-label="Call"
        >
          <Phone className="h-3.5 w-3.5" strokeWidth={2.5} /> Call
        </a>
      </div>
    </div>
  );
}
