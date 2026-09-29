import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { normalize } from './client-contract.cjs';
import { serviceKind } from './service-kind.cjs';
export { serviceKind, type ServiceKind } from './service-kind.cjs';

export interface ClientService { name: string; shortLabel: string; description: string; href: string; source: {file?: string} | null }
export interface ClientMedia { role: 'hero'|'gallery'|'people'|'about'|'logo'; path: string; sourceUrl: string; sourceSha256: string; outputSha256: string; rank: number|null }
export interface ClientData {
  schema: 'wss-client-site-data-v2';
  identity: {businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;founded:number|null;logoOnDark:string;logoOnLight:string};
  hero: {line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
  services: ClientService[]; media: ClientMedia[];
  content: {serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
  trust: {reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;areas:string[];badges:{label:string;sublabel:string;meta:string}[];hours:unknown;socials:string[];bookingUrl:string;mapUrl:string};
  design: {paletteSource:string;accent:string;fonts:string[]};
  source: {prospectId:string;packetSha256:string;packetVersion:string;compiledAt:string};
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  pages: {slug?:string}[];
  services: {name:string;slug?:string;shortDesc?:string;longDescMd?:string}[];
  content: Partial<Record<'home'|'services'|'gallery'|'about'|'service-area'|'contact',string>>;
  localPresence?: {mapAndDirections?:{googleBusinessUrl?:string;googlePlaceId?:string;geo?:{lat:number|null;lng:number|null;verified:boolean;schemaAllowed:boolean}}};
  visual?: Record<string,unknown>; packetHash?:string;
}
const emptyPlan:SitePlan = {schema:'wss-rich-site-plan-v1',pages:[],services:[],content:{}};
export function readInputs(client:unknown, plan:unknown = emptyPlan) {
  const c = normalize(client) as ClientData;
  // CSD v2 has no trade field: conservatively refuse unrecognized/mixed services.
  if (c.services.some(s => !serviceKind(s))) throw new Error('electrical_services_required');
  const fixed = new Set(['/','/services','/projects','/service-area','/contact','/faq','/about']);
  const routes = c.services.map(s=>s.href);
  if (routes.some(x=>!x || fixed.has(x)) || new Set(routes).size !== routes.length) throw new Error('distinct_service_routes_required');
  if (c.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(c.identity.email)) throw new Error('email_invalid');
  const p = plan as SitePlan;
  if (!p || p.schema !== emptyPlan.schema || !Array.isArray(p.pages) || !Array.isArray(p.services) || !p.content || typeof p.content !== 'object' || Array.isArray(p.content)) throw new Error('site_plan_invalid');
  // Every rich service must bind to a normalized certified service by both name and slug.
  if (p.services.some(s=>!s || typeof s.name !== 'string' || (s.slug !== undefined && (typeof s.slug !== 'string' || !s.slug)) || (s.longDescMd !== undefined && typeof s.longDescMd !== 'string'))) throw new Error('site_plan_services_invalid');
  if (p.services.some(s=>!c.services.some(x=>x.name===s.name && (!s.slug || x.href==='/'+s.slug))))throw new Error('site_plan_service_unbound');
  if (p.services.some(s=>c.services.filter(x=>x.name===s.name && (!s.slug || x.href==='/'+s.slug)).length!==1) ||
      c.services.some(s=>p.services.filter(x=>x.name===s.name && (!x.slug || s.href==='/'+x.slug)).length>1)) throw new Error('site_plan_service_ambiguous');
  if (Object.values(p.content).some(x=>typeof x!=='string'))throw new Error('site_plan_content_invalid');
  return {client:c,plan:p};
}
const Context = createContext<ReturnType<typeof readInputs>|null>(null);
export function ClientProvider({value,children}:{value:ReturnType<typeof readInputs>;children:ReactNode}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useClient(){ const c=useContext(Context); if(!c)throw new Error('client_context_missing');return c.client; }
export function useSitePlan(){const c=useContext(Context);if(!c)throw new Error('client_context_missing');return c.plan;}
export function loadIslands(doc:Document){
  const raw=doc.getElementById('wss-client-data'); if(!raw)throw new Error('client_data_missing');
  const plan=doc.getElementById('wss-site-plan');
  return readInputs(JSON.parse(raw.textContent || ''),plan?JSON.parse(plan.textContent || ''):emptyPlan);
}
export function paragraphs(text:string = ''){return text.replace(/\r\n/g,'\n').split(/\n\n+/).map(s=>s.trim()).filter(Boolean);}
export function introCopy(text:string = ''){return paragraphs(text).find(p=>!p.startsWith('#')) || '';}
export function Copy({text}:{text?:string}) {
  return <>{paragraphs(text).map((p,i)=>p.startsWith('#') ? <h2 className="font-display text-2xl" key={i}>{p.replace(/^#+\s*/, '')}</h2> : <p key={i} className="whitespace-pre-line">{p}</p>)}</>;
}
export function serviceDetails(plan:SitePlan,s:ClientService){
  const rich=plan.services.find(r=>r.name===s.name && (!r.slug || '/'+r.slug===s.href));
  const blocks=paragraphs(rich?.longDescMd || s.description).filter(p=>!p.startsWith('#'));
  return {body:blocks.filter(p=>!/^[-*] /.test(p)),bullets:blocks.filter(p=>/^[-*] /.test(p)).flatMap(p=>p.split('\n').filter(x=>/^[-*] /.test(x)).map(x=>({title:x.slice(2),body:''}))),gallery:[] as {path:string;alt:string}[]};
}
export function galleryMedia(c:ClientData){return c.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));}
// No contract field binds a gallery photograph to a service. Keep those slots empty.
export function serviceImage(_c:ClientData,_p:SitePlan,_s:ClientService):string|undefined{return undefined;}
export function pageImage(c:ClientData,role:'about'|'people'){return c.media.find(m=>m.role===role)?.path;}
export function verifiedGeo(p:SitePlan){
  const g=p.localPresence?.mapAndDirections?.geo;
  return g?.verified===true && g.schemaAllowed===true && typeof g.lat==='number' && typeof g.lng==='number' && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat)<=90 && Math.abs(g.lng)<=180 ? g : null;
}
export function hoursText(c:ClientData){const h=c.trust.hours as {text?:unknown}|null;return typeof h?.text==='string'?h.text:'';}
export function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>typeof window==='undefined'||!window.matchMedia||window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const q=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!q)return;const update=()=>setReduced(q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
  return reduced;
}
export function HeroMedia(){const c=useClient();const reduced=useReducedMotion();const [failed,setFailed]=useState(false);
  const cls='w-full h-[460px] md:h-[560px] object-cover';
  return c.hero.video && !reduced && !failed ? <video className={cls} src={c.hero.video} poster={c.hero.poster} autoPlay loop muted playsInline onError={()=>setFailed(true)} aria-label={c.identity.businessName}><img src={c.hero.poster} alt={c.identity.businessName}/></video> : <img className={cls} src={c.hero.poster} alt={c.identity.businessName} width={1200} height={1600} {...{fetchpriority:'high'}}/>;
}
export function brandStyle(c:ClientData){
  // accent is the only named color role in the normalized contract; fonts[] has no roles.
  const hex=c.design.accent;
  if(c.design.paletteSource==='donor-default' || !/^#[0-9a-f]{6}$/i.test(hex))return {};
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255); const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  const sat=d===0?0:d/(1-Math.abs(2*l-1));let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;
  return {'--accent':`${h} ${sat*100}% ${l*100}%`} as React.CSSProperties;
}
