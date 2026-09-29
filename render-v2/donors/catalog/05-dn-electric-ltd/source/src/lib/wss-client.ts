export interface ClientService {
  name: string; shortLabel: string; description: string; href: string;
  source: { file?: string } | null;
}
export interface ClientMedia {
  role: 'hero' | 'gallery' | 'people' | 'about' | 'logo';
  path: string; sourceUrl: string; sourceSha256: string; outputSha256: string;
  rank: number | null; width: number | null; height: number | null;
}
export interface ClientData {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string;
    phoneDisplay: string; phoneTel: string; email: string; website: string;
    founded: number | null; logoOnDark: string; logoOnLight: string };
  source: { category: string; prospectId: string; compiledAt: string;
    packetSha256: string; packetVersion: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string;
    support: string; poster: string; video: string };
  services: ClientService[]; media: ClientMedia[];
  content: { serviceIntro: string; about: string; whyHeadline: string;
    ctaHeadline: string; ctaBody: string; values: {title: string; body: string}[];
    faqs: {q: string; a: string}[] };
  trust: { reviews: {author: string; text: string; rating: number | null; sourceUrl: string}[];
    aggregate: {rating: number; count: number; sourceUrl: string} | null;
    hours: unknown; areas: string[]; socials: string[];
    badges: {label: string; sublabel: string; meta: string}[];
    bookingUrl: string; mapUrl: string };
  design: { paletteSource: string; accent: string; fonts: string[] };
}
type Dict = Record<string, unknown>;
function object(value: unknown, label: string): Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('wss_data_object_required:' + label);
  }
  return value as Dict;
}
function text(value: unknown, label: string, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new Error('wss_data_string_required:' + label);
  }
  return value;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error('wss_data_list_invalid:' + label);
  }
  return value;
}
function asset(value: unknown, label: string, optional = false): string {
  const result = text(value, label, !optional);
  if (optional && result === '') return result;
  if (!/^\/(?:assets|client)\/[a-zA-Z0-9._/-]+$/.test(result) || result.includes('..')) {
    throw new Error('wss_data_asset_invalid:' + label);
  }
  return result;
}
function https(value: unknown): boolean {
  try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
export function parseClient(input: unknown): ClientData {
  const data = object(input, 'root');
  if (data.schema !== 'wss-client-site-data-v2') throw new Error('wss_data_schema_invalid');
  const source = object(data.source, 'source');
  if (source.category !== 'electrical') throw new Error('wss_donor_wrong_trade');
  if (!/^[a-f0-9]{64}$/i.test(text(source.packetSha256, 'packetSha256'))) {
    throw new Error('wss_data_source_hash_invalid');
  }
  text(source.prospectId, 'prospectId'); text(source.compiledAt, 'compiledAt');
  text(source.packetVersion, 'packetVersion');
  const identity = object(data.identity, 'identity');
  for (const field of ['businessName', 'city', 'state', 'phoneDisplay']) text(identity[field], field);
  if (!/^tel:\+[1-9][0-9]{6,14}$/.test(text(identity.phoneTel, 'phoneTel'))) {
    throw new Error('wss_data_phone_invalid');
  }
  if (!https(identity.website)) throw new Error('wss_data_website_invalid');
  text(identity.email, 'email', false);
  asset(identity.logoOnDark, 'logoOnDark'); asset(identity.logoOnLight, 'logoOnLight');
  const hero = object(data.hero, 'hero');
  for (const field of ['line1', 'emphasis', 'line3', 'eyebrow', 'support']) text(hero[field], field);
  asset(hero.poster, 'poster'); asset(hero.video, 'video', true);
  const services = list(data.services, 'services', 30);
  if (!services.length) throw new Error('wss_data_services_required');
  const names = new Set<string>();
  for (const item of services) {
    const service = object(item, 'service');
    const name = text(service.name, 'service.name');
    if (names.has(name.toLowerCase())) throw new Error('wss_data_duplicate_service');
    names.add(name.toLowerCase());
    text(service.description, 'service.description'); text(service.shortLabel, 'service.shortLabel');
    const href = text(service.href, 'service.href');
    if (!/^\/[a-z0-9][a-z0-9/-]*$/.test(href) || href.includes('//')) throw new Error('wss_data_service_route_invalid');
  }
  const photos = list(data.media, 'media', 64);
  let heroBound = false;
  for (const value of photos) {
    const photo = object(value, 'media');
    asset(photo.path, 'media.path');
    if (!['hero', 'gallery', 'people', 'about', 'logo'].includes(String(photo.role))) {
      throw new Error('wss_data_media_role_invalid');
    }
    if (!https(photo.sourceUrl) || !/^[a-f0-9]{64}$/i.test(String(photo.sourceSha256)) ||
        !/^[a-f0-9]{64}$/i.test(String(photo.outputSha256))) throw new Error('wss_data_media_proof_invalid');
    if (photo.role === 'hero' && photo.path === hero.poster) heroBound = true;
  }
  if (!heroBound) throw new Error('wss_data_hero_unbound');
  const content = object(data.content, 'content');
  for (const field of ['serviceIntro', 'about']) text(content[field], field);
  for (const item of list(content.faqs, 'faqs', 20)) {
    const faq = object(item, 'faq'); text(faq.q, 'faq.q'); text(faq.a, 'faq.a');
  }
  list(content.values, 'values', 8);
  const trust = object(data.trust, 'trust');
  for (const area of list(trust.areas, 'areas', 100)) text(area, 'area');
  for (const url of list(trust.socials, 'socials', 30)) {
    if (!https(url)) throw new Error('wss_data_social_url_invalid');
  }
  for (const item of list(trust.reviews, 'reviews', 30)) {
    const review = object(item, 'review'); text(review.author, 'review.author');
    text(review.text, 'review.text');
    if (!https(review.sourceUrl)) throw new Error('wss_data_review_source_required');
  }
  if (trust.aggregate !== null) {
    const aggregate = object(trust.aggregate, 'aggregate');
    if (typeof aggregate.rating !== 'number' || !Number.isFinite(aggregate.rating) || aggregate.rating < 0 || aggregate.rating > 5 ||
        !Number.isSafeInteger(aggregate.count) || Number(aggregate.count) < 1 || !https(aggregate.sourceUrl)) {
      throw new Error('wss_data_aggregate_invalid');
    }
  }
  list(trust.badges, 'badges', 30);
  for (const field of ['bookingUrl', 'mapUrl']) {
    const url = text(trust[field], field, false);
    if (url && !https(url)) throw new Error('wss_data_trust_url_invalid');
  }
  object(data.design, 'design');
  return data as unknown as ClientData;
}
export function readClientIsland(doc: Pick<Document, 'getElementById'>): ClientData {
  const element = doc.getElementById('wss-client-data');
  if (!element || element.getAttribute('type') !== 'application/json') {
    throw new Error('wss_client_data_missing');
  }
  const body = element.textContent || '';
  if (!body || body.length > 600000) throw new Error('wss_client_data_size_invalid');
  return parseClient(JSON.parse(body));
}
let current: ClientData | undefined;
export function getClient(): ClientData {
  if (typeof document === 'undefined') throw new Error('wss_browser_client_data_required');
  return current ??= readClientIsland(document);
}
export function getSitePlan(): Record<string, unknown> | null {
  if (typeof document === 'undefined') return null;
  const island = document.getElementById('wss-site-plan');
  if (island && island.getAttribute('type') !== 'application/json') throw new Error('wss_site_plan_type_invalid');
  const body = island?.textContent;
  if (!body) return null;
  if (body.length > 2000000) throw new Error('wss_site_plan_size_invalid');
  const plan = object(JSON.parse(body), 'sitePlan');
  if (plan.schema !== 'wss-rich-site-plan-v1') throw new Error('wss_site_plan_schema_invalid');
  return plan;
}
export function clientPhoto(role: ClientMedia['role'], ordinal = 0): string {
  const client = getClient();
  return client.media.filter(m => m.role === role)[ordinal]?.path || '';
}
