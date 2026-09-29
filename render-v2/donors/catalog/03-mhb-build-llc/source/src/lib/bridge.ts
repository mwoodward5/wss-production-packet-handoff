import { normalize } from './client-contract.js';

export interface FAQ { q: string; a: string }
export interface Media { role: string; path: string; rank: number | null; width: number | null; height: number | null }
export interface ClientData {
  schema: string;
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; founded: number | null; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: { name: string; shortLabel: string; description: string; href: string }[];
  media: Media[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title:string;body:string}[]; faqs: FAQ[] };
  trust: { areas: string[]; badges: {label:string;sublabel:string;meta:string}[]; aggregate: {rating:number;count:number;sourceUrl:string} | null; reviews: {author:string;text:string;rating:number|null;sourceUrl:string}[]; mapUrl: string; hours: unknown; stats: unknown[]; socials: string[]; bookingUrl: string };
  design: { accent: string; fonts: string[]; paletteSource: string };
}
export interface SitePlan {
  schema?: string;
  content?: Record<string, string>;
  services?: {name?:string;slug?:string;shortDesc?:string;longDescMd?:string}[];
  pages?: {slug?:string;[key:string]:unknown}[];
  localPresence?: Record<string, unknown>;
  visual?: Record<string, unknown>;
  [key:string]: unknown;
}
const trade = /\b(contract(?:or|ing)?|construction|build(?:er|ing)?|remodel(?:ing)?|renovat(?:ion|ions|ing)|roof(?:ing)?|carpentry|moldings?|trim|painting|concrete|floor(?:ing)?|tile|home improvements?|decks?|additions?)\b/i;
export const slugify = (value: string) => value.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-');
export const plainCopy = (value: unknown): string => typeof value === 'string' ? value.replace(/^#{1,6}\s+.*(?:\r?\n|$)/gm, '').replace(/\*\*/g, '').trim() : '';

export function createBridge(input: unknown, planInput: unknown = {}) {
  const client = normalize(input) as ClientData;
  if (!client.services.every(s => trade.test(s.name))) throw new Error('donor_wrong_trade');
  if (client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw new Error('client_email_invalid');
  const sitePlan = (planInput && typeof planInput === 'object' ? planInput : {}) as SitePlan;
  if (sitePlan.schema && sitePlan.schema !== 'wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
  const services = client.services.map(s => ({slug: s.href ? s.href.slice(1) : slugify(s.name), name:s.name, shortLabel:s.shortLabel, short:s.description, icon:'HardHat' as const}));
  if (new Set(services.map(s=>s.slug)).size !== services.length) throw new Error('service_slug_collision');
  const serviceDetails = Object.fromEntries(services.map(s => {
    const rich = sitePlan.services?.find(r => r.name === s.name && (!r.slug || r.slug === s.slug));
    return [s.slug, {intro:plainCopy(rich?.longDescMd) || s.short, bullets:[] as string[], faqs:[] as FAQ[]}];
  }));
  const pageCopy = (key:string) => plainCopy(sitePlan.content?.[key]);
  const media = client.media.slice().sort((a,b)=>(a.rank ?? Infinity)-(b.rank ?? Infinity));
  const projects = media.filter(m=>m.role==='gallery').slice(0,33).map((m,i)=>({src:m.path,alt:`${client.identity.businessName} — gallery image ${i+1}`,caption:'',orientation:(m.height && m.width && m.height>m.width?'portrait':'landscape') as 'portrait'|'landscape',categories:[] as string[]}));
  const photo = media.find(m=>m.role==='about');
  const companyPhoto = photo ? {src:photo.path,alt:client.identity.businessName,caption:''} : undefined;
  const business = {name:client.identity.businessName,legalName:client.identity.businessName,city:client.identity.city,state:client.identity.state,region:client.trust.areas.join(', '),phone:client.identity.phoneDisplay,phoneHref:client.identity.phoneTel,email:client.identity.email,emailHref:client.identity.email ? `mailto:${client.identity.email}` : '',url:client.identity.website.replace(/\/$/,''),tagline:client.hero.eyebrow};
  // No process schema, media categories/captions or font roles exist in the copied contract.
  return {client,sitePlan,services,business,serviceDetails,pageCopy,projects,companyPhoto,processSteps:[] as {title:string;body:string}[]};
}

function island(id:string) { const node=document.getElementById(id); if (!node?.textContent) throw new Error(`missing_${id}`); return JSON.parse(node.textContent); }
// Imported only after main.tsx validates the islands; no fallback donor identity.
const runtime = typeof document !== 'undefined' ? createBridge(island('wss-client-data'), document.getElementById('wss-site-plan') ? island('wss-site-plan') : {}) : undefined;
export const client = runtime?.client as ClientData;
export const sitePlan = runtime?.sitePlan as SitePlan;
export const business = runtime?.business;
export const services = runtime?.services;
export const serviceDetails = runtime?.serviceDetails;
export const companyPhoto = runtime?.companyPhoto;
export const processSteps = runtime?.processSteps || [];
export const pageCopy = (key:string) => runtime?.pageCopy(key) || '';
export const projects = runtime?.projects || [];

export function applyBranding() {
  // The CSD accent field is an explicit role. Unlabelled palette/font arrays are ignored.
  const hex=client.design.accent;
  if (/^#[a-f\d]{6}$/i.test(hex)) {
    const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
    let h=0; if(d) h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;
    const s=d ? d/(1-Math.abs(2*l-1)) : 0;
    document.documentElement.style.setProperty('--accent',`${h} ${s*100}% ${l*100}%`);
  }
}
