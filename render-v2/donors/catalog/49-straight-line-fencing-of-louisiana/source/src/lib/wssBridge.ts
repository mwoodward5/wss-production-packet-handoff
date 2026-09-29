import contract from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs'

export interface Service { name:string; shortLabel:string; description:string; href:string; source:unknown }
export interface Media {role:string; path:string; rank:number|null}
export interface Client {
 schema:string;
 identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];media:Media[];
 content:{serviceIntro:string;about:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{badges:{label:string}[];reviews:{author:string;text:string;sourceUrl:string;rating:number|null}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];mapUrl:string;bookingUrl:string};
 design:{accent:string;paletteSource:string;fonts:string[]};
}
export interface SitePlan {schema:'wss-rich-site-plan-v1';content?:Partial<Record<'home'|'about'|'contact'|'service-area',string>>;pages?:unknown[];services?:unknown[];visual?:unknown;localPresence?:unknown}
export function parseClient(raw:unknown):Client {
 const c = contract.normalize(raw) as Client;
 // CSD v2 drops category. Require a fencing service signal rather than accept unrelated trades.
 if (!c.services.some(s=>/\bfenc(?:e|es|ing)\b/i.test(s.name))) throw new Error('fencing_services_required');
 if(c.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.identity.email)) throw new Error('email_invalid');
 return c;
}
function island(id:string):unknown {const el=document.getElementById(id);if(!el?.textContent)throw new Error(id+'_missing');return JSON.parse(el.textContent)}
export let client:Client;
export let sitePlan:SitePlan|null = null;
export let dataError = '';
try {
 client=parseClient(island('wss-client-data'));
 if(document.getElementById('wss-site-plan')) {
  const p=island('wss-site-plan') as SitePlan;
  if(p.schema!=='wss-rich-site-plan-v1')throw new Error('site_plan_invalid');
  if(p.content && (typeof p.content!=='object' || Array.isArray(p.content) || Object.values(p.content).some(v=>typeof v!=='string')))throw new Error('site_plan_content_invalid');
  sitePlan=p;
 }
} catch {dataError='Site information is unavailable.'}
export const gallery = client?.media.filter(m=>m.role==='gallery').map((m,i)=>({url:m.path,alt:`${client.identity.businessName} photo ${i+1}`})) || [];
export const hours = typeof (client?.trust.hours as {text?:unknown})?.text === 'string' ? (client.trust.hours as {text:string}).text : '';
export const navLinks = [{href:'#services',label:'Services'},...(gallery.length?[{href:'#portfolio',label:'Photos'},{href:'#team',label:'Gallery'}]:[]),{href:'#about',label:'About'},...(client?.content.values.length || client?.trust.reviews.length?[{href:'#awards',label:'Why Us'}]:[]),{href:'#contact',label:'Contact'}];
