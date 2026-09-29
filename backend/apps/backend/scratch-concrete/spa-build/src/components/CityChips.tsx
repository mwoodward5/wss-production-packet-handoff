import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { useLiveAreas, slugify } from "@/lib/wssc";

/**
 * Areas content slot — chips render the VERIFIED service areas from the
 * window.__WSS_CONTENT__ island; the template default is the market city
 * alone. Chips anchor into the service-area page (no per-city donor URLs
 * exist in this donor — a city slug is donor geography no content pass can
 * scrub out of a file path).
 */
export function CityChips() {
  const areas = useLiveAreas();
  return (
    <div className="flex flex-wrap gap-2">
      {areas.map((name) => (
        <Link
          key={name}
          to="/service-area"
          hash={slugify(name)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-gold hover:text-foreground"
        >
          <MapPin className="h-3 w-3 text-gold" />
          {name}
        </Link>
      ))}
    </div>
  );
}
