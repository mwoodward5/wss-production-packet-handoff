/**
 * Service-area card — replaces map iframe with a branded service-area panel.
 * No iframe: the place URL can be blocked. Uses CID link for external Maps.
 */
import { MapPin, ExternalLink } from "lucide-react";
import { CLIENT } from "@/config";

const CID_URL = "https://maps.google.com/?cid=6920621061722206535";

export function ServiceAreaCard() {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Decorative service-area panel */}
      <div className="relative h-44 md:h-56 bg-gradient-to-br from-secondary via-primary/40 to-primary/70 overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage:
            "radial-gradient(circle at 30% 40%, oklch(0.86 0.06 104 / 0.6) 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, oklch(0.86 0.06 104 / 0.5) 0 2px, transparent 3px)",
          backgroundSize: "80px 80px, 60px 60px",
        }} />
        <svg className="absolute inset-0 w-full h-full opacity-60" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden>
          <path d="M -10 130 C 80 110, 140 70, 220 90 S 360 150, 410 110" fill="none" stroke="oklch(0.95 0.06 104)" strokeWidth="1.2" strokeDasharray="3 5" />
          <circle cx="220" cy="90" r="5" fill="oklch(0.95 0.06 104)" />
        </svg>
        <div className="absolute left-5 bottom-5 text-white">
          <div className="text-[11px] uppercase tracking-widest text-white/80">Service Area</div>
          <div className="font-serif text-xl font-semibold">{CLIENT.serviceAreaLabel}</div>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            We are a scheduled mobile service business — there is no public storefront pin.
            We come to you across the Nashville area and nearby Middle Tennessee communities.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {CLIENT.serviceAreaCities.map((c) => (
            <span key={c.slug} className="px-3 py-1.5 rounded-full text-xs border border-border bg-muted/40 text-foreground">
              {c.name}, {c.region}
            </span>
          ))}
        </div>
        <a
          href={CID_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          View on Google Maps <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

export const GOOGLE_MAPS_CID_URL = CID_URL;
