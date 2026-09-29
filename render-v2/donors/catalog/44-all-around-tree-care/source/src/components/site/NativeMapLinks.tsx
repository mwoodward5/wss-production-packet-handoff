import { CLIENT, FULL_ADDRESS } from "@/config";
import { DATA, PLAN } from "@/wss/bridge";
import { MapPin } from "lucide-react";
const mapPlan = PLAN?.localPresence?.mapAndDirections as { geo?: {verified?: boolean; schemaAllowed?: boolean; lat?: unknown; lng?: unknown} } | undefined;
const suppliedGeo = mapPlan?.geo;
export const verifiedGeo = suppliedGeo?.verified === true && typeof suppliedGeo.lat === "number" && Number.isFinite(suppliedGeo.lat) && Math.abs(suppliedGeo.lat) <= 90 && typeof suppliedGeo.lng === "number" && Number.isFinite(suppliedGeo.lng) && Math.abs(suppliedGeo.lng) <= 180 ? { ...suppliedGeo, lat: suppliedGeo.lat as number, lng: suppliedGeo.lng as number } : null;
export const mapEmbedUrl = verifiedGeo ? `https://www.google.com/maps?q=${verifiedGeo.lat},${verifiedGeo.lng}&t=k&z=10&output=embed` : "";
const googleUrl = DATA.trust.mapUrl;
const appleUrl = verifiedGeo ? `https://maps.apple.com/?ll=${verifiedGeo.lat},${verifiedGeo.lng}&q=${encodeURIComponent(CLIENT.businessName)}` : "";
export function NativeMapLinks({ className = "" }: { className?: string }) {
  if (!googleUrl && !appleUrl) return null;
  return <div className={`flex flex-wrap gap-2 ${className}`}>
    {appleUrl && <a href={appleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"><MapPin className="w-4 h-4" /> Apple Maps</a>}
    {googleUrl && <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"><MapPin className="w-4 h-4" /> View map</a>}
  </div>;
}
export function SmartAddressLink({ children }: { children?: React.ReactNode }) {
  return googleUrl ? <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">{children ?? FULL_ADDRESS}</a> : <span>{children ?? FULL_ADDRESS}</span>;
}
