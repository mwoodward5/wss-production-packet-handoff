/**
 * Worked example: a plumbing company with real, verifiable data.
 * Copy this file, replace every value with the client's own, delete what they
 * cannot prove. Anything you delete simply stops rendering.
 */
import { defineTrustConfig, blankTrustConfig } from "../trust.config";
import { applyVertical, plumbingPreset } from "../verticals";

const base = defineTrustConfig({
  ...blankTrustConfig,
  business: {
    name: "Northgate Plumbing Co.",
    legalName: "Northgate Plumbing Co. LLC",
    schemaType: "Plumber",
    category: "Emergency Plumbing & Drain Service",
    tagline: "Same-day plumbing, done right the first time.",
    description:
      "Family-owned plumbing company serving the north metro since 2004. Emergency service 24/7, flat-rate pricing, master-licensed technicians.",
    url: "https://northgateplumbing.example",
    logo: "https://northgateplumbing.example/logo.png",
    image: "https://northgateplumbing.example/og.jpg",
    foundingYear: "2004",
    priceRange: "$$",
  },
  contact: {
    phone: "+15125550137",
    phoneDisplay: "(512) 555-0137",
    sms: "+15125550137",
    email: "dispatch@northgateplumbing.example",
    bookingUrl: "https://northgateplumbing.example/schedule",
    quoteUrl: "https://northgateplumbing.example/estimate",
  },
  location: {
    primary: {
      id: "hq",
      label: "Northgate HQ",
      street: "1420 Braker Ln",
      city: "Austin",
      region: "TX",
      postal: "78758",
      country: "US",
      geo: { lat: 30.3846, lng: -97.7075 },
      phone: "+15125550137",
      mapUrl: "https://maps.google.com/?cid=0",
    },
    serviceRadiusKm: 45,
    serviceAreas: ["Austin", "Round Rock", "Pflugerville", "Cedar Park", "Georgetown"],
    timezone: "America/Chicago",
  },
  hours: {
    open24: true,
    weekly: [
      { day: "Monday", open: "07:00", close: "18:00" },
      { day: "Tuesday", open: "07:00", close: "18:00" },
      { day: "Wednesday", open: "07:00", close: "18:00" },
      { day: "Thursday", open: "07:00", close: "18:00" },
      { day: "Friday", open: "07:00", close: "18:00" },
      { day: "Saturday", open: "08:00", close: "14:00" },
      { day: "Sunday" },
    ],
  },
  proof: {
    ratings: [
      { platform: "Google", ratingValue: 4.9, reviewCount: 612, profileUrl: "https://maps.google.com/?cid=0", verifiedAt: "2026-01-04" },
      { platform: "Yelp", ratingValue: 4.5, reviewCount: 188, profileUrl: "https://yelp.com/biz/example" },
    ],
    reviews: [
      { id: "r1", author: "Dana R.", rating: 5, platform: "Google", date: "2025-12-18", serviceTag: "Water heater", location: "Round Rock",
        body: "Water heater died at 6am. Tech was at the house by 8:15 and we had hot water before lunch. Flat price quoted up front, no surprises." },
      { id: "r2", author: "Marcus T.", rating: 5, platform: "Google", date: "2025-11-30", serviceTag: "Drain cleaning", location: "Austin",
        body: "Third plumber we called and the only one who actually camera-scoped the line instead of guessing. Found a root intrusion and fixed it." },
      { id: "r3", author: "Priya S.", rating: 5, platform: "Yelp", date: "2025-11-02", serviceTag: "Repipe", location: "Pflugerville",
        body: "Whole-house repipe finished a day early. They protected the floors, cleaned up every night, and the inspector passed it first try." },
    ],
    stats: [
      { id: "s1", value: 21, label: "Years in business", suffix: "+" },
      { id: "s2", value: 18400, label: "Jobs completed", suffix: "+" },
      { id: "s3", value: 62, label: "Average response", suffix: " min" },
    ],
    credentials: [
      { id: "c1", kind: "license", name: "Texas Master Plumber", issuer: "TSBPE", number: "M-41892", verifyUrl: "https://www.tsbpe.texas.gov/license-search/", expiresAt: "2026-08-31" },
      { id: "c2", kind: "insurance", name: "General Liability $2M", issuer: "Travelers", expiresAt: "2026-06-30" },
      { id: "c3", kind: "bond", name: "Surety Bond $25k", issuer: "Merchants Bonding" },
    ],
    guarantees: [
      { id: "g1", title: "Upfront flat pricing", detail: "You approve the total before any work starts. The price does not move." },
      { id: "g2", title: "2-year workmanship warranty", detail: "If our repair fails within two years we return and fix it at no charge." },
    ],
    badges: [
      { id: "b1", label: "BBB A+ Accredited", url: "https://www.bbb.org/", detail: "Accredited since 2009" },
    ],
    beforeAfter: [
      { id: "ba1", beforeSrc: "/media/before-sewer.jpg", afterSrc: "/media/after-sewer.jpg", alt: "Sewer line replacement", label: "Root-choked sewer line", durationLabel: "1 day", serviceTag: "Sewer" },
    ],
  },
  social: {
    accounts: [
      { platform: "facebook", handle: "northgateplumbing", url: "https://facebook.com/example", followers: 4200 },
    ],
  },
  services: [
    { id: "sv1", name: "Emergency leak repair", priceFrom: 189, currency: "USD", priceUnit: "flat", popular: true, description: "24/7 dispatch, arrival within two hours in the core service area." },
    { id: "sv2", name: "Drain cleaning", priceFrom: 149, currency: "USD", priceUnit: "flat", description: "Cable or hydro-jet, includes camera verification." },
    { id: "sv3", name: "Water heater replacement", priceFrom: 1450, priceTo: 3200, currency: "USD", description: "Tank or tankless, permit and haul-away included." },
  ],
  voice: {
    answers: [
      { id: "v1", question: "Do you offer emergency plumbing near me?", answer: "Yes. Northgate Plumbing dispatches 24 hours a day across Austin, Round Rock, Pflugerville, Cedar Park and Georgetown, with an average on-site arrival of 62 minutes.", updatedAt: "2026-01-04" },
      { id: "v2", question: "How much does drain cleaning cost?", answer: "Drain cleaning starts at $149 flat, which includes a camera inspection to confirm the blockage is cleared before we leave.", updatedAt: "2026-01-04" },
    ],
  },
  availability: {
    slotsLeft: 3,
    nextAvailable: "Today 2:15pm",
    responseTimeMinutes: 62,
    emergency: { available: true, label: "24/7 emergency plumbing", phone: "+15125550137", note: "Live dispatcher, never an answering machine." },
  },
  live: {},
  options: { allowGeolocationPrompt: true, activityToastsEnabled: false },
});

export const plumbingExampleConfig = applyVertical(base, plumbingPreset);
