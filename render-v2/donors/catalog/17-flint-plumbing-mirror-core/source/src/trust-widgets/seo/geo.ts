import type { Geo, LocationEntry, TrustConfig } from "../trust.config";

export function distanceKm(a: Geo, b: Geo): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function allLocations(cfg: TrustConfig): LocationEntry[] {
  const list = cfg.location?.locations ?? [];
  const primary = cfg.location?.primary;
  if (primary && !list.some((l) => l.id === primary.id)) return [primary, ...list];
  return list;
}

export function nearestLocation(cfg: TrustConfig, here: Geo): { location: LocationEntry; geo: Geo } | undefined {
  const withGeo = allLocations(cfg).filter((l): l is LocationEntry & { geo: Geo } => Boolean(l.geo));
  if (!withGeo.length) return undefined;
  return withGeo
    .map((l) => ({ location: l, geo: l.geo, d: distanceKm(here, l.geo) }))
    .sort((a, b) => a.d - b.d)[0];
}

export function mapLinks(loc?: LocationEntry) {
  if (!loc) return undefined;
  const q = encodeURIComponent(`${loc.street}, ${loc.city}, ${loc.region} ${loc.postal}`);
  const ll = loc.geo ? `${loc.geo.lat},${loc.geo.lng}` : "";
  return {
    apple: `https://maps.apple.com/?daddr=${q}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    waze: ll ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}`,
    embed: `https://www.google.com/maps?q=${q}&output=embed`,
  };
}

export function telHref(phone?: string) { return phone ? `tel:${phone}` : undefined; }
export function smsHref(phone?: string, body?: string) {
  if (!phone) return undefined;
  return `sms:${phone}${body ? `?&body=${encodeURIComponent(body)}` : ""}`;
}
