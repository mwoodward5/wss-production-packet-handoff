export interface ClientData {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number | null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: { name: string; shortLabel: string; description: string; href: string }[];
  media: { role: string; path: string; rank: number | null }[];
  content: { serviceIntro: string; about: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; seasonalNote: string; values: {title: string; body: string}[]; faqs: {q: string; a: string}[] };
  trust: { reviews: {author: string; text: string; rating: number | null; sourceUrl: string}[]; aggregate: {rating: number | null; count: number | null; sourceUrl: string} | null; hours: {text?: string} | null; areas: string[]; badges: {label: string; sublabel: string; meta: string}[]; socials: string[]; mapUrl: string; bookingUrl: string };
  design: {accent: string; paletteSource: string; fonts: string[]};
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  services?: {name: string; slug?: string; shortDesc?: string; longDescMd?: string}[];
  content?: {home?: string; services?: string; gallery?: string; about?: string; 'service-area'?: string; contact?: string};
  localPresence?: {mapAndDirections?: {geo?: {lat: number | null; lng: number | null; verified: boolean; schemaAllowed: boolean}}};
  visual?: unknown;
}
