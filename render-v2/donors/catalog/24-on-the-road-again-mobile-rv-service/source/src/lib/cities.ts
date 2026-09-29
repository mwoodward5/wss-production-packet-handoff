/**
 * Cities — re-exported from CLIENT.serviceAreaCities.
 * Edit src/config/client.config.ts to change the city list.
 */
import { CLIENT, type ServiceAreaCity } from "@/config/client.config";

export type City = ServiceAreaCity & {
  /** Back-compat fields. */
  ogImage?: string;
};

export const CITIES: City[] = CLIENT.serviceAreaCities;

export function getCity(slug: string): City | undefined {
  return CITIES.find((c) => c.slug === slug);
}
