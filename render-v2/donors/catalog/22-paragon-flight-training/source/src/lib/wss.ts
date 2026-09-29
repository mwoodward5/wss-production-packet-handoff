import contract from './client-contract.cjs';

export interface Service { name: string; shortLabel: string; description: string; href: string; source: Record<string, unknown> | null }
export interface FAQ { q: string; a: string }
export interface Client {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number | null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[];
  media: { role: string; path: string; rank: number | null; sourceSha256: string }[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title: string; body: string}[]; faqs: FAQ[] };
  trust: { reviews: { author: string; text: string; rating: number | null; sourceUrl: string }[]; aggregate: {rating: number | null; count: number | null; sourceUrl: string} | null; hours: {text?: string} | null; areas: string[]; socials: string[]; badges: { label: string; sublabel: string; meta: string }[]; stats: unknown[]; bookingUrl: string; mapUrl: string };
  design: { paletteSource: string; accent: string; fonts: string[] };
  source: { packetSha256: string };
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  packetHash?: string;
  content?: { home?: string; about?: string; 'service-area'?: string; contact?: string };
  services?: { name: string; slug: string; longDescMd?: string; shortDesc?: string }[];
  pages?: { slug: string }[];
  localPresence?: { businessIdentity?: {gbpPlaceId?: string}; mapAndDirections?: {googleBusinessUrl?: string; googlePlaceId?: string; geo?: {lat: number | null; lng: number | null; verified: boolean; schemaAllowed: boolean}} };
  // These objects have no role/slot schema in the copied contract. Do not guess keys.
  visual?: Record<string, unknown>;
  forms?: Record<string, unknown>;
}
export const slug = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
const aviation = /\b(flight (?:training|school|instruction|lessons?|instructor|simulator)|(?:private|commercial|career|airline transport) pilot|pilot (?:training|school|instruction|lessons?|certification)|aviation (?:training|school|instruction)|instrument rating|multi[ -]engine|discovery flight|introductory flight|ground school|aircraft rental)\b/i;
export function parseInputs(data: unknown, plan?: unknown): {client: Client; sitePlan: SitePlan | null} {
  const c = contract.normalize(data) as Client;
  // CSD omits category. Require explicit aviation service evidence; mapping checks category upstream.
  if (!c.services.every(s => aviation.test(s.name))) throw new Error('donor_trade_unproven');
  const names = c.services.map(s => slug(s.name));
  if (names.some(n => !n) || new Set(names).size !== names.length) throw new Error('donor_service_route_collision');
  const hrefs = c.services.map(s => s.href).filter(Boolean);
  if (hrefs.includes('/service-areas') || new Set(hrefs).size !== hrefs.length) throw new Error('donor_service_route_collision');
  const areas = c.trust.areas.map(slug);
  if (areas.some(s => !s) || new Set(areas).size !== areas.length) throw new Error('donor_area_route_collision');
  const p = plan == null ? null : plan as SitePlan;
  if (p && p.schema !== 'wss-rich-site-plan-v1') throw new Error('donor_plan_schema_invalid');
  if (p?.services && (!Array.isArray(p.services) || p.services.some(s => !s || typeof s.name !== 'string' || (s.longDescMd != null && typeof s.longDescMd !== 'string')))) throw new Error('donor_plan_services_invalid');
  if (p?.content && Object.values(p.content).some(s => typeof s !== 'string')) throw new Error('donor_plan_content_invalid');
  // The shared normalizer permits nullable aggregate fields. Incomplete proof
  // must not produce a rating pill; keep the copied contract unchanged.
  const aggregate = c.trust.aggregate;
  const completeAggregate = aggregate?.rating != null && aggregate.count != null;
  return {client: completeAggregate || !aggregate ? c : {...c, trust: {...c.trust, aggregate: null}}, sitePlan: p};
}
export let client: Client;
export let sitePlan: SitePlan | null;
export function initialize(doc: Document) {
  const raw = doc.getElementById('wss-client-data')?.textContent;
  if (!raw) throw new Error('donor_client_data_missing');
  const plan = doc.getElementById('wss-site-plan')?.textContent;
  ({client, sitePlan} = parseInputs(JSON.parse(raw), plan ? JSON.parse(plan) : undefined));
  // Only accent has an explicit role in CSD. Font arrays do not define roles.
  if (!['approved-donor-fallback', 'donor-default'].includes(client.design.paletteSource) && /^#[0-9a-f]{6}$/i.test(client.design.accent)) {
    const hex = client.design.accent;
    const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
    const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min, l = (max+min)/2;
    let h = 0;
    if (delta) h = (max === r ? ((g-b)/delta)%6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4)*60;
    const s = delta ? delta/(1-Math.abs(2*l-1)) : 0;
    const hsl = `${(h+360)%360} ${s*100}% ${l*100}%`;
    doc.documentElement.style.setProperty('--primary',hsl);
    doc.documentElement.style.setProperty('--primary-glow',hsl);
    doc.documentElement.style.setProperty('--horizon',hsl);
    doc.documentElement.style.setProperty('--runway',hsl);
    doc.documentElement.style.setProperty('--runway-glow',hsl);
    doc.documentElement.style.setProperty('--ring',hsl);
    doc.documentElement.style.setProperty('--gradient-runway',`linear-gradient(135deg, hsl(${hsl}), hsl(${hsl}))`);
    doc.documentElement.style.setProperty('--gradient-divider',`linear-gradient(90deg, transparent, hsl(${hsl} / 0.6), transparent)`);
    doc.documentElement.style.setProperty('--shadow-runway',`0 10px 40px -10px hsl(${hsl} / 0.45)`);
    doc.documentElement.style.setProperty('--shadow-glow',`0 0 60px hsl(${hsl} / 0.35)`);
  }
}
// Role/order bindings supported by CSD; equipment/location/ambient lack explicit slot metadata.
export function mediaSlot(id: string): string {
  const role = id === 'pathway-pilot' ? 'people' : id === 'campus-aeronautical' ? 'about' : id === 'discovery-view' ? 'gallery' : '';
  if (id === 'hero-bg') return client.hero.poster;
  if (!role) return '';
  return client.media.filter(m => m.role === role).sort((a,b) => (a.rank ?? 999)-(b.rank ?? 999))[0]?.path || '';
}
export const discoveryService = () => client.services.find(s => /discovery|introductory flight/i.test(s.name));
export const paragraphs = (text?: string) => (text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
export const serviceHref = (s: Service) => `/programs/${slug(s.name)}`;
