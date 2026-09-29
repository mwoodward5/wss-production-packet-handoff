import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Media {role:string;path:string;rank:number|null}
export interface Service {name:string;shortLabel:string;description:string;href:string;source:unknown}
export interface ClientData {
 schema:string; identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnLight:string;logoOnDark:string;founded:number|null};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];media:Media[];
 content:{serviceIntro:string;about:string;whyHeadline:string;seasonalNote:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];stats:unknown[];bookingUrl:string;mapUrl:string};
 design:{paletteSource:string;accent:string;fonts:string[]};source:{packetSha256:string};
}
export interface SitePlan {schema:'wss-rich-site-plan-v1';pages:{slug?:string}[];content:Record<string,string>;services:{name:string;slug:string;longDescMd?:string;shortDesc?:string}[];visual:Record<string,unknown>;localPresence:Record<string,unknown>;packetHash:string}
export function bindClient(raw:unknown, plan?:unknown):{client:ClientData;plan:SitePlan|null}{
 const client=normalize(raw) as ClientData;
 // CSD has no category. This fail-closed scope gate complements mapDonor's authoritative category check.
 if(!client.services.some(s=>/\bRV\b|recreational vehicle/i.test(s.name)))throw Error('rv_service_scope_required');
 const paths=client.services.map(s=>s.href).filter(Boolean);
 if(new Set(paths).size!==paths.length)throw Error('rv_service_route_duplicate');
 if(plan!=null){
   const p=plan as SitePlan;
   const record=(x:unknown)=>!!x&&typeof x==='object'&&!Array.isArray(x);
   if(!record(p)||p.schema!=='wss-rich-site-plan-v1'||!Array.isArray(p.pages)||!p.pages.every(record)||!record(p.content)||!Object.values(p.content).every(x=>typeof x==='string')||!Array.isArray(p.services)||!p.services.every(s=>record(s)&&typeof s.name==='string'&&typeof s.slug==='string'&&(s.longDescMd===undefined||typeof s.longDescMd==='string')&&(s.shortDesc===undefined||typeof s.shortDesc==='string'))||!record(p.visual)||!record(p.localPresence)||typeof p.packetHash!=='string'||!/^[a-f0-9]{64}$/i.test(p.packetHash))throw Error('site_plan_invalid');
   // The plan hash identifies the rich plan itself, not the CSD source packet.
   // Only attach rich service details to the same certified service and route.
   if(p.services.some(s=>!client.services.some(c=>c.name===s.name&&c.href==='/'+s.slug))||new Set(p.services.map(s=>s.name)).size!==p.services.length)throw Error('site_plan_service_unbound');
 }
 return {client,plan:(plan as SitePlan)||null};
}
function island(id:string){const el=document.getElementById(id);if(!el)throw Error('missing_'+id);return JSON.parse(el.textContent||'');}
const bound=bindClient(island('wss-client-data'),document.getElementById('wss-site-plan')?island('wss-site-plan'):null);
export const WSS=bound.client;
export const PLAN=bound.plan;
export const mediaFor=(role:string)=>WSS.media.filter(m=>m.role===role).sort((a,b)=>(a.rank??999)-(b.rank??999));
export const hoursText=():string[]=>{
 const h=WSS.trust.hours;if(!h||typeof h!=='object')return [];
 if('text' in h&&typeof h.text==='string')return [h.text];
 return Object.entries(h).filter(([k])=>/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(k)).flatMap(([k,v])=>typeof v==='string'?[`${k}: ${v}`]:v&&typeof v==='object'&&typeof v.open==='string'&&typeof v.close==='string'?[`${k}: ${v.open} – ${v.close}`]:[]);
};
export const pageCopy=(key:string,fallback:string)=>typeof PLAN?.content?.[key]==='string'&&PLAN.content[key].trim()?PLAN.content[key].replace(/^# [^\n]*\n+/, '').trim():fallback;
export function applyBrand(){
 // Only CSD's explicit accent role is specified; font arrays have no role semantics.
 if(WSS.design.paletteSource!=='approved-donor-fallback'&&/^#[\da-f]{6}$/i.test(WSS.design.accent))document.documentElement.style.setProperty('--accent',WSS.design.accent);
}
