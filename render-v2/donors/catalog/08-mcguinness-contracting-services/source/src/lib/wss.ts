import { normalize } from './client-contract.cjs';

export interface Media { role: 'hero'|'gallery'|'people'|'about'|'logo'; path: string; rank: number|null; sourceUrl: string; sourceSha256: string; outputSha256: string }
export interface Client {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number|null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: { name: string; shortLabel: string; description: string; href: string; source: unknown }[];
  media: Media[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title:string;body:string}[]; faqs: {q:string;a:string}[] };
  trust: { reviews: {author:string;text:string;rating:number|null;sourceUrl:string}[]; aggregate: {rating:number|null;count:number|null;sourceUrl:string}|null; hours: unknown; areas: string[]; socials: string[]; badges: {label:string;sublabel:string;meta:string}[]; stats: unknown[]; bookingUrl: string; mapUrl: string };
  design: { paletteSource:string; accent:string; fonts:string[] };
  source: {prospectId:string;compiledAt:string;packetSha256:string;packetVersion:string};
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  content?: {home?:string; about?:string; 'service-area'?:string; contact?:string};
  pages?: unknown[]; services?: unknown[]; forms?: unknown; visual?: unknown;
  localPresence?: {mapAndDirections?: {geo?: {lat?:number;lng?:number;verified?:boolean;schemaAllowed?:boolean}}};
}
export let CLIENT: Client;
export let PLAN: SitePlan | null = null;
export function configureClient(input: unknown, plan: unknown = null) {
  // Clear earlier identities even if a replacement fails validation.
  CLIENT = undefined as unknown as Client;
  PLAN = null;
  const next = normalize(input);
  // CSD v2 has no category: insist on a concrete service, never route by donor alone.
  if (!next.services.some(s => /\bconcrete\b/i.test(s.name))) throw new Error('concrete_trade_evidence_required');
  if (next.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(next.identity.email)) throw new Error('email_invalid');
  if (plan != null && (typeof plan !== 'object' || (plan as SitePlan).schema !== 'wss-rich-site-plan-v1')) throw new Error('site_plan_schema_invalid');
  CLIENT = next;
  PLAN = plan as SitePlan|null;
  if (PLAN?.content && Object.values(PLAN.content).some(v=>typeof v!=="string")) { CLIENT=undefined as unknown as Client; PLAN=null; throw new Error("site_plan_content_invalid"); }
  return CLIENT;
}
export function readIslands(doc: Pick<Document,'getElementById'>) {
  CLIENT = undefined as unknown as Client;
  PLAN = null;
  const client = doc.getElementById('wss-client-data');
  if (!client?.textContent) throw new Error('client_data_required');
  const plan = doc.getElementById('wss-site-plan');
  return configureClient(JSON.parse(client.textContent), plan?.textContent ? JSON.parse(plan.textContent) : null);
}
export function gallery() { return CLIENT.media.filter(m => m.role === 'gallery').sort((a,b)=>(a.rank ?? Infinity)-(b.rank ?? Infinity)).slice(0,4); }
export function crew() { return CLIENT.media.find(m=>m.role==='people'); }
export function sections() {
  return [ {href:'/#services',label:'Services'}, ...(gallery().length ? [{href:'/#work',label:'Our Work'}] : []),
    {href:'/#why',label:'About'}, ...(CLIENT.trust.areas.length ? [{href:'/#area',label:'Service Area'}] : []),
    ...(CLIENT.content.faqs.length ? [{href:'/#faq',label:'FAQ'}] : []), {href:'/#contact',label:'Contact'} ];
}
export function mapEmbed() {
  const geo=PLAN?.localPresence?.mapAndDirections?.geo;
  if (!geo?.verified || typeof geo.lat!=='number' || typeof geo.lng!=='number' || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || Math.abs(geo.lat)>90 || Math.abs(geo.lng)>180) return '';
  return `https://www.openstreetmap.org/export/embed.html?bbox=${geo.lng-0.1},${geo.lat-0.1},${geo.lng+0.1},${geo.lat+0.1}&layer=mapnik&marker=${geo.lat},${geo.lng}`;
}
export function brandStyles(): Record<string,string> {
  const accent=CLIENT.design.accent;
  // Only the named CSD accent role is specified. Font arrays have no roles.
  return CLIENT.design.paletteSource !== 'donor-default' && /^#[\da-f]{6}$/i.test(accent)
    ? {'--gold':accent,'--accent':accent,'--ring':accent,'--gradient-warm':`linear-gradient(135deg, ${accent}, ${accent})`} : {};
}
export function metrics() {
  return [
    ...(CLIENT.identity.founded ? [{label:'Founded',value:String(CLIENT.identity.founded)}] : []),
    ...(CLIENT.trust.aggregate?.rating != null && CLIENT.trust.aggregate?.count ? [{label:`${CLIENT.trust.aggregate.count} reviews`,value:String(CLIENT.trust.aggregate.rating)+' / 5'}] : []),
    ...CLIENT.trust.badges.map(b=>({label:b.sublabel,value:b.label}))
  ].slice(0,3);
}
export function hoursText() {
  const hours=CLIENT.trust.hours;
  return hours && typeof hours==='object' && 'text' in hours && typeof hours.text==='string' ? hours.text : '';
}
export function emailDraft(subject:string, body:string) {
  if (!CLIENT.identity.email) return '';
  return `mailto:${CLIENT.identity.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function schemas() {
  const c=CLIENT;
  return [{ '@context':'https://schema.org','@type':'GeneralContractor',name:c.identity.businessName,url:c.identity.website,
    telephone:c.identity.phoneTel.slice(4), ...(c.identity.email?{email:c.identity.email}:{}),
    address:{'@type':'PostalAddress',addressLocality:c.identity.city,addressRegion:c.identity.state},
    areaServed:c.trust.areas, hasOfferCatalog:{'@type':'OfferCatalog',name:'Services',itemListElement:c.services.map(s=>({'@type':'Offer',itemOffered:{'@type':'Service',name:s.name,description:s.description}}))}},
    {'@context':'https://schema.org','@type':'WebSite',name:c.identity.businessName,url:c.identity.website},
    ...(c.content.faqs.length?[{'@context':'https://schema.org','@type':'FAQPage',mainEntity:c.content.faqs.map(f=>({'@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))}]:[])];
}
