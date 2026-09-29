import { getClient, getSitePlan } from './wss-client';
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const local = object(getSitePlan()?.localPresence);
const map = object(local.mapAndDirections);
const geo = object(map.geo);
const lat = geo.lat, lng = geo.lng;
export const MAP_URL = getClient().trust.mapUrl;
export const MAP_EMBED = geo.verified === true && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
  && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
  ? `https://maps.google.com/maps?q=${lat},${lng}&z=12&output=embed` : '';
export function pageCopy(key: string): string {
  const value = object(getSitePlan()?.content)[key];
  return typeof value === 'string' ? value : '';
}
