import contract from './normalize.cjs';
export interface Service { name: string; shortLabel: string; description: string; href: string; source: {file?: string} | null }
export interface Client {
  schema: string;
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number | null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[];
  media: { role: string; path: string; rank: number | null }[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title: string; body: string}[]; faqs: {q: string; a: string}[] };
  trust: { reviews: {author: string; text: string; rating: number|null; sourceUrl: string}[]; aggregate: {rating: number|null; count: number|null; sourceUrl: string}|null; areas: string[]; badges: {label: string; sublabel: string; meta: string}[]; socials: string[]; bookingUrl: string; mapUrl: string; hours: {text?: string}|null };
  design: {accent: string; paletteSource: string; fonts: string[]};
}
export interface Plan { schema: 'wss-rich-site-plan-v1'; content?: Record<string, string>; pages?: {slug?: string; title?: string}[]; services?: {name: string; slug?: string; longDescMd?: string; shortDesc?: string}[]; localPresence?: {mapAndDirections?: {geo?: {lat?: number; lng?: number; verified?: boolean; schemaAllowed?: boolean}}} }
export interface Site {client: Client; plan: Plan | null}
export function parseSite(raw: unknown, rich: unknown = null): Site {
  const client = contract.normalize(raw) as Client;
  const trade = /\b(excavat\w*|earthwork|earthmoving|trenching|grading|site prep\w*|land clearing|septic|water.*line|sewer|underground utilit\w*|drainage)\b/i;
  if (client.services.some(s => !trade.test(s.name))) throw Error('donor_wrong_trade');
  if (client.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(client.identity.email)) throw Error('invalid_email');
  if (rich !== null && (typeof rich !== 'object' || (rich as Plan).schema !== 'wss-rich-site-plan-v1')) throw Error('invalid_site_plan');
  const plan = rich as Plan | null;
  if (plan?.content && Object.values(plan.content).some(v => typeof v !== 'string')) throw Error('invalid_plan_content');
  if (plan?.services && (!Array.isArray(plan.services) || plan.services.some(s => typeof s.name !== 'string' || (s.longDescMd !== undefined && typeof s.longDescMd !== 'string')))) throw Error('invalid_plan_services');
  return {client, plan};
}
export function gallery(client: Client) { return client.media.filter(m => m.role === 'gallery').map((m,i) => ({m,i})).sort((a,b) => (a.m.rank ?? a.i) - (b.m.rank ?? b.i)).slice(0,11).map(x => x.m); }
export function brandStyle(client: Client): Record<string, string> {
  // CSD gives an explicit accent role, but its fonts array has no role contract.
  return client.design.paletteSource !== 'donor-default' && client.design.paletteSource !== 'approved-donor-fallback' && /^#[0-9a-f]{6}$/i.test(client.design.accent) ? {'--accent':client.design.accent, '--gradient-amber':client.design.accent} : {};
}
export function mapEmbed(plan: Plan | null): string {
  const geo = plan?.localPresence?.mapAndDirections?.geo;
  if (!geo?.verified || !geo.schemaAllowed || typeof geo.lat !== 'number' || typeof geo.lng !== 'number' || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || Math.abs(geo.lat)>90 || Math.abs(geo.lng)>180) return '';
  const box = [Math.max(-180,geo.lng-.1), Math.max(-90,geo.lat-.1), Math.min(180,geo.lng+.1), Math.min(90,geo.lat+.1)].join(',');
  return 'https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent(box) + '&layer=mapnik&marker=' + encodeURIComponent(geo.lat+','+geo.lng);
}
