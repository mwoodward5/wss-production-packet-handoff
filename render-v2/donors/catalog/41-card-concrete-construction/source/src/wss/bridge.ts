import { createContext, useContext, type CSSProperties } from 'react';
import contract from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Client {
 schema:string; identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:{name:string;shortLabel:string;description:string;href:string}[];
 media:{role:string;path:string;rank:number|null}[];
 content:{serviceIntro:string;about:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{areas:string[];hours:unknown;mapUrl:string;badges:{label:string}[];stats:unknown[];reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[]};
 design:{accent:string;fonts:string[];paletteSource:string};
}
export interface SitePlan {schema:string;content?:Record<string,string>; services?:{name:string;slug:string;longDescMd?:string;shortDesc?:string}[];localPresence?:{mapAndDirections?:{geo?:{lat:number;lng:number;verified:boolean}}}}
// Copy stays text: never interpret compiler Markdown as executable HTML.
function prose(value:unknown) {
 if(typeof value!=='string') return '';
 return value.replace(/\r/g,'').split('\n').filter(line=>!/^\s*#{1,6}\s/.test(line)).join('\n').trim();
}
const spans=['col-span-2 lg:col-span-7 aspect-[16/11]','col-span-1 lg:col-span-5 aspect-[4/5]','col-span-1 lg:col-span-5 aspect-[5/4]','col-span-2 lg:col-span-7 aspect-[16/10]','col-span-2 lg:col-span-4 aspect-[4/5]','col-span-1 lg:col-span-4 aspect-[4/5]','col-span-1 lg:col-span-4 aspect-[4/5]','col-span-2 lg:col-span-8 aspect-[16/9]','col-span-2 lg:col-span-12 aspect-[21/9]'];
export function buildBridge(input:unknown, rich:unknown) {
 const client=contract.normalize(input) as Client;
 if(!client.services.every(s=>/\b(concrete|slabs?|flat\s?work|screed|demolition)\b/i.test(s.name))) throw Error('wrong_trade');
 if(!rich || (rich as SitePlan).schema!=='wss-rich-site-plan-v1') throw Error('site_plan_required');
 const plan=rich as SitePlan;
 if(plan.services!==undefined && (!Array.isArray(plan.services)||!plan.services.every(s=>s && typeof s.name==='string' && typeof s.slug==='string' && (s.longDescMd===undefined||typeof s.longDescMd==='string')))) throw Error('site_plan_services_invalid');
 const paths=client.services.map(s=>s.href).filter(Boolean);
 if(new Set(paths).size!==paths.length || paths.some(p=>['/privacy','/terms'].includes(p))) throw Error('service_route_conflict');
 if(client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw Error('email_invalid');
 const style:CSSProperties & Record<string,string>={};
 if(client.design.accent && /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(client.design.accent)) {style['--amber']=client.design.accent;style['--amber-soft']=client.design.accent;}
 const geo=plan.localPresence?.mapAndDirections?.geo;
 const coords=geo?.verified===true && typeof geo.lat==='number' && typeof geo.lng==='number' && Math.abs(geo.lat)<=90 && Math.abs(geo.lng)<=180 ? `${geo.lat}°, ${geo.lng}°` : '';
 const hours=client.trust.hours;
 const HOURS=hours && typeof hours==='object' && 'text' in hours && typeof hours.text==='string' ? hours.text : '';
 return {client,plan,style,coords,HOURS,NAME:client.identity.businessName,LOCATION:`${client.identity.city}, ${client.identity.state}`,
 PHONE:client.identity.phoneDisplay,PHONE_TEL:client.identity.phoneTel.slice(4),EMAIL:client.identity.email,ADDRESS_LINE1:'',ADDRESS_LINE2:`${client.identity.city}, ${client.identity.state}`,MAPS_URL:client.trust.mapUrl,
 COPY:{about:prose(plan.content?.about)||client.content.about,area:prose(plan.content?.['service-area']),contact:client.content.ctaBody||prose(plan.content?.contact)},
 IMG:{logo:client.identity.logoOnLight,hero:client.hero.poster},
 SERVICES:client.services.map((s,i)=>({code:`SVC-${String(i+1).padStart(2,'0')}`,title:s.name,blurb:s.description,tag:'',use:'',image:'',specs:[] as {k:string;v:string}[],href:s.href})),
 PROCESS:client.content.values.map((v,i)=>({id:`V-${i+1}`,stage:`${i+1} / ${client.content.values.length}`,label:'',title:v.title,body:v.body})),
 TOWNS:client.trust.areas,FAQ:client.content.faqs,
 GALLERY:client.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??999)-(b.rank??999)).slice(0,9).map((m,i)=>({src:m.path,caption:`${client.identity.businessName} · ${String(i+1).padStart(2,'0')}`,span:spans[i]}))};
}
export type Bridge=ReturnType<typeof buildBridge>;
export const DonorContext=createContext<Bridge|null>(null);
export function useDonor(){const value=useContext(DonorContext);if(!value)throw Error('client_data_required');return value;}
export function readIslands(doc:Document){
 const read=(id:string)=>{const el=doc.getElementById(id);if(!el || el.getAttribute('type')!=='application/json')throw Error(`${id}_required`);return JSON.parse(el.textContent||'');};
 return buildBridge(read('wss-client-data'),read('wss-site-plan'));
}
