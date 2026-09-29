import { normalize } from '../../WSS-CONTRACTS/contracts/client-site-data.cjs';
import type { TrustConfig } from './trust-widgets/trust.config';
import { blankTrustConfig } from './trust-widgets/trust.config';

export interface ClientData {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number | null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: { name: string; shortLabel: string; description: string; href: string }[];
  media: { role: string; path: string; rank: number | null; width: number | null; height: number | null; sourceUrl: string }[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: { title: string; body: string }[]; faqs: { q: string; a: string }[] };
  trust: { reviews: { author: string; text: string; rating: number | null; sourceUrl: string }[]; aggregate: { rating: number | null; count: number | null; sourceUrl: string } | null; hours: unknown; areas: string[]; socials: string[]; badges: { label: string; sublabel: string; meta: string }[]; stats: unknown[]; bookingUrl: string; mapUrl: string };
  design: { accent: string; paletteSource: string; fonts: string[] };
  source: { prospectId: string; compiledAt: string; packetSha256: string; packetVersion: string };
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  pages?: { slug?: string; title?: string; [key: string]: unknown }[];
  services?: { name: string; slug?: string; shortDesc?: string; longDescMd?: string }[];
  content?: Record<string, string>;
  localPresence?: { mapAndDirections?: { googleBusinessUrl?: string; googlePlaceId?: string; geo?: { lat: number | null; lng: number | null; verified?: boolean; schemaAllowed?: boolean } } };
  visual?: Record<string, unknown>;
  seoAssets?: { entity?: Record<string, unknown>; localBusiness?: Record<string, unknown> };
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Match existing certified services only; a rich plan cannot add a trade or route.
function richService(service: ClientData['services'][number], plan?: SitePlan) {
  return plan?.services?.find(item => item.name.trim().toLowerCase() === service.name.toLowerCase()
    && (!item.slug || `/${item.slug.replace(/^\/+|\/+$/g, '')}` === service.href));
}

export function bindClient(input: unknown, planInput?: unknown) {
  const data = normalize(input) as ClientData;
  const plan = planInput as SitePlan | undefined;
  if (planInput != null && (!objectRecord(planInput) || plan?.schema !== 'wss-rich-site-plan-v1')) throw new Error('site_plan_schema_invalid');
  if (plan?.pages && (!Array.isArray(plan.pages) || plan.pages.some(p => !p || typeof p !== 'object' || (p.slug != null && typeof p.slug !== 'string') || (p.title != null && typeof p.title !== 'string')))) throw new Error('site_plan_pages_invalid');
  if (plan?.content && (!objectRecord(plan.content) || Object.values(plan.content).some(v => typeof v !== 'string'))) throw new Error('site_plan_content_invalid');
  if (plan?.services && (!Array.isArray(plan.services) || plan.services.some(s => !objectRecord(s) || typeof s.name !== 'string' || !s.name.trim() || (['slug', 'shortDesc', 'longDescMd'] as const).some(k => s[k] != null && typeof s[k] !== 'string')))) throw new Error('site_plan_services_invalid');
  // CSD has no trade field. The certified adapter checks category before CSD.
  const entityType = plan?.seoAssets?.localBusiness?.['@type'];
  const entity = plan?.seoAssets?.localBusiness;
  if (entity != null && (!objectRecord(entity) || entity['@graph'] != null)) throw new Error('site_plan_entity_shape_unsupported');
  const entityTypes = Array.isArray(entityType) ? entityType : entityType == null ? [] : [entityType];
  if (entityTypes.some(type => typeof type !== 'string' || !['Plumber', 'LocalBusiness', 'Organization'].includes(type))) throw new Error('donor_trade_mismatch');
  const entityName = plan?.seoAssets?.localBusiness?.['name'];
  if (entityName != null && (typeof entityName !== 'string' || entityName.trim() !== data.identity.businessName)) throw new Error('site_plan_identity_mismatch');
  const aggregate = data.trust.aggregate;
  const trust: TrustConfig = {
    ...blankTrustConfig,
    business: { name: data.identity.businessName, schemaType: 'Plumber', category: 'Plumbing', url: data.identity.website, logo: data.identity.logoOnDark, image: data.hero.poster, description: data.hero.support, tagline: data.content.seasonalNote, foundingYear: data.identity.founded == null ? undefined : String(data.identity.founded) },
    contact: { phone: data.identity.phoneTel.slice(4), phoneDisplay: data.identity.phoneDisplay, email: data.identity.email, bookingUrl: data.trust.bookingUrl || undefined },
    location: { serviceAreas: data.trust.areas }, hours: { weekly: [] },
    proof: {
      ratings: aggregate?.rating != null && aggregate.count != null ? [{ platform: 'Reviews', ratingValue: aggregate.rating, reviewCount: aggregate.count, profileUrl: aggregate.sourceUrl }] : [],
      reviews: data.trust.reviews.filter(r => r.rating != null).map((r, i) => ({ id: `review-${i}`, author: r.author, body: r.text, rating: r.rating!, sourceUrl: r.sourceUrl })),
      badges: data.trust.badges.map((b, i) => ({ id: `badge-${i}`, label: b.label, detail: [b.sublabel, b.meta].filter(Boolean).join(' · ') })),
      stats: data.identity.founded == null ? [] : [{ id: 'founded', label: 'Founded', value: data.identity.founded }],
      gallery: data.media.filter(m => m.role === 'gallery').slice(0, 6).map((m, i) => ({ id: `gallery-${i}`, src: m.path, alt: `${data.identity.businessName} — project photo ${i + 1}`, width: m.width ?? undefined, height: m.height ?? undefined })),
    },
    services: data.services.map((s, i) => ({ id: `service-${i}`, name: s.name, description: richService(s, plan)?.shortDesc?.trim() || s.description })),
    voice: { answers: data.content.faqs.map((f, i) => ({ id: `faq-${i}`, question: f.q, answer: f.a })) },
    labels: { ...blankTrustConfig.labels, quoteCta: 'Contact us', credentialsTitle: 'Credentials', serviceMenuTitle: 'Services' },
    widgetProfile: { promoted: [], available: [], suppressed: ['OpenNowStatus'] },
    options: { allowGeolocationPrompt: false, activityToastsEnabled: false },
  };
  return { data, plan, trust };
}

function island(id: string, required: boolean): unknown {
  const text = typeof document === 'undefined' ? null : document.getElementById(id)?.textContent;
  if (!text) { if (required) throw new Error('client_data_missing'); return undefined; }
  return JSON.parse(text);
}
export const bound = bindClient(island('wss-client-data', true), island('wss-site-plan', false));
export const clientData = bound.data;
export const sitePlan = bound.plan;

export function serviceDetail(service: ClientData['services'][number]) {
  return richService(service, sitePlan)?.longDescMd?.trim() || service.description;
}

export function applyBranding(root: HTMLElement) {
  // CSD defines only an explicit accent role. Untyped font arrays are not roles.
  if (clientData.design.accent && /^#[0-9a-f]{6}$/i.test(clientData.design.accent)) {
    root.style.setProperty('--coral', clientData.design.accent);
    root.style.setProperty('--accent', clientData.design.accent);
  }
}
