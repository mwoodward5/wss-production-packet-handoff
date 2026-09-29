import { normalize } from './normalize.js';

export type ClientService = {name:string; shortLabel:string; description:string; href:string; source:unknown};
export type ClientMedia = {role:string; path:string; rank:number|null; width:number|null; height:number|null};
export interface Client {
 schema:string;
 identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;founded:number|null;logoOnLight:string;logoOnDark:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:ClientService[];media:ClientMedia[];
 content:{serviceIntro:string;about:string;whyHeadline:string;seasonalNote:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;sourceUrl:string}[];areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];hours:unknown;mapUrl:string;bookingUrl:string};
 design:{accent:string;paletteSource:string;fonts:string[]};
}
export interface SitePlan {schema:'wss-rich-site-plan-v1';content:Partial<Record<'home'|'about'|'contact'|'service-area',string>>;pages:unknown[];services:unknown[];visual:Record<string,unknown>;localPresence:Record<string,unknown>}
export function validateSite(raw:unknown, rich?:unknown):{client:Client;plan:SitePlan|null} {
 const client=normalize(raw) as Client;
 // CSD has no category field. Require an explicit photographic service, and reject unrelated trades.
 const names=client.services.map(s=>s.name).join(' ');
 if (!client.services.every(s=>/photograph|portrait|headshot|videograph/i.test(s.name)) || /landscap|plumb|roof|electrician|hvac|dentist|massage|cleaning/i.test(names)) throw new Error('photographer_trade_required');
 const reserved=new Set(['/','/about','/contact','/reserve','/booking','/pricing','/portfolio','/service-area']);
 const hrefs=client.services.map((s,i)=>serviceHref(s,i));
 if(new Set(hrefs).size!==hrefs.length || hrefs.some(h=>reserved.has(h))) throw new Error('service_route_collision');
 if(client.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(client.identity.email)) throw new Error('email_invalid');
 let plan:SitePlan|null=null;
 if(rich!=null){
  if(typeof rich!=='object'||(rich as SitePlan).schema!=='wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
  const p=rich as SitePlan;
  plan={...p,content:p.content&&typeof p.content==='object'?p.content:{},pages:Array.isArray(p.pages)?p.pages:[],services:Array.isArray(p.services)?p.services:[],visual:p.visual||{},localPresence:p.localPresence||{}};
 }
 return {client,plan};
}
export function getSite(){
 const island=document.getElementById('wss-client-data');
 if(!island?.textContent) throw new Error('client_data_island_required');
 const plan=document.getElementById('wss-site-plan');
 return validateSite(JSON.parse(island.textContent),plan?.textContent?JSON.parse(plan.textContent):undefined);
}
export const useSite=getSite;
export function serviceHref(service:ClientService,index:number){return service.href||`/session-${index+1}`;}
export function frames(role='gallery'){
 const {client}=getSite();
 return client.media.filter(m=>m.role===role).sort((a,b)=>(a.rank??999)-(b.rank??999)).map((m,i)=>({src:m.path,alt:`${client.identity.businessName} — ${i+1}`,w:m.width||undefined,h:m.height||undefined}));
}
export function paragraphs(text:string){return text.replace(/\r\n/g,'\n').split(/\n\s*\n/).map(p=>p.replace(/^#{1,6}\s+/,'').trim()).filter(Boolean);}
export function richCopy(key:keyof SitePlan['content'],fallback=''){
 const {plan}=getSite(); const value=plan?.content?.[key];return typeof value==='string'&&value.trim()?value:fallback;
}
export function applyBranding(){
 const {client}=getSite(); const hex=client.design.accent;
 // Reapplying data in a preview must not retain another client's accent.
 for(const token of ['--molten','--primary'])document.documentElement.style.removeProperty(token);
 // Only the explicit accent role is normalized by CSD. Arrays do not establish roles.
 if(client.design.paletteSource!=='donor-default'&&client.design.paletteSource!=='approved-donor-fallback'&&/^#[0-9a-f]{6}$/i.test(hex)){
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  const s=d===0?0:d/(1-Math.abs(2*l-1));let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;
  for(const token of ['--molten','--primary'])document.documentElement.style.setProperty(token,`${h} ${s*100}% ${l*100}%`);
 }
}
