/**
 * Compat shim — kept so legacy imports keep working.
 * All real data now lives in src/config/client.config.ts and src/config/social.config.ts.
 * Prefer importing { CLIENT, SOCIAL } from "@/config" in new code.
 */
import { CLIENT, FULL_ADDRESS } from "@/config/client.config";
import { socialSameAs } from "@/config/social.config";

export const GBP = {
  name: CLIENT.businessName,
  category: CLIENT.schemaType,
  street: CLIENT.street,
  city: CLIENT.city,
  region: CLIENT.region,
  postalCode: CLIENT.postalCode,
  country: CLIENT.country,
  phone: CLIENT.phone,
  phoneE164: CLIENT.phoneE164,
  email: CLIENT.email,
  latitude: CLIENT.latitude,
  longitude: CLIENT.longitude,
  rating: 0,
  reviewCount: 0,
  fid: CLIENT.gbp?.fid ?? "",
  cid: CLIENT.gbp?.cid ?? "",
  mapsUrl: CLIENT.gbp?.mapsUrl ?? "",
  writeReviewUrl: CLIENT.gbp?.writeReviewUrl ?? "",
  reviewsUrl: CLIENT.gbp?.reviewsUrl ?? "",
  mapEmbedUrl: CLIENT.gbp?.mapEmbedUrl ?? "",
  directionsUrl: CLIENT.gbp?.directionsUrl ?? "",
} as const;

export const SOCIAL_PROFILES = socialSameAs();
export const fullAddress = FULL_ADDRESS;
