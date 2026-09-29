/**
 * Generate long-form, unique SeoPage entries for the missing furniture-store-{city}
 * variants plus the /service-area hub, sourcing copy from src/content/cities.ts.
 *
 * Why a generator instead of more hand-written JSON: the data layer guarantees
 * neighborhoods, landmarks, drive times, and FAQs are city-specific. The shared
 * shared boilerplate (financing, hours, warranty) is tiny relative to the
 * unique local depth, keeping each page well above 600 words.
 */
import type { City } from "./cities";
import { cities, citiesBySlug } from "./cities";

const TODAY = new Date().toISOString().slice(0, 10);

type Page = {
  slug: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  eyebrow: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  type:
    | "home"
    | "category"
    | "location"
    | "guide"
    | "financing"
    | "delivery"
    | "near_me"
    | "about"
    | "faq"
    | "contact";
  schemaType: string;
  sections: { heading: string; body: string[] }[];
  faqs: { question: string; answer: string }[];
  relatedSlugs: string[];
  cta: { primary: string; secondary: string; tracking: string };
  lastmod: string;
};

const baseFaqs = (cityName: string, state: string): { question: string; answer: string }[] => [
  {
    question: `Are the mattresses and furniture you sell to ${cityName}, ${state} brand new?`,
    answer:
      "Yes — every mattress and furniture piece is brand new, almost always still in factory plastic, and covered by the full manufacturer warranty. We are not a used, returns, or refurbished store.",
  },
  {
    question: `Do you offer financing for ${cityName} shoppers?`,
    answer:
      "Yes. $40 down with 0% interest for 90 days through Synchrony (subject to credit approval), plus no-credit-needed lease-to-own options on most items. Call (401) 365-7993 and we'll explain what fits your situation.",
  },
  {
    question: `What are your hours?`,
    answer:
      "Wednesday through Friday: 2 PM to 6 PM. Saturday and Sunday: 11 AM to 4 PM. Closed Monday and Tuesday. Call or text first around major holidays.",
  },
];

function cityHero(city: City, kind: "mattress" | "furniture"): string {
  const angle = kind === "mattress" ? city.mattressAngle : city.furnitureAngle;
  return `BoxDrop Rhode Island is the closest clearance ${
    kind === "mattress" ? "mattress" : "furniture"
  } showroom for ${city.name}, ${city.state} shoppers — about ${city.driveMinutes} ${
    city.driveMinutes === 1 ? "minute" : "minutes"
  } from ${city.name} via ${city.primaryRoute}. ${angle}`;
}

function neighborhoodParagraph(city: City): string {
  return `We regularly help shoppers from ${city.neighborhoods
    .slice(0, -1)
    .join(", ")}, and ${city.neighborhoods.slice(-1)[0]}. ${city.vibe}`;
}

function landmarksParagraph(city: City): string {
  return `If you know ${city.landmarks.slice(0, -1).join(", ")}, or ${
    city.landmarks.slice(-1)[0]
  }, we are an easy trip — ${city.directionsHint}`;
}

