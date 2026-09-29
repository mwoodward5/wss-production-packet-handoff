import { CLIENT } from "@/lib/wss";
import { useEffect, useState } from "react";
import { Phone, Hammer } from "lucide-react";

export function MobileCTA() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let ticking = false;
    let lastY = window.scrollY;
    const update = () => { setShow(lastY > 480); ticking = false; };
    const onScroll = () => {
      lastY = window.scrollY;
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`lg:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-500 ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-3 mb-3 rounded-sm border border-border bg-background/95 backdrop-blur-xl shadow-elegant p-2 grid grid-cols-2 gap-2">
        <a
          href={CLIENT.identity.phoneTel}
          className="inline-flex items-center justify-center gap-2 rounded-sm border border-border bg-secondary py-3 text-sm font-bold uppercase tracking-wider min-h-[44px]"
        >
          <Phone className="h-4 w-4" /> Call
        </a>
        <a
          href="/#contact"
          className="inline-flex items-center justify-center gap-2 rounded-sm bg-gradient-warm text-[var(--ink)] py-3 text-sm font-bold uppercase tracking-wider shadow-glow min-h-[44px]"
        >
          <Hammer className="h-4 w-4" /> Estimate
        </a>
      </div>
    </div>
  );
}
