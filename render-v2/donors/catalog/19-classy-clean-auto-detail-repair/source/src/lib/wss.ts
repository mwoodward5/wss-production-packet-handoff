import { normalize } from './client-contract.cjs';
import { assertAutomotiveServices } from './donor-policy.cjs';

export interface Service { name: string; shortLabel: string; description: string; href: string }
export interface Media { role: string; path: string; rank: number | null; width: number | null; height: number | null }
export interface Client {
  schema: string;
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; logoOnLight: string; logoOnDark: string; founded: number | null };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[]; media: Media[];
  content: { serviceIntro: string; about: string; whyHeadline: string; seasonalNote: string; ctaHeadline: string; ctaBody: string; values: {title:string;body:string}[]; faqs: {q:string;a:string}[] };
  trust: { badges: {label:string;sublabel:string;meta:string}[]; reviews: {author:string;text:string;sourceUrl:string;rating:number|null}[]; aggregate: {rating:number|null;count:number|null;sourceUrl:string}|null; areas:string[]; hours: {text?:string;source?:string}|null; mapUrl:string; bookingUrl:string; socials:string[] };
  design: { accent:string; paletteSource:string; fonts:string[] };
}
export interface SitePlan { schema?:string; pages?: {slug:string}[]; content?:Record<string,string>; services?: {name:string;slug?:string;longDescMd?:string}[]; localPresence?: {mapAndDirections?: {geo?: {lat:number;lng:number;verified:boolean}}} }
let client: Client;
let plan: SitePlan = {};
export function initializeSite(data: unknown, rich: SitePlan = {}) {
  client = undefined as unknown as Client;
  plan = {};
  const next = normalize(data) as Client;
  assertAutomotiveServices(next.services);
  if (next.identity.email && !/^[^\s@?&#%]+@[^\s@?&#%]+\.[^\s@?&#%]+$/.test(next.identity.email)) throw new Error('email_invalid');
  const routes = next.services.map(s=>s.href).filter(Boolean);
  const names = next.services.map(s=>s.name.toLowerCase());
  if (new Set(routes).size !== routes.length || new Set(names).size !== names.length) throw new Error('service_route_ambiguous');
  if (!rich || typeof rich !== 'object' || Array.isArray(rich) || (Object.keys(rich).length && rich.schema !== 'wss-rich-site-plan-v1')) throw new Error('site_plan_schema_invalid');
  if (rich.services && (!Array.isArray(rich.services) || rich.services.some(s=>!s || typeof s.name !== 'string' || (s.longDescMd != null && typeof s.longDescMd !== 'string')))) throw new Error('site_plan_services_invalid');
  if (rich.services && new Set(rich.services.map(s=>s.name.toLowerCase())).size !== rich.services.length) throw new Error('site_plan_services_ambiguous');
  if (rich.content && (typeof rich.content !== 'object' || Array.isArray(rich.content) || Object.values(rich.content).some(s=>typeof s !== 'string'))) throw new Error('site_plan_content_invalid');
  if (rich.pages && (!Array.isArray(rich.pages) || rich.pages.some(p=>!p || typeof p.slug !== 'string'))) throw new Error('site_plan_pages_invalid');
  // Own an immutable snapshot: callers cannot replace one client's copy after validation.
  const snapshot = JSON.parse(JSON.stringify(rich)) as SitePlan;
  function freeze(value: unknown): void { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(snapshot);
  client = next; plan = snapshot;
  return client;
}
export function getSite(): Client { if (!client) throw new Error('certified_client_required'); return client; }
export function getPlan() { return plan; }
export function hoursText() { const h=getSite().trust.hours; return h && typeof h.text === 'string' && typeof h.source === 'string' && h.source.trim() ? h.text : ''; }
export function aggregateRating() { const a=getSite().trust.aggregate; return a && a.rating !== null && a.count !== null ? a : null; }
export function serviceCopy(service: Service) { return plan.services?.find(s=>s.name.toLowerCase()===service.name.toLowerCase())?.longDescMd?.trim() || service.description; }
// These exact content keys are emitted by WSS-CONTRACTS/adapters/universal-contract.cjs.
// Strip Markdown headings only; never rewrite business facts or manufacture copy.
export function sectionCopy(key: 'about' | 'contact' | 'service-area', fallback='') {
  const copy=plan.content?.[key]?.trim();
  return copy ? copy.split(/\r?\n/).filter(line=>!/^\s{0,3}#{1,6}\s/.test(line)).join('\n').trim() || fallback : fallback;
}
export function plannedPage(path:string) { return plan.pages?.some(p=>'/'+p.slug.replace(/^\/+|\/+$/g,'')===path) === true; }
export function galleryMedia() { return getSite().media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank ?? 999)-(b.rank ?? 999)).slice(0,4); }
export function mapEmbed() { const g=plan.localPresence?.mapAndDirections?.geo; if (g?.verified !== true || !Number.isFinite(g.lat) || !Number.isFinite(g.lng) || Math.abs(g.lat)>90 || Math.abs(g.lng)>180) return ''; return `https://www.openstreetmap.org/export/embed.html?bbox=${g.lng-.04},${g.lat-.03},${g.lng+.04},${g.lat+.03}&layer=mapnik&marker=${g.lat}%2C${g.lng}`; }
export function branding() { const d=getSite().design; return d.paletteSource !== 'donor-default' && d.paletteSource !== 'approved-donor-fallback' && /^#[a-f\d]{6}$/i.test(d.accent) ? {'--accent': d.accent} : {}; }