function buildMattressCityPage(city: City): Page {
  const path = `/mattress-store-${city.slug}`;
  const title = `Mattress Store Near ${city.name}, ${city.state} – BoxDrop Warren`;
  const description = `Brand-new mattresses at clearance prices ${city.driveMinutes} minutes from ${city.name}, ${city.state}. Queen, king, hybrid, memory foam, adjustable bases. Call (401) 365-7993.`;

  return {
    slug: `mattress-store-${city.slug}-deep`,
    path,
    title,
    description,
    h1: `Mattress Store Near ${city.name}, ${city.state}`,
    eyebrow: `Mattresses for ${city.name}`,
    primaryKeyword: `mattress store ${city.name} ${city.state}`,
    secondaryKeywords: [
      `discount mattresses ${city.name} ${city.state}`,
      `queen mattress ${city.name}`,
      `king mattress ${city.name}`,
      `mattress delivery ${city.name}`,
    ],
    type: "location",
    schemaType: "LocalBusiness",
    sections: [
      {
        heading: `Mattresses for ${city.name}, ${city.state} — sold the way they should be`,
        body: [
          cityHero(city, "mattress"),
          neighborhoodParagraph(city),
        ],
      },
      {
        heading: `Getting to us from ${city.name}`,
        body: [
          landmarksParagraph(city),
          `From most of ${city.name}, plan on roughly ${city.driveMinutes} ${city.driveMinutes === 1 ? "minute" : "minutes"} via ${city.primaryRoute}. Call or text (401) 365-7993 before you leave and we'll let you know exactly what's on the floor in the size and comfort level you want.`,
        ],
      },
      {
        heading: `What ${city.name} shoppers typically buy`,
        body: [
          `Queen mattresses are the most-requested size from ${city.name} households, followed by king and California king for primary bedrooms. We carry hybrid (innerspring + foam), all-foam memory foam, pillow-top, plush, medium, and firm comfort levels — plus adjustable bases that turn any queen or king into a head-up, foot-up bed.`,
          `Brand-wise we stock Beautyrest, Serta, Simmons, Nectar, Corsicana, Sapphire Sleep, Royal Heritage, Sleep2Win, Solstice, and more. Same names you'd see at the chain stores, brand-new in factory plastic, at outlet pricing.`,
        ],
      },
      {
        heading: `Delivery and pickup back to ${city.name}`,
        body: [
          `${city.name} is well inside our flat local-delivery zone. Most ${city.name} orders ship within the same week — sometimes same-day if you call early. We can also haul away your old mattress and set up the new one in the room of your choice if you ask when you book.`,
          `Prefer same-day pickup? A pickup truck or an SUV with the seats folded down handles a queen mattress comfortably. Twin and full mattresses fit in most sedans with a friend and a roof rack or open tailgate.`,
        ],
      },
      {
        heading: `Why ${city.name} keeps coming back`,
        body: [
          `We are not a national chain. We don't pay commissioned salespeople, we don't run TV ads, and we don't carry the overhead of a big-store footprint. That savings stays on the price tag.`,
          `The result for ${city.name}, ${city.state}: brand-new mattresses from the names you already trust, at outlet pricing, with a real human on the phone every time you call. Try us once and you'll understand why almost all of our growth comes from word-of-mouth across the East Bay and South Coast.`,
        ],
      },
    ],
    faqs: [
      {
        question: `How long is the drive from ${city.name} to BoxDrop in Warren?`,
        answer: `About ${city.driveMinutes} ${
          city.driveMinutes === 1 ? "minute" : "minutes"
        } via ${city.primaryRoute}. ${city.directionsHint}`,
      },
      ...city.extraFaq,
      ...baseFaqs(city.name, city.state),
    ],
    relatedSlugs: [
      "queen-mattresses-rhode-island",
      "king-mattresses-rhode-island",
      "mattress-and-furniture-financing-rhode-island",
      `furniture-store-${city.slug}-deep`,
      ...city.nearbySlugs.slice(0, 2).map((s) => `mattress-store-${s}-deep`),
      "guides/best-mattress-for-back-pain-rhode-island",
      "guides/same-day-mattress-pickup-rhode-island",
    ],
    cta: {
      primary: "Call or Text Today",
      secondary: "Get Directions",
      tracking: "check_inventory",
    },
    lastmod: TODAY,
  };
}

