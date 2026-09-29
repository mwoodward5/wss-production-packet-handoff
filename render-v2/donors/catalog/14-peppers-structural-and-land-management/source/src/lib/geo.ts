/**
 * Verified service-area geography for Peppers Structural & Land Management.
 * Coordinates are public lat/lng centroids of each town. Counties are factual.
 * Used by JSON-LD (LocalBusiness/Service ServiceArea) and the /service-area page.
 */
export type ServedCity = {
  name: string;
  county: string;
  state: "OH";
  lat: number;
  lng: number;
  /** Approximate driving radius from Genoa, miles. Used for ServiceArea geoMidpoint context only. */
  approxMilesFromGenoa: number;
};

export const servedCities: ServedCity[] = [
  { name: "Genoa",      county: "Ottawa County",   state: "OH", lat: 41.5169, lng: -83.3597, approxMilesFromGenoa: 0 },
  { name: "Elmore",     county: "Ottawa County",   state: "OH", lat: 41.4742, lng: -83.2952, approxMilesFromGenoa: 6 },
  { name: "Oak Harbor", county: "Ottawa County",   state: "OH", lat: 41.5067, lng: -83.1452, approxMilesFromGenoa: 12 },
  { name: "Curtice",    county: "Lucas County",    state: "OH", lat: 41.6111, lng: -83.3949, approxMilesFromGenoa: 7 },
  { name: "Williston",  county: "Ottawa County",   state: "OH", lat: 41.6275, lng: -83.3702, approxMilesFromGenoa: 8 },
  { name: "Walbridge",  county: "Wood County",     state: "OH", lat: 41.5897, lng: -83.4994, approxMilesFromGenoa: 10 },
  { name: "Millbury",   county: "Wood County",     state: "OH", lat: 41.5658, lng: -83.4255, approxMilesFromGenoa: 5 },
  { name: "Northwood",  county: "Wood County",     state: "OH", lat: 41.6228, lng: -83.4774, approxMilesFromGenoa: 10 },
  { name: "Lindsey",    county: "Sandusky County", state: "OH", lat: 41.4039, lng: -83.2188, approxMilesFromGenoa: 12 },
  { name: "Martin",     county: "Ottawa County",   state: "OH", lat: 41.5572, lng: -83.2544, approxMilesFromGenoa: 7 },
  { name: "Graytown",   county: "Ottawa County",   state: "OH", lat: 41.5300, lng: -83.2030, approxMilesFromGenoa: 9 },
  { name: "Woodville",  county: "Sandusky County", state: "OH", lat: 41.4536, lng: -83.3669, approxMilesFromGenoa: 5 },
];

export const servedCounties = [
  "Ottawa County",
  "Wood County",
  "Sandusky County",
  "Lucas County",
] as const;

/** Service-area radius in meters, for schema.org GeoCircle.geoRadius. */
export const SERVICE_RADIUS_METERS = 40_000; // ~25 miles around Genoa
