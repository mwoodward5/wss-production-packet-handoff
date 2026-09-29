/**
 * SERVICES.CONFIG.TS — DEUCES protected service catalog.
 * All 11 protected exact-match terms appear here verbatim.
 */
export interface ServiceFAQ { q: string; a: string; }

export interface Service {
  slug: string; name: string; h1: string;
  metaTitle: string; metaDescription: string;
  shortDesc: string; longDescMd: string;
  icon: string; imageSlot: string; gallerySlots: string[];
  faqs: ServiceFAQ[]; schemaType?: string;
  priceRange?: string; durationEstimate?: string;
}

export const SERVICES: Service[] = [
  {
    slug: "excavation",
    name: "Excavation",
    h1: "Excavation in Cadillac & Northern Michigan",
    metaTitle: "Excavation Contractor in Cadillac, MI | DEUCES",
    metaDescription: "Professional excavation in Cadillac and Northern Michigan — site prep, grading, footings, utilities and earthmoving. A+ BBB accredited.",
    shortDesc: "Site prep, grading, footings, utilities — earthmoving handled by a careful operator.",
    longDescMd: "Excavation that's done right the first time.",
    icon: "Mountain",
    imageSlot: "service-excavation",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "landscaping",
    name: "Landscaping",
    h1: "Landscaping in Cadillac & Northern Michigan",
    metaTitle: "Landscaping in Cadillac, MI | DEUCES Landscaping & Excavation",
    metaDescription: "Residential landscaping in Cadillac and Northern Michigan — grading, lawn install, planting beds, edging and finish work.",
    shortDesc: "Grading, lawn install, planting beds, edging — finish work that ages well.",
    longDescMd: "Landscaping built on properly prepared ground.",
    icon: "Trees",
    imageSlot: "service-landscaping",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "hardscaping",
    name: "Hardscaping",
    h1: "Hardscaping in Cadillac & Northern Michigan",
    metaTitle: "Hardscaping in Cadillac, MI | DEUCES",
    metaDescription: "Patios, walkways, retaining walls and stone features — engineered for Northern Michigan freeze-thaw cycles.",
    shortDesc: "Patios, walkways, retaining walls — built on the right base for our winters.",
    longDescMd: "",
    icon: "Square",
    imageSlot: "service-hardscaping",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "land-clearing",
    name: "Land Clearing",
    h1: "Land Clearing in Cadillac & Northern Michigan",
    metaTitle: "Land Clearing in Cadillac, MI | DEUCES",
    metaDescription: "Brush, tree and stump removal, lot clearing and site prep for new builds across Wexford and Grand Traverse Counties.",
    shortDesc: "Brush, trees, stumps and lot prep cleared cleanly for what's next.",
    longDescMd: "",
    icon: "Axe",
    imageSlot: "service-land-clearing",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "driveway-installation",
    name: "Driveway Installation",
    h1: "Driveway Installation in Cadillac & Northern Michigan",
    metaTitle: "Driveway Installation in Cadillac, MI | DEUCES",
    metaDescription: "New gravel driveways, culverts, drainage and grading — built to drain and survive Northern Michigan winters.",
    shortDesc: "New gravel driveways, culverts and grading — built to drain.",
    longDescMd: "",
    icon: "Route",
    imageSlot: "service-driveway-installation",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "basement-digging",
    name: "Basement Digging",
    h1: "Basement Digging in Cadillac & Northern Michigan",
    metaTitle: "Basement Digging in Cadillac, MI | DEUCES",
    metaDescription: "Precise basement excavation for new builds and additions — square holes, clean spoils, proper backfill.",
    shortDesc: "Precise basement excavation for new builds and additions.",
    longDescMd: "",
    icon: "Square",
    imageSlot: "service-basement-digging",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "pond-digging",
    name: "Pond Digging",
    h1: "Pond Digging in Cadillac & Northern Michigan",
    metaTitle: "Pond Digging in Cadillac, MI | DEUCES",
    metaDescription: "Residential ponds shaped to hold water and look natural on your property — sized, sloped and finished properly.",
    shortDesc: "Residential ponds shaped to hold water and look natural on your land.",
    longDescMd: "",
    icon: "Waves",
    imageSlot: "service-pond-digging",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "septic-system-installation",
    name: "Septic System Installation",
    h1: "Septic System Installation in Cadillac & Northern Michigan",
    metaTitle: "Septic System Installation in Cadillac, MI | DEUCES",
    metaDescription: "Septic system installation for residential properties — tank, field and final grade handled in coordination with permits.",
    shortDesc: "Tank, field and final grade handled in coordination with permits.",
    longDescMd: "",
    icon: "Pipette",
    imageSlot: "service-septic-system-installation",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "demolition-contractor",
    name: "Demolition Contractor",
    h1: "Demolition Contractor in Cadillac & Northern Michigan",
    metaTitle: "Demolition Contractor in Cadillac, MI | DEUCES",
    metaDescription: "Residential demolition — barns, garages, outbuildings, slabs and foundations dropped cleanly with full debris haul-off.",
    shortDesc: "Barns, garages, slabs and foundations dropped cleanly with full haul-off.",
    longDescMd: "",
    icon: "Hammer",
    imageSlot: "service-demolition-contractor",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "storm-cleanup",
    name: "Storm Cleanup",
    h1: "Storm Cleanup in Cadillac & Northern Michigan",
    metaTitle: "Storm Cleanup in Cadillac, MI | DEUCES",
    metaDescription: "Northern Michigan storm cleanup — downed trees, debris hauling, lot recovery and regrading after major weather.",
    shortDesc: "Downed trees, debris, lot recovery and regrading after major weather.",
    longDescMd: "",
    icon: "CloudLightning",
    imageSlot: "service-storm-cleanup",
    gallerySlots: [],
    faqs: [],
  },
  {
    slug: "remodeling",
    name: "Remodeling",
    h1: "Remodeling in Cadillac & Northern Michigan",
    metaTitle: "Remodeling Contractor in Cadillac, MI | DEUCES",
    metaDescription: "Residential remodeling — additions, interior renovations and exterior projects from a careful, accountable crew.",
    shortDesc: "Additions and renovations from a careful, accountable crew.",
    longDescMd: "",
    icon: "Hammer",
    imageSlot: "service-remodeling",
    gallerySlots: [],
    faqs: [],
  },
];

export function getService(slug: string): Service | undefined {
  return SERVICES.find((s) => s.slug === slug);
}

/** Protected exact-match service terms — used by the lead-form dropdown. */
export const PROTECTED_SERVICE_TERMS = [
  "excavation",
  "landscaping",
  "hardscaping",
  "land clearing",
  "driveway installation",
  "basement digging",
  "pond digging",
  "septic system installation",
  "demolition contractor",
  "storm cleanup",
  "remodeling",
] as const;
