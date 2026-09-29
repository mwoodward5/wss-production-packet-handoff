import { useClient } from "@/lib/wss";
import { Phone } from "lucide-react";

export const StickyMobileCTA = () => { const c=useClient(); return (
  <a href={c.identity.phoneTel}
     className="lg:hidden fixed bottom-4 left-4 right-4 z-40 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-copper text-primary-foreground px-6 py-3.5 text-sm font-semibold shadow-glow">
    <Phone className="w-4 h-4" /> Call {c.identity.phoneDisplay}
  </a>
); };
