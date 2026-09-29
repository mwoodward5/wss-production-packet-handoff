import { normalize } from './client-normalize';
export type Service = { name:string;shortLabel:string;description:string;href:string;source?:unknown };
export type Media = {role:string;path:string;rank:number|null;width:number|null;height:number|null};
export type Client = {
 schema:'wss-client-site-data-v2';
 identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];media:Media[];
 content:{serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;sourceUrl:string;rating:number|null}[];areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];mapUrl:string;bookingUrl:string;aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null};
 design:{accent:string;paletteSource:string;fonts:string[]};
};
export type SitePlan={schema?:string;content?:Partial<Record<'home'|'about'|'contact'|'service-area',string>>;pages?:{slug:string;[key:string]:unknown}[];visual?:Record<string,unknown>};
export function trade(name:string){
 if(/\b(drywall|sheetrock|texture|ceiling)\b/i.test(name))return 'drywall';
 if(/\b(plaster|stucco|eifs|skim)\b/i.test(name))return 'plaster';
 if(/\b(paint|painting)\b/i.test(name))return 'painting';
 return '';
}
export function parseInputs(raw:unknown,rawPlan:unknown={}):{client:Client;plan:SitePlan}{
 const client=normalize(raw) as Client;
 if(!client.services.some(s=>trade(s.name)))throw Error('donor_wrong_trade');
 if(client.identity.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email))throw Error('invalid_email');
 const plan=(rawPlan||{}) as SitePlan;
 if(Object.keys(plan).length&&plan.schema!=='wss-rich-site-plan-v1')throw Error('site_plan_schema_invalid');
 return {client,plan};
}
function island(id:string){const e=document.getElementById(id);if(!e){if(id==='wss-site-plan')return {};throw Error('client_data_required');}return JSON.parse(e.textContent||'null');}
export const {client,plan}=parseInputs(island('wss-client-data'),island('wss-site-plan'));
export const gallery=client.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
export const aboutPhoto=client.media.find(m=>m.role==='people')||client.media.find(m=>m.role==='about');
// Global navigation always uses the complete service list. Detail pages pass their
// selected service explicitly, so direct entry and SPA navigation behave alike.
export const serviceList=(kind:string,selected?:Service)=>client.services.filter(s=>trade(s.name)===kind&&(!selected||s===selected));
export const aggregate=client.trust.aggregate?.rating!=null&&client.trust.aggregate?.count!=null?client.trust.aggregate:null;
export const serviceHref=(s:Service)=>s.href||(trade(s.name)?'/'+trade(s.name):'/services');
export const faqsFor=(kind:string)=>client.content.faqs.filter(f=>trade(f.q+' '+f.a)===kind);
export function pageCopy(key:'home'|'about'|'contact'|'service-area',fallback=''){const c=plan.content?.[key];return typeof c==='string'&&c.trim()?c.replace(/^# [^\n]*\n+/,'').trim():fallback;}
export function applyBrand(){if(/^#[0-9a-f]{3,8}$/i.test(client.design.accent))for(const token of ['--accent','--amber'])document.documentElement.style.setProperty(token,client.design.accent);}
