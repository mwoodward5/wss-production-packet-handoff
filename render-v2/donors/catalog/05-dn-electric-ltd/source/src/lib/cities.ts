import { getClient } from './wss-client';
export const CITIES = getClient().trust.areas.map((city, i) => ({slug: `area-${i + 1}`, city, state: ''}));
export const VERIFIED_GOOGLE_MAPS_SHARE = getClient().trust.mapUrl;
