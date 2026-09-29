/**
 * Native map links — universal "open in Apple Maps / Google Maps" buttons.
 */
import { CLIENT, FULL_ADDRESS } from "@/config";
import { MapPin } from "lucide-react";

function appleMapsUrl() {
  const q = encodeURIComponent(`${CLIENT.businessName}, ${FULL_ADDRESS}`);
  return `https://maps.apple.com/?q=${q}&ll=${CLIENT.latitude},${CLIENT.longitude}`;
}

function googleMapsUrl() {
  if (CLIENT.gbp?.mapsUrl) return CLIENT.gbp.mapsUrl;
  const q = encodeURIComponent(`${CLIENT.businessName}, ${FULL_ADDRESS}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function NativeMapLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a href={appleMapsUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
        <MapPin className="w-4 h-4" /> Apple Maps
      </a>
      <a href={googleMapsUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
        <MapPin className="w-4 h-4" /> Google Maps
      </a>
    </div>
  );
}

export function SmartAddressLink({ children }: { children?: React.ReactNode }) {
  return (
    <a href={googleMapsUrl()} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
      {children ?? FULL_ADDRESS}
    </a>
  );
}
