export const trustSignals = {
  verifiedFromCurrentSite: [
  "Current site positions the business as a mattress and furniture clearance center.",
  "Current site states savings up to 60% off retail pricing.",
  "Current site states products are brand new and in plastic.",
  "Current site states manufacturer warranties are available.",
  "Current site states delivery services are available.",
  "Current site states financing/payment options are available, including no-credit-needed/90-day same-as-cash language and WAC options. Confirm exact provider terms before final publish."
],
  brands: {
  "mattress": [
    "Beautyrest",
    "Corsicana",
    "Nectar",
    "Parker Living",
    "Royal Heritage",
    "Sapphire Sleep",
    "Serta",
    "Simmons",
    "Sleep2Win",
    "Solstice",
    "South Bay"
  ],
  "furniture": [
    "Albany",
    "Ashley",
    "Cheers",
    "Elements",
    "Kith",
    "Mega Motion",
    "Parker House",
    "Parker Living",
    "Peak Living",
    "Steve Silver"
  ]
},
  socialProfiles: {
  "facebook": "https://www.facebook.com/BoxDropRhodeIsland/",
  "youtube": "https://www.youtube.com/channel/UCgO5yXQ7Djv1WJCOgUqNJMw",
  "yelp": "https://www.yelp.com/biz/boxdrop-mattress-and-furniture-rhode-island-warren-2",
  "googleMaps": "https://maps.google.com/?cid=10475203548171513435",
  "booking": "https://boxdropri.setmore.com/",
  "instagram": null,
  "tiktok": null
},
  warnings: [
  "Inventory changes often. Call or text before visiting if you need a specific size, brand, style, or configuration.",
  "Do not publish specific item prices unless confirmed from current inventory. Use 'discount-style pricing' and 'up to 60% off retail pricing' only where consistent with business source truth.",
  "Financing options may be available. Approval, down payment, same-as-cash terms, and promotional offers depend on provider, applicant, item, and current program details.",
  "Do not create fake reviews, ratings, aggregateRating, reviewCount, awards, or customer quotes. Only use real, attributable review text if manually verified from GBP/Facebook and approved."
]
} as const;

/**
 * Verified review quotes. EMPTY by default — populate ONLY with real, attributed
 * reviews copied from GBP / Yelp / Facebook. Once populated, ReviewQuotes component
 * auto-renders + emits Review JSON-LD.
 */
export type ReviewQuote = {
  author: string;       // first name + last initial (e.g. "Sarah M.")
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;         // full review body, verbatim
  date: string;         // ISO date "2025-03-14"
  source: "Google" | "Yelp" | "Facebook";
};

export const reviewQuotes: ReviewQuote[] = [];
