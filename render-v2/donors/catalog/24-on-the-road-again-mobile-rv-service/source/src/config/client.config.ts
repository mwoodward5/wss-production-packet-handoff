/**
 * CLIENT.CONFIG.TS — On The Road Again Mobile RV Service
 */

export type Industry =
  | "generic"
  | "roofing"
  | "rv-repair"
  | "veterinarian"
  | "electrician"
  | "plumber"
  | "hvac"
  | "landscaping"
  | "auto-detailing"
  | "dentist"
  | "law-firm"
  | "restaurant";

export type WeekdayHours = { open: string; close: string } | "closed" | "24h";

export interface ServiceAreaCity {
  slug: string;
  name: string;
  region: string;
  county?: string;
  population?: string;
  distanceFromHq?: string;
  latitude: number;
  longitude: number;
  intro: string;
  neighborhoods: string[];
  commonIssues?: string[];
  zipCodes: string[];
}

export interface ClientConfig {
  businessName: string;
  tagline: string;
  shortDescription: string;
  industry: Industry;
  schemaType: string;
  phone: string;
  phoneE164: string;
  smsE164?: string;
  email: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  hours: {
    monday: WeekdayHours;
    tuesday: WeekdayHours;
    wednesday: WeekdayHours;
    thursday: WeekdayHours;
    friday: WeekdayHours;
    saturday: WeekdayHours;
    sunday: WeekdayHours;
  };
  serviceAreaCities: ServiceAreaCity[];
  serviceAreaLabel: string;
  serviceRadiusMiles: number;
  gbp?: {
    placeId?: string;
    cid?: string;
    fid?: string;
    mapsUrl?: string;
    writeReviewUrl?: string;
    reviewsUrl?: string;
    mapEmbedUrl?: string;
    directionsUrl?: string;
  };
}

const CITIES: ServiceAreaCity[] = [
  "Gallatin","Hendersonville","Nashville","Lebanon","Goodlettsville","Hermitage","La Vergne","Joelton","Murfreesboro",
].map((name) => ({
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  region: "TN",
  latitude: 0,
  longitude: 0,
  intro: `Scheduled mobile RV service for RV owners in ${name} and nearby Middle Tennessee communities.`,
  neighborhoods: [],
  zipCodes: [],
}));

export const CLIENT: ClientConfig = {
  businessName: "On The Road Again Mobile RV Service",
  tagline: "Scheduled mobile RV service in Middle Tennessee",
  shortDescription:
    "Scheduled mobile RV service for RV owners in Middle Tennessee and the Nashville area — repair, maintenance, winterization, inspections, system checks, and new camper walk-throughs.",
  industry: "rv-repair",
  schemaType: "AutomotiveBusiness",

  phone: "(615) 606-3882",
  phoneE164: "+16156063882",
  smsE164: "+16156063882",
  email: "service@ontheroadagainmobilerv.com",

  // Private dispatch address — not displayed publicly as a pin.
  street: "Middle Tennessee",
  city: "Hendersonville",
  region: "TN",
  postalCode: "",
  country: "US",
  latitude: 36.3050,
  longitude: -86.6200,

  hours: {
    monday: { open: "08:00", close: "17:00" },
    tuesday: { open: "08:00", close: "17:00" },
    wednesday: { open: "08:00", close: "17:00" },
    thursday: { open: "08:00", close: "17:00" },
    friday: { open: "08:00", close: "17:00" },
    saturday: "closed",
    sunday: "closed",
  },

  serviceAreaCities: CITIES,
  serviceAreaLabel: "Middle Tennessee · Nashville area",
  serviceRadiusMiles: 40,

  gbp: {
    mapsUrl:
      "https://www.google.com/maps/place/On+The+Road+Again+Mobile+RV+Service/data=!4m2!3m1!1s0x0:0x600afc304909f147?sa=X&ved=1t:2428&ictx=111",
  },
};

/** Public service-area label (no street pin). */
export const FULL_ADDRESS = `${CLIENT.serviceAreaLabel}`;
