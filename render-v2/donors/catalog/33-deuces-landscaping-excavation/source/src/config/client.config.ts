/**
 * CLIENT.CONFIG.TS — DEUCES Landscaping & Excavation, LLC
 * Source of truth for business identity.
 */

export type Industry =
  | "generic" | "roofing" | "rv-repair" | "veterinarian" | "electrician"
  | "plumber" | "hvac" | "landscaping" | "auto-detailing" | "dentist"
  | "law-firm" | "restaurant";

export type WeekdayHours = { open: string; close: string } | "closed" | "24h";

export interface ServiceAreaCity {
  slug: string; name: string; county?: string; region: string;
  population?: string; distanceFromHq?: string;
  latitude: number; longitude: number;
  intro: string; neighborhoods: string[]; commonIssues?: string[]; zipCodes: string[];
}

export interface ClientConfig {
  businessName: string; tagline: string; shortDescription: string;
  industry: Industry; schemaType: string;
  phone: string; phoneE164: string; smsE164?: string; email: string;
  street: string; city: string; region: string; postalCode: string; country: string;
  latitude: number; longitude: number;
  hours: Record<"monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday", WeekdayHours>;
  serviceAreaCities: ServiceAreaCity[];
  serviceAreaLabel: string; serviceRadiusMiles: number;
  gbp?: {
    placeId?: string; cid?: string; fid?: string;
    mapsUrl?: string; writeReviewUrl?: string; reviewsUrl?: string;
    mapEmbedUrl?: string; directionsUrl?: string;
  };
}

const GBP_URL = "https://www.google.com/maps/place/DEUCES+Landscaping+%26+Excavation,+LLC/@44.3385975,-85.577725,11z/data=!4m8!3m7!1s0x613107ebb67e1a53:0xd1360054a8968696!8m2!3d44.3385975!4d-85.577725!9m1!1b1!16s%2Fg%2F11y9mdwl0_";

export const CLIENT: ClientConfig = {
  businessName: "DEUCES Landscaping & Excavation, LLC",
  tagline: "Cadillac's Go-To Company For Dirt Work and Machinery Needs",
  shortDescription:
    "Professional excavation, demolition, landscaping and remodeling contractor serving Cadillac and Northern Michigan with precision, accountability, and results that last.",
  industry: "landscaping",
  schemaType: "GeneralContractor",

  phone: "(231) 878-8436",
  phoneE164: "+12318788436",
  smsE164: "+12318788436",
  email: "deucesexcavation@yahoo.com",

  // Service-area only — no street address surfaced publicly.
  street: "",
  city: "Cadillac",
  region: "MI",
  postalCode: "49601",
  country: "US",
  latitude: 44.2520,
  longitude: -85.4012,

  hours: {
    monday: { open: "05:00", close: "22:00" },
    tuesday: { open: "05:00", close: "22:00" },
    wednesday: { open: "05:00", close: "22:00" },
    thursday: { open: "05:00", close: "22:00" },
    friday: { open: "05:00", close: "22:00" },
    saturday: { open: "05:00", close: "22:00" },
    sunday: { open: "05:00", close: "22:00" },
  },

  serviceAreaCities: [
    { slug: "cadillac", name: "Cadillac", region: "MI", latitude: 44.2520, longitude: -85.4012, intro: "Our home base in Wexford County.", neighborhoods: [], zipCodes: ["49601"] },
    { slug: "boon", name: "Boon", region: "MI", latitude: 44.2756, longitude: -85.6111, intro: "", neighborhoods: [], zipCodes: ["49618"] },
    { slug: "harrietta", name: "Harrietta", region: "MI", latitude: 44.3137, longitude: -85.7050, intro: "", neighborhoods: [], zipCodes: ["49638"] },
    { slug: "mesick", name: "Mesick", region: "MI", latitude: 44.4036, longitude: -85.7150, intro: "", neighborhoods: [], zipCodes: ["49668"] },
    { slug: "buckley", name: "Buckley", region: "MI", latitude: 44.4920, longitude: -85.6905, intro: "", neighborhoods: [], zipCodes: ["49620"] },
    { slug: "manton", name: "Manton", region: "MI", latitude: 44.4083, longitude: -85.4022, intro: "", neighborhoods: [], zipCodes: ["49663"] },
    { slug: "lake-city", name: "Lake City", region: "MI", latitude: 44.3358, longitude: -85.2150, intro: "", neighborhoods: [], zipCodes: ["49651"] },
    { slug: "mcbain", name: "McBain", region: "MI", latitude: 44.1947, longitude: -85.2186, intro: "", neighborhoods: [], zipCodes: ["49657"] },
    { slug: "falmouth", name: "Falmouth", region: "MI", latitude: 44.2872, longitude: -85.1130, intro: "", neighborhoods: [], zipCodes: ["49632"] },
    { slug: "marion", name: "Marion", region: "MI", latitude: 44.1031, longitude: -85.1394, intro: "", neighborhoods: [], zipCodes: ["49665"] },
    { slug: "tustin", name: "Tustin", region: "MI", latitude: 44.1086, longitude: -85.4544, intro: "", neighborhoods: [], zipCodes: ["49688"] },
    
  ],
  serviceAreaLabel: "Cadillac, Traverse City & Northern Michigan",
  serviceRadiusMiles: 60,

  gbp: {
    mapsUrl: GBP_URL,
    reviewsUrl: GBP_URL,
    writeReviewUrl: GBP_URL,
    // Service-area embed centered on Cadillac region — no street pin.
    mapEmbedUrl:
      "https://www.google.com/maps?q=Cadillac,+MI&z=9&output=embed",
  },
};

/** Service-area label instead of street address. */
export const FULL_ADDRESS = `${CLIENT.serviceAreaLabel} — based in ${CLIENT.city}, ${CLIENT.region}`;
