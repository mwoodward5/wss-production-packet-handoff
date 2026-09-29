// The renderer certifies inputs; normalization remains the copied WSS contract.
// @ts-expect-error The reference contract is JavaScript, kept unchanged.
import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Service { name:string; shortLabel:string; description:string; href:string; source?:{file:string} }
export interface Media { role:string; path:string; width:number|null; height:number|null; rank:number|null }
export interface Client {
 schema:string;
 identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnLight:string;logoOnDark:string;founded:number|null};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[]; media:Media[];
 content:{serviceIntro:string;about:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;seasonalNote:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;sourceUrl:string;rating:number|null}[];badges:{label:string;sublabel:string;meta:string}[];areas:string[];socials:string[];hours:unknown;stats:unknown[];mapUrl:string;bookingUrl:string};
 design:{accent:string;paletteSource:string;fonts:string[]};
}
export interface RichPlan {schema?:string;services?:{name?:string;slug?:string;shortDesc?:string;longDescMd?:string}[];content?:Record<string,string>;pages?:{slug?:string}[];visual?:unknown;localPresence?:unknown}
export const slug = (s:string) => s.normalize('NFKD').replace(/[^\w\s-]/g,'').trim().toLowerCase().replace(/[\s_-]+/g,'-');
export function assertTrade(services:Service[]) {
 const allowed=/\b(handyman|home improvement|property (services|maintenance)|painting|paint|drywall|door|doors|window|windows|floor|flooring|bathroom|deck|fence|shed|gutter|pressure wash|carpentry|furniture|assembly|home repair|home maintenance|interior repair|exterior repair)\b/i;
 if(!services.length || services.some(s=>!allowed.test(s.name))) throw new Error('donor_wrong_trade');
}
export function createSite(raw:unknown, plan:RichPlan={}) {
 const client=normalize(raw) as Client;
 assertTrade(client.services);
 if(!plan || typeof plan!=='object' || Array.isArray(plan) || (Object.keys(plan).length>0 && plan.schema!=='wss-rich-site-plan-v1')) throw new Error('site_plan_schema_invalid');
 if(plan.services && (!Array.isArray(plan.services) || plan.services.some(s=>!s || typeof s.name!=='string' || (s.shortDesc!=null && typeof s.shortDesc!=='string') || (s.longDescMd!=null && typeof s.longDescMd!=='string')))) throw new Error('site_plan_services_invalid');
 if(plan.content && (typeof plan.content!=='object' || Array.isArray(plan.content) || Object.values(plan.content).some(v=>typeof v!=='string'))) throw new Error('site_plan_content_invalid');
 const serviceKey=(name:string)=>name.trim().toLowerCase();
 if(new Set(client.services.map(s=>serviceKey(s.name))).size!==client.services.length) throw new Error('service_name_collision');
 if(plan.services && new Set(plan.services.map(s=>serviceKey(s.name!))).size!==plan.services.length) throw new Error('site_plan_service_name_collision');
 if(client.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(client.identity.email)) throw new Error('email_invalid');
 const used=new Set<string>();
 const services=client.services.map(s=>{
   const id=s.href?s.href.slice(1):slug(s.name);
   if(!id || used.has(id) || ['about','contact','gallery','faq','privacy','services','service-areas','bbb-categories'].includes(id)) throw new Error('service_route_collision');
   used.add(id);
   const rich=plan.services?.find(r=>serviceKey(r.name!)===serviceKey(s.name));
   // Markdown headings are editorial section boundaries, never new service facts.
   const detail=rich?.longDescMd?.replace(/\r\n/g,'\n').replace(/^# [^\n]*\n+/, '').trim();
   const sections=detail?.split(/\n(?=## )/).map(p=>p.trim()) || [];
   const bullets=sections.filter(p=>p.startsWith('## ')).map(p=>({t:p.split('\n')[0].slice(3),d:p.split('\n').slice(1).join('\n').trim()})).filter(p=>p.t && p.d);
   return {...s,slug:id,short:s.shortLabel,img:'',lines:[s.description],intro:sections.find(p=>!p.startsWith('## ')) || s.description,tagline:rich?.shortDesc || s.shortLabel,bullets,service:id};
 });
 const areas=client.trust.areas.map(name=>({slug:slug(name),name}));
 if(areas.some(a=>!a.slug) || new Set(areas.map(a=>a.slug)).size!==areas.length) throw new Error('area_route_collision');
 const hours=client.trust.hours;
 const hoursText=hours && typeof hours==='object' && 'text' in hours && typeof hours.text==='string'?hours.text:'';
 return {client,plan,services,areas,hoursText,aboutImage:client.media.find(m=>m.role==='about')?.path || '',gallery:client.media.filter(m=>m.role==='gallery')};
}
