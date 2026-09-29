import { Phone } from "lucide-react";
import { CLIENT, FEATURES } from "@/config";

export function MobileCallBar() {
  if (!FEATURES.mobileCallBar) return null;
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-md">
      <a
        href={`tel:${CLIENT.phoneE164}`}
        className="flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-primary-foreground bg-primary"
      >
        <Phone className="w-4 h-4" /> Call {CLIENT.phone}
      </a>
    </div>
  );
}
