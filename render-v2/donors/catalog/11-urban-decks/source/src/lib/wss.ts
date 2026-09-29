import { normalize } from './client-contract.js';
export interface FAQ { q: string; a: string }
export interface Media { role: string; path: string; rank: number | null; width: number | null; height: number | null }
export interface Client {
 schema: string;
 identity: {businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:{name:string;shortLabel:string;description:string;href:string}[];
 media:Media[];
 content:{serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:FAQ[]};
 trust:{hours:null|{text?:string};areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];reviews:{author:string;text:string;sourceUrl:string}[];mapUrl:string};
 design:{accent:string;fonts:string[];paletteSource:string};
}
export interface RichPlan {schema:string;services?:{name:string;slug:string;shortDesc?:string;longDescMd?:string}[];content?:Record<string,string>;pages?:unknown[];visual?:Record<string,unknown>;localPresence?:Record<string,unknown>}
export const serviceSlug=(name:string)=>name.normalize('NFKD').replace(/[^\w\s-]/g,'').trim().toLowerCase().replace(/[\s_-]+/g,'-');
export function validateClient(value:unknown):Client {
 const client = normalize(value) as Client;
 if (!client.services.every(s=>/\b(deck|decks|decking|railing|railings|pergola|pergolas|gazebo|gazebos)\b|patio roof|outdoor living/i.test(s.name))) throw Error('wrong_trade');
 if (client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw Error('invalid_email');
 const reserved=['/services','/projects','/about','/service-area','/faq','/contact','/blog'];
 const seen=new Set<string>();
 for(const s of client.services){const key=s.href || '/'+serviceSlug(s.name);if(!/^\/[a-z0-9][a-z0-9-]*$/.test(key)||reserved.includes(key)||seen.has(key))throw Error('service_route_conflict');seen.add(key);}
 return client;
}
export function validatePlan(value:unknown,client:Client):RichPlan {
 if(!value || typeof value!=='object' || Array.isArray(value))throw Error('invalid_site_plan');
 const p=value as RichPlan;
 if(p.schema!=='wss-rich-site-plan-v1')throw Error('invalid_site_plan');
 if(p.content && (typeof p.content!=='object'||Array.isArray(p.content)||Object.values(p.content).some(v=>typeof v!=='string')))throw Error('invalid_plan_content');
 if(p.services!==undefined){
  if(!Array.isArray(p.services))throw Error('invalid_plan_services');
  const seen=new Set<string>();
  for(const s of p.services){
   const bound=client.services.find(c=>c.name===s?.name);
   if(!bound || s.slug!==(bound.href?.slice(1)||serviceSlug(bound.name)) || seen.has(s.name))throw Error('plan_service_unbound');
   for(const key of ['shortDesc','longDescMd'] as const)if(s[key]!==undefined && typeof s[key]!=='string')throw Error('invalid_plan_service_copy');
   seen.add(s.name);
  }
 }
 return p;
}
function read(id:string):unknown { const el=document.getElementById(id);if (!el?.textContent) throw Error('missing_'+id);return JSON.parse(el.textContent); }
export const CLIENT=validateClient(read('wss-client-data'));
export const PLAN=validatePlan(read('wss-site-plan'),CLIENT);
export function media(role:string,index=0):string {return CLIENT.media.filter(m=>m.role===role).sort((a,b)=>(a.rank??999)-(b.rank??999))[index]?.path??'';}
export const GALLERY=CLIENT.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??999)-(b.rank??999));
// Detailed CAD/blueprint/macro semantics are absent in CSD v2. Do not assign unrelated photos.
export const SPECIAL_MEDIA={iso:'',blueprint:'',stone:'',rail:''};
export function applyBrand() {
 if (/^#[\da-f]{6}$/i.test(CLIENT.design.accent)) {
  document.documentElement.style.setProperty('--cedar',CLIENT.design.accent);
  document.documentElement.style.setProperty('--primary',CLIENT.design.accent);
 }
 // Font arrays contain no certified roles. Donor typography is retained.
}
