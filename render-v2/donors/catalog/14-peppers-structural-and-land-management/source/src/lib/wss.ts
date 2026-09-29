import contract from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';

export type Media = { role: 'hero'|'gallery'|'people'|'about'|'logo'; path: string; sourceUrl: string; sourceSha256: string; rank: number|null };
export type Service = { name: string; shortLabel: string; description: string; href: string; source: unknown };
export type FAQ = { q: string; a: string };
export type Client = {
  schema: string;
  identity: { businessName:string; city:string; state:string; phoneDisplay:string; phoneTel:string; email:string; website:string; founded:number|null; logoOnDark:string; logoOnLight:string };
  hero: { line1:string; emphasis:string; line3:string; eyebrow:string; support:string; poster:string; video:string };
  services: Service[]; media: Media[];
  content: { serviceIntro:string; about:string; seasonalNote:string; whyHeadline:string; ctaHeadline:string; ctaBody:string; values:{title:string;body:string}[]; faqs:FAQ[] };
  trust: { reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[]; aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null; badges:{label:string;sublabel:string;meta:string}[]; stats:unknown[]; areas:string[]; hours:unknown; socials:string[]; mapUrl:string; bookingUrl:string };
  design:{paletteSource:string;accent:string;fonts:string[]};
};
export type SitePlan = { schema?:string; pages?:{slug?:string;title?:string}[]; services?:{name?:string;slug?:string;longDescMd?:string;shortDesc?:string}[]; content?:Record<string,string>; visual?:Record<string,unknown>; localPresence?:{mapAndDirections?:{geo?:{lat:number|null;lng:number|null;verified?:boolean;schemaAllowed?:boolean}}} };
const trade = /\b(remodel(?:ing)?|renovat(?:ion|ing)|carpentry|contract(?:or|ing)|home additions?|decks?|porches|structural repair|kitchen|basement|greenhouses?)\b/i;
export function parseSiteData(raw: unknown, rich: SitePlan = {}) {
  const data = contract.normalize(raw) as Client;
  // CSD has no category field. Require every service to match this donor's trade;
  // the adapter separately enforces facts.category before CSD is constructed.
  if (!data.services.every(s => trade.test(s.name))) throw new Error('donor_wrong_trade');
  if (!rich || typeof rich !== 'object' || Array.isArray(rich) || (rich.schema && rich.schema !== 'wss-rich-site-plan-v1')) throw new Error('site_plan_schema_invalid');
  if (rich.content && Object.values(rich.content).some(v=>typeof v!=='string')) throw new Error('site_plan_content_invalid');
  if (data.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(data.identity.email)) throw new Error('email_invalid');
  const paths = data.services.map(s => s.href);
  if (paths.some(p => !p || p === '/' || ['/about','/gallery','/contact','/services','/reviews','/faq','/service-area'].includes(p)) || new Set(paths).size !== paths.length) throw new Error('service_route_invalid');
  const slugs=paths.map(p=>p.split('/').filter(Boolean).pop());
  if (new Set(slugs).size!==slugs.length) throw new Error('service_slug_collision');
  return { site:data, plan:rich };
}
function island(id:string) { const el = document.getElementById(id); if (!el?.textContent) throw new Error('missing_' + id); return JSON.parse(el.textContent); }
const loaded = parseSiteData(island('wss-client-data'), document.getElementById('wss-site-plan') ? island('wss-site-plan') : {});
export const site = loaded.site;
export const plan = loaded.plan;
export const services = site.services.map(s => {
  const slug=s.href.split('/').filter(Boolean).pop()!;
  const rich=Array.isArray(plan.services) ? plan.services.find(r=>r.name===s.name && r.slug===slug) : undefined;
  const detail=typeof rich?.longDescMd==='string' && rich.longDescMd.trim() ? rich.longDescMd.replace(/^# [^\n]*\n+/,'').trim() : s.description;
  return {...s, title:s.name, summary:s.description, detail, slug, image:undefined as string|undefined};
});
export const gallery = site.media.filter(m => m.role === 'gallery').slice().sort((a,b) => (a.rank ?? 999)-(b.rank ?? 999));
// Exact dome/ceiling and molding/trim associations are absent from CSD. Keep the
// native showcase dormant rather than relabel arbitrary gallery photographs.
export const showcase: Media[] = [];
export const portrait = site.media.find(m => m.role === 'people');
export const aboutImage = site.media.find(m => m.role === 'about');
export const business = {name:site.identity.businessName, shortName:site.identity.businessName, city:site.identity.city, state:site.identity.state, phone:site.identity.phoneDisplay, phoneTel:site.identity.phoneTel.replace(/^tel:/,''), email:site.identity.email, yearFounded:site.identity.founded};
export const reviews = site.trust.reviews.map(r => ({...r,name:r.author}));
export const faqs = site.content.faqs;
export const hoursText = typeof site.trust.hours === 'object' && site.trust.hours && 'text' in site.trust.hours && typeof site.trust.hours.text === 'string' ? site.trust.hours.text : '';
export function pageCopy(key:string) { return plan.content?.[key]?.replace(/^# [^\n]*\n+/, '').trim() || ''; }
export function applyBranding() {
  // Only accent is a named role in the copied contract. Unordered fonts/palette
  // arrays are deliberately not mapped to donor roles.
  if (site.design.accent && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(site.design.accent)) document.documentElement.style.setProperty('--amber-glow',site.design.accent);
}