function buildFurnitureCityPage(city: City): Page {
  const path = `/furniture-store-${city.slug}`;
  const title = `Furniture Store Near ${city.name}, ${city.state} – Sectionals & Recliners`;
  const description = `Sectionals, sofas, loveseats, recliners at outlet pricing ${city.driveMinutes} minutes from ${city.name}, ${city.state}. Local delivery, financing. Call (401) 365-7993.`;

  return {
    slug: `furniture-store-${city.slug}-deep`,
    path,
    title,
    description,
    h1: `Furniture Store Near ${city.name}, ${city.state}`,
    eyebrow: `Furniture for ${city.name}`,
    primaryKeyword: `furniture store ${city.name} ${city.state}`,
    secondaryKeywords: [
      `sectionals ${city.name} ${city.state}`,
      `sofas ${city.name}`,
      `recliners ${city.name}`,
      `living room furniture ${city.name}`,
    ],
    type: "location",
    schemaType: "LocalBusiness",
    sections: [
      {
        heading: `Furniture for ${city.name}, ${city.state} homes — built for real living rooms`,
        body: [
          cityHero(city, "furniture"),
          neighborhoodParagraph(city),
        ],
      },
      {
        heading: `Getting to the showroom from ${city.name}`,
        body: [
          landmarksParagraph(city),
          `Plan on about ${city.driveMinutes} ${city.driveMinutes === 1 ? "minute" : "minutes"} from most of ${city.name}. Free showroom parking out front, no appointment needed during open hours.`,
        ],
      },
      {
        heading: `What's on the floor for ${city.name} shoppers`,
        body: [
          `Sectionals are our most-asked-about category from ${city.name} homes — reversible chaise sectionals for tighter rooms, L-shape and U-shape sectionals for larger family rooms, and modular pieces that adapt as the room changes. We also keep sofas, loveseats, accent chairs, power and manual recliners, recliner pairs, lift chairs, and full living-room sets in stock.`,
          `Brand-wise: Ashley, Albany, Cheers, Parker House, Parker Living, Elements, Steve Silver, Peak Living, Kith, Mega Motion. Same names you'd find at the chain showrooms — at outlet pricing, with no commissioned salespeople nudging you toward the most expensive piece on the floor.`,
        ],
      },
      {
        heading: `Will it fit? — measure twice, deliver once`,
        body: [
          `Older ${city.name} homes can have tight doorways, narrow staircases, and finished basements that swallow a sectional whole if it isn't measured right. Bring your room dimensions (including doorway widths and the worst stair turn) and we'll help you pick a piece that goes in cleanly and looks right once it's there.`,
          `We deliver to ${city.name} regularly and our team confirms access details — stair count, elevator size, door width — during scheduling so delivery day goes smoothly.`,
        ],
      },
      {
        heading: `Financing the room, not just the couch`,
        body: [
          `Most ${city.name} furniture orders are not single pieces — they're a sectional plus a recliner, a sofa-loveseat pair, or a full living-room set. Financing through Synchrony at $40 down / 0% for 90 days makes the whole room affordable without putting it on a high-rate credit card. No-credit-needed lease-to-own options are available too if Synchrony isn't a fit.`,
          `Call (401) 365-7993 and we'll walk you through the math before you decide.`,
        ],
      },
    ],
    faqs: [
      {
        question: `Do you deliver furniture to ${city.name}, ${city.state}?`,
        answer: `Yes. ${city.name} is well inside our flat local-delivery zone. Same-week delivery is typical, sometimes same-day depending on the schedule.`,
      },
      {
        question: `Can you help me measure for a sectional before I order?`,
        answer:
          "Yes — bring room dimensions including doorway widths, stair turns, and ceiling height for any stairs you'll carry around. We routinely talk shoppers out of a sectional that won't fit and into one that will.",
      },
      ...city.extraFaq.slice(0, 1),
      ...baseFaqs(city.name, city.state),
    ],
    relatedSlugs: [
      "sectionals-rhode-island",
      "sofas-rhode-island",
      "recliners-rhode-island",
      "living-room-furniture-rhode-island",
      "mattress-and-furniture-financing-rhode-island",
      `mattress-store-${city.slug}-deep`,
      "guides/best-sectional-for-small-living-room",
    ],
    cta: {
      primary: "Call or Text Today",
      secondary: "Get Directions",
      tracking: "category_cta",
    },
    lastmod: TODAY,
  };
}

