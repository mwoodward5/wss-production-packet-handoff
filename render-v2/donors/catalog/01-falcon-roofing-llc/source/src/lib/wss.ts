import { normalize } from './client-contract.js';

export interface Service { name: string; shortLabel: string; description: string; href: string; source?: {file?: string} }
export interface ClientData {
  schema: 'wss-client-site-data-v2';
  identity: { businessName:string; city:string; state:string; phoneDisplay:string; phoneTel:string; email:string; website:string; founded:number|null; logoOnDark:string; logoOnLight:string };
  hero: {line1:string; emphasis:string; line3:string; eyebrow:string; support:string; poster:string; video:string};
  services: Service[];
  media: {role:string; path:string; rank:number|null; sourceSha256:string}[];
  content: {serviceIntro:string; about:string; seasonalNote:string; whyHeadline:string; ctaHeadline:string; ctaBody:string; values:{title:string;body:string}[]; faqs:{q:string;a:string}[]};
  trust: {areas:string[]; socials:string[]; mapUrl:string; bookingUrl:string; hours:unknown; badges:{label:string;sublabel:string;meta:string}[]; reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[]; aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null};
  design:{accent:string; paletteSource:string; fonts:string[]}; source:{category?:string;prospectId:string};
}
export interface RichService {name?:string;slug?:string;shortDesc?:string;longDescMd?:string}
export interface SitePlan {schema:string; pages?:{slug?:string;title?:string}[];services?:RichService[];content?:Record<string,string>;localPresence?:{mapAndDirections?:{googleBusinessUrl?:string;geo?:{lat:number;lng:number;verified?:boolean;schemaAllowed?:boolean}}};visual?:Record<string,unknown>}
export function readClient(value: unknown): ClientData {
  const client = normalize(value) as ClientData;
  if (client.source.category !== 'roofing') throw new Error('roofing_category_required');
  if (client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw new Error('invalid_email');
  return client;
}
function island(id:string, required = true):unknown {
  const el = document.getElementById(id);
  if (!el) {if(required) throw new Error('missing_'+id); return null;}
  if (el.getAttribute('type') !== 'application/json') throw new Error('invalid_island_type');
  return JSON.parse(el.textContent || '');
}
export const CLIENT = readClient(island('wss-client-data'));
const rawPlan = island('wss-site-plan', false) as SitePlan|null;
if (rawPlan && rawPlan.schema !== 'wss-rich-site-plan-v1') throw new Error('invalid_site_plan');
export const PLAN:SitePlan = rawPlan || {schema:'wss-rich-site-plan-v1'};
export const ROUTES = ['/roof-replacement','/roof-repair','/commercial-roofing','/gutters-siding-trim'] as const;
const matchers = [/\broof\s+replacement\b|\bre-?roofing\b/i,/\broof\s+repair\b/i,/\bcommercial\s+roofing\b|\bflat\s+roof/i,/\bgutter|\bsiding|\bexterior trim/i];
export function routeFor(service:Service):string {
  const explicit = ROUTES.indexOf(service.href as typeof ROUTES[number]);
  if (explicit >= 0 && matchers[explicit].test(service.name)) return service.href;
  const i = matchers.findIndex(re=>re.test(service.name));
  return i < 0 ? service.href || '/contact' : ROUTES[i];
}
export function serviceFor(path:string) {return CLIENT.services.find(s=>routeFor(s)===path || s.href===path);}
export function richService(service?:Service) {
  if (!service || !Array.isArray(PLAN.services)) return undefined;
  return PLAN.services.find(s=>s.name?.toLowerCase()===service.name.toLowerCase() && (!s.slug || '/'+s.slug.replace(/^\//,'')===service.href));
}
export function planCopy(key:string) { const value=PLAN.content?.[key]; return typeof value==='string' ? value : ''; }
export function paragraphs(text:string) {return text.replace(/\r/g,'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);}
export function guideFor(service?:Service) {
  const blocks=paragraphs(richService(service)?.longDescMd || '').filter(p=>p!==service?.description && !/^#\s/.test(p));
  const sections:string[]=[];
  for(const block of blocks) {
    if(!/^##+\s/.test(block) && sections.length) sections[sections.length-1]+='\n\n'+block;
    else sections.push(block);
  }
  return sections;
}
// The copied contract has only broad image roles. Never infer a roof type from gallery order.
export function mediaFor(slot:string):string|undefined {
  if(slot==='heroRoof') return CLIENT.hero.poster;
  return undefined;
}
export function applyBrand() {
  const accent=CLIENT.design.accent;
  if (CLIENT.design.paletteSource !== 'donor-default' && /^#[0-9a-f]{6}$/i.test(accent)) {
    const rgb=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)/255);
    const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min,l=(max+min)/2;
    const s=delta===0?0:delta/(1-Math.abs(2*l-1));
    const h=delta===0?0:((max===rgb[0]?(rgb[1]-rgb[2])/delta+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60);
    document.documentElement.style.setProperty('--accent',`${h} ${s*100}% ${l*100}%`);
    document.documentElement.style.setProperty('--ring',`${h} ${s*100}% ${l*100}%`);
    document.documentElement.style.setProperty('--accent-glow',`${h} ${s*100}% ${l*100}%`);
    const linear=rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
    const luminance=linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
    // Contrast roles only: use the existing light/graphite donor tokens, never invent a brand hue.
    document.documentElement.style.setProperty('--accent-foreground',luminance<0.179?'36 30% 97%':'220 18% 11%');
    document.documentElement.style.setProperty('--accent-on-dark',luminance<0.25?'36 30% 97%':`${h} ${s*100}% ${l*100}%`);
  }
  // design.fonts has no display/body/mono roles; retain the donor font hierarchy.
}
