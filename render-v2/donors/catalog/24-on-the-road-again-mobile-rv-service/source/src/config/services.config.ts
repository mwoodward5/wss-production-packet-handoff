export interface ServiceFAQ { q: string; a: string }

export interface Service {
  slug: string;
  name: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  shortDesc: string;
  longDescMd: string;
  icon: string;
  imageSlot: string;
  gallerySlots: string[];
  faqs: ServiceFAQ[];
  schemaType?: string;
  priceRange?: string;
  durationEstimate?: string;
}

export const SERVICES: Service[] = [
  {
    slug: "rv-repair",
    name: "RV Repair",
    h1: "Mobile RV repair in Middle Tennessee",
    metaTitle: "RV Repair",
    metaDescription: "Diagnosis and repair for common RV house-system problems.",
    shortDesc:
      "Diagnosis and repair for common RV house-system problems that can be handled in a mobile service setting.",
    longDescMd: "",
    icon: "Wrench",
    imageSlot: "service-1",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "rv-maintenance",
    name: "RV Maintenance",
    h1: "Routine RV maintenance at your location",
    metaTitle: "RV Maintenance",
    metaDescription: "Preventive maintenance for safer, more dependable RV trips.",
    shortDesc:
      "Preventive maintenance for RV owners who want safer, cleaner, more dependable trips.",
    longDescMd: "",
    icon: "Settings",
    imageSlot: "service-2",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "rv-winterization",
    name: "RV Winterization",
    h1: "RV winterization for Middle Tennessee weather",
    metaTitle: "RV Winterization",
    metaDescription: "Seasonal prep that protects plumbing and systems before cold weather.",
    shortDesc:
      "Seasonal preparation that protects plumbing and systems before cold weather.",
    longDescMd: "",
    icon: "Snowflake",
    imageSlot: "service-3",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "rv-inspections",
    name: "RV Inspections",
    h1: "RV inspections",
    metaTitle: "RV Inspections",
    metaDescription: "Pre-trip, yearly, and pre-purchase RV inspection support.",
    shortDesc:
      "Pre-trip, yearly, and pre-purchase inspection support for RV owners and buyers.",
    longDescMd: "",
    icon: "ClipboardCheck",
    imageSlot: "service-4",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "rv-system-checks",
    name: "RV System Checks",
    h1: "RV system checks",
    metaTitle: "RV System Checks",
    metaDescription: "Documented checks across electrical, plumbing, propane, roof, and appliances.",
    shortDesc:
      "Documented system checks across electrical, plumbing, propane, roof, slides, and appliances.",
    longDescMd: "",
    icon: "ShieldCheck",
    imageSlot: "service-4b",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "new-camper-orientation",
    name: "New Camper Orientation & Walk-Throughs",
    h1: "New camper orientation and walk-throughs",
    metaTitle: "New Camper Walk-Throughs",
    metaDescription: "Practical education for new owners before they travel.",
    shortDesc:
      "Practical education for new owners who want to understand their camper before they travel.",
    longDescMd: "",
    icon: "BookOpen",
    imageSlot: "service-5",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
  {
    slug: "spring-good-start",
    name: "Spring Good-Start & Systems Check",
    h1: "Spring RV good-start service and systems check",
    metaTitle: "Spring Good-Start",
    metaDescription: "Seasonal RV readiness check before the travel season.",
    shortDesc:
      "A seasonal RV readiness check before the busy travel season begins.",
    longDescMd: "",
    icon: "Sun",
    imageSlot: "service-6",
    gallerySlots: [],
    faqs: [],
    schemaType: "Service",
  },
];

export function getService(slug: string): Service | undefined {
  return SERVICES.find((s) => s.slug === slug);
}

/**
 * Exact client-requested specialty services. Wording must remain verbatim —
 * especially "RV Refrigerator Service (Absorption or 12V DC only)".
 */
export interface SpecialtyService {
  name: string;
  icon: string;
  blurb: string;
}

export const SPECIALTY_SERVICES: SpecialtyService[] = [
  {
    name: "RV Air Conditioner Service",
    icon: "Wind",
    blurb: "Rooftop A/C diagnosis, cleaning, capacitor and component service, and performance checks.",
  },
  {
    name: "RV Furnace Service",
    icon: "Flame",
    blurb: "Furnace ignition, sail switch, blower, and propane-side troubleshooting for warm, safe nights.",
  },
  {
    name: "RV Water Heater Service",
    icon: "Droplets",
    blurb: "Gas and electric water heater service — anode, element, thermostat, ECO, and bypass checks.",
  },
  {
    name: "RV Refrigerator Service (Absorption or 12V DC only)",
    icon: "Refrigerator",
    blurb: "Absorption (gas/electric) and 12V DC compressor fridge diagnosis and service. No residential refrigerators.",
  },
  {
    name: "RV Electrical Service",
    icon: "Zap",
    blurb: "Shore power, converter/inverter, 12V house systems, breakers, outlets, and battery diagnostics.",
  },
  {
    name: "RV Water Service",
    icon: "Wrench",
    blurb: "Fresh and gray plumbing repairs, pumps, fittings, leaks, and fixture replacement.",
  },
];