function buildServiceAreaHub(): Page {
  const allCityLines = cities
    .map(
      (c) =>
        `${c.name}, ${c.state} — about ${c.driveMinutes} ${
          c.driveMinutes === 1 ? "minute" : "minutes"
        } via ${c.primaryRoute}. Neighborhoods we deliver to include ${c.neighborhoods
          .slice(0, 3)
          .join(", ")}.`
    );

  return {
    slug: "service-area",
    path: "/service-area",
    title: "Service Area – BoxDrop Mattress & Furniture Warren RI",
    description:
      "Cities and neighborhoods we serve across East Bay Rhode Island and South Coast Massachusetts from our Warren showroom — drive times, delivery zones, and local pages.",
    h1: "Service Area – East Bay RI & South Coast MA",
    eyebrow: "Where we deliver",
    primaryKeyword: "mattress and furniture delivery service area Rhode Island",
    secondaryKeywords: [
      "mattress delivery Rhode Island",
      "furniture delivery Rhode Island",
      "BoxDrop service area",
      "East Bay RI mattress",
      "South Coast MA furniture",
    ],
    type: "location",
    schemaType: "LocalBusiness",
    sections: [
      {
        heading: "Where we deliver mattresses and furniture",
        body: [
          "BoxDrop Mattress & Furniture Rhode Island is based at 601 Metacom Ave in Warren, RI. From there, we serve a tight, real-life delivery zone across the East Bay, greater Providence, and the South Coast of Massachusetts — not a vague nationwide map, just the towns we actually drive to every week.",
          "Below is each city we serve, the typical drive time, the route most locals use to get to us, and a few neighborhoods we deliver to regularly. Click through to the local page for that city for more detail and a direct call/text link.",
        ],
      },
      {
        heading: "Cities and drive times",
        body: allCityLines,
      },
      {
        heading: "How local delivery works",
        body: [
          "Local delivery is a flat fee throughout our service area. We confirm stair count, doorway width, elevator access, and any pet/parking notes during scheduling so the truck doesn't show up to a surprise. Most orders deliver within the same week — sometimes same-day if you call before noon.",
          "Old-mattress haul-away and in-room setup are available; just ask when you book. We can also hold a piece in the showroom for up to a few days if you want to pick it up yourself.",
        ],
      },
      {
        heading: "What you're really buying",
        body: [
          "Every mattress and furniture piece we deliver is brand-new, almost always still in factory plastic, and covered by the full manufacturer warranty. The reason it's at clearance pricing isn't because there's anything wrong with it — it's because we run a tight local showroom with no commissioned salespeople and no big-store overhead.",
          "If you're not sure whether your town is inside our delivery zone, just call (401) 365-7993 — we'll tell you in 30 seconds.",
        ],
      },
    ],
    faqs: [
      {
        question: "How far do you deliver?",
        answer:
          "Our regular flat-fee zone covers Warren, Bristol, Barrington, Tiverton, East Providence, Providence, Warwick, Fall River, Swansea, Seekonk, and Somerset. We can sometimes accommodate stops just outside that zone for a small additional fee — call to confirm.",
      },
      {
        question: "Do you charge for delivery?",
        answer:
          "Yes, a flat local fee. It's quoted up front before you commit. Same-day pickup at our Warren showroom is always an option if you'd rather skip the fee and have a vehicle that can handle the load.",
      },
      {
        question: "Can you haul away my old mattress?",
        answer:
          "Yes. Old-mattress haul-away is an optional add-on at delivery. Mention it when you book so the delivery team plans for it.",
      },
      {
        question: "How quickly can you deliver?",
        answer:
          "Most local deliveries happen within the same week. Same-day or next-day is often possible if you call before noon and we have stock.",
      },
    ],
    relatedSlugs: [
      "mattress-store-rhode-island",
      "furniture-store-rhode-island",
      "mattress-delivery-rhode-island",
      "mattress-store-near-me-rhode-island",
      ...cities.slice(0, 6).map((c) => `mattress-store-${c.slug}-deep`),
    ],
    cta: {
      primary: "Call or Text Today",
      secondary: "Get Directions",
      tracking: "check_inventory",
    },
    lastmod: TODAY,
  };
}

// Cities that already have mattress AND furniture pages baked into seoPages.ts —
// we skip rebuilding those to avoid duplicate paths. Everything else gets a
// long-form "deep" page generated here that overwrites the older shallow version.
const SKIP_MATTRESS = new Set<string>([]); // build deeper variants for ALL cities
const SKIP_FURNITURE = new Set<string>([]);

export function buildGeneratedPages(): Page[] {
  const out: Page[] = [];
  for (const c of cities) {
    if (!SKIP_MATTRESS.has(c.slug)) out.push(buildMattressCityPage(c));
    if (!SKIP_FURNITURE.has(c.slug)) out.push(buildFurnitureCityPage(c));
  }
  out.push(buildServiceAreaHub());
  return out;
}

export { citiesBySlug };
