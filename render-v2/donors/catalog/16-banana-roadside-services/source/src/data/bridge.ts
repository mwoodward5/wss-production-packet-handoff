import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Service { name:string; shortLabel:string; description:string; href:string; source:unknown }
export interface Media { role:'hero'|'gallery'|'people'|'about'|'logo'; path:string; rank:number|null; width:number|null; height:number|null }
export interface Client {
 schema:'wss-client-site-data-v2';
 identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string;founded:number|null};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];media:Media[];
 content:{serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];mapUrl:string};
 design:{paletteSource:string;accent:string;fonts:string[]};
}
export interface SitePlan {schema:'wss-rich-site-plan-v1';pages?:{slug?:string;[key:string]:unknown}[];services?:{name?:string;slug?:string;shortDesc?:string;longDescMd?:string}[];content?:Partial<Record<'home'|'services'|'gallery'|'about'|'service-area'|'contact',string>>;visual?:unknown;localPresence?:unknown}
export function validateClient(input:unknown):Client {
 const value=normalize(input) as Client;
 const paths=new Set<string>();
 const names=new Set<string>();
 for(const service of value.services) {
  if(names.has(service.name.toLowerCase())) throw Error('roadside_duplicate_service');
  names.add(service.name.toLowerCase());
  if(!service.href) continue;
  if(paths.has(service.href)) throw Error('roadside_duplicate_route');
  paths.add(service.href);
  if(['/about-us','/gallery','/contact-us'].includes(service.href) || (service.href==='/european-battery-services' && !/european.*battery|battery.*european/i.test(service.name))) throw Error('roadside_route_conflict');
 }
 if(!value.services.every(s=>/\b(?:roadside|(?:car |vehicle |automotive |european )?battery (?:replacement|jump|services?)|jump[ -]?starts?|flat tire|tire (?:change|assistance|repair)|tyre|vehicle lockout|car lockout|towing|fuel delivery|winch)\b/i.test(s.name) && !/solar|marine|lawn|boat|bicycle/i.test(s.name))) throw Error('roadside_wrong_trade');
 return value;
}
function island(id:string):unknown {
 const node=document.getElementById(id);
 if(!node||node.getAttribute('type')!=='application/json') throw Error('required_island_missing');
 return JSON.parse(node.textContent||'');
}
export function readInputs() {
 const client=validateClient(island('wss-client-data'));
 const plan=(document.getElementById('wss-site-plan')?island('wss-site-plan'):{schema:'wss-rich-site-plan-v1'}) as SitePlan;
 if(!plan||plan.schema!=='wss-rich-site-plan-v1') throw Error('site_plan_invalid');
 return {client,plan};
}
export const {client,plan}=readInputs();
// Nullable aggregate fields do not support a complete rating claim.
export const aggregate=client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null ? client.trust.aggregate : null;
export const serviceItems=[...client.services].sort((a,b)=>Number(/battery.*replace|replace.*battery/i.test(b.name))-Number(/battery.*replace|replace.*battery/i.test(a.name)));
export const european=serviceItems.find(s=>/european/i.test(s.name)&&/battery/i.test(s.name));
export const mediaItems=(role:Media['role'])=>client.media.filter(m=>m.role===role).sort((a,b)=>(a.rank??Number.MAX_SAFE_INTEGER)-(b.rank??Number.MAX_SAFE_INTEGER));
export const mediaFor=(role:Media['role'],index=0)=>mediaItems(role)[index]?.path;
// Only hours.text is documented by universal-contract; do not infer arbitrary schedules.
export const hoursText=typeof (client.trust.hours as {text?:unknown})?.text==='string'?(client.trust.hours as {text:string}).text:'';
export const pageCopy=(page:keyof NonNullable<SitePlan['content']>)=>typeof plan.content?.[page]==='string'?plan.content[page]!.replace(/^# [^\n]*\n+/,'').trim():'';
export function applyBranding() {
 // Unordered font arrays do not establish heading/body roles. Keep donor CSS fallbacks.
 if(!['donor-default','approved-donor-fallback'].includes(client.design.paletteSource)&&/^#[0-9a-f]{6}$/i.test(client.design.accent)) {
 document.documentElement.style.setProperty('--banana',client.design.accent);
 document.documentElement.style.setProperty('--banana-deep',client.design.accent);
 }
}
