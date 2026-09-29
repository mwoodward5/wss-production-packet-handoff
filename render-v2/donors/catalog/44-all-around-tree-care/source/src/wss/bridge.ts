// The build injects validated JSON islands before the application module.
// @ts-ignore The copied, dependency-free CJS contract is bundled by Vite.
import contract from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Media { role: 'hero'|'gallery'|'people'|'about'|'logo'; path: string; sourceUrl: string; sourceSha256: string; outputSha256: string; rank: number|null; width: number|null; height: number|null; originalBytes: boolean }
export interface ClientSiteData {
 schema: 'wss-client-site-data-v2';
 identity: {businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;founded:number|null;logoOnDark:string;logoOnLight:string};
 hero: {line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services: {name:string;shortLabel:string;description:string;href:string;source:Record<string,unknown>|null}[];
 media:Media[];
 content: {serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust: {reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];stats:unknown[];bookingUrl:string;mapUrl:string};
 design: {paletteSource:string;accent:string;fonts:string[]}; trustModules:string[];
 source:{prospectId:string;compiledAt:string;packetSha256:string;packetVersion:string};
}
export interface RichService {slug:string;name?:string;h1?:string;metaTitle?:string;metaDescription?:string;shortDesc?:string;longDescMd?:string;imageSlot?:string;faqs?:{q:string;a:string}[];[key:string]:unknown}
export interface RichPlan {schema:'wss-rich-site-plan-v1';services:RichService[];pages:Record<string,unknown>[];content:Record<string,string>;forms:Record<string,unknown>;localPresence:Record<string,unknown>;search:Record<string,unknown>;visual:Record<string,unknown>;premiumVisual:Record<string,unknown>;seoAssets:Record<string,unknown>;[key:string]:unknown}
function island(id:string,required:boolean):unknown {
 const node=typeof document==='undefined'?null:document.getElementById(id);
 if(!node){if(required)throw new Error('wss_client_data_missing');return null;}
 if(node.getAttribute('type')!=='application/json')throw new Error('wss_island_type_invalid');
 try{return JSON.parse(node.textContent||'');}catch{throw new Error('wss_island_json_invalid');}
}
export const DATA = contract.normalize(island('wss-client-data',true)) as ClientSiteData;
const servicePaths=DATA.services.map(s=>s.href).filter(Boolean);
if(new Set(servicePaths).size!==servicePaths.length||servicePaths.some(p=>['/services','/contact'].includes(p)))throw new Error('wss_service_route_conflict');
if(DATA.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(DATA.identity.email))throw new Error('wss_email_invalid');
// CSD intentionally has no trade/category: constrain this donor by its actual service names.
if(!DATA.services.some(s=>/\b(tree|arborist|arboriculture|stump|pruning)\b/i.test(s.name)))throw new Error('wss_tree_trade_required');
const rawPlan=island('wss-site-plan',false);
function normalizePlan(raw:unknown):RichPlan|null {
 if(raw===null)return null;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||(raw as Record<string,unknown>).schema!=='wss-rich-site-plan-v1')throw new Error('wss_plan_schema_invalid');
 const p=raw as Record<string,unknown>;
 const obj=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
 const services=Array.isArray(p.services)?p.services.filter((s):s is RichService=>!!s&&typeof s==='object'&&typeof s.slug==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug)):[];
 return {...p,schema:'wss-rich-site-plan-v1',services,pages:Array.isArray(p.pages)?p.pages.filter(x=>x&&typeof x==='object'):[],content:Object.fromEntries(Object.entries(obj(p.content)).filter(([,v])=>typeof v==='string')) as Record<string,string>,forms:obj(p.forms),localPresence:obj(p.localPresence),search:obj(p.search),visual:obj(p.visual),premiumVisual:obj(p.premiumVisual),seoAssets:obj(p.seoAssets)};
}
export const PLAN=normalizePlan(rawPlan);
export const gallery=DATA.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??Number.MAX_SAFE_INTEGER)-(b.rank??Number.MAX_SAFE_INTEGER)).map(m=>({...m,src:m.path,alt:`${DATA.identity.businessName} project photo`,caption:''}));
export function serviceSlug(service:ClientSiteData['services'][number]):string {return service.href?service.href.slice(1):service.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
export function serviceMedia(slug:string):Media|undefined {
 const service=DATA.services.find(s=>serviceSlug(s)===slug);
 if(!service)return undefined;
 const rich=PLAN?.services.find(s=>s.slug===slug&&(!s.name||s.name.toLowerCase()===service.name.toLowerCase()));
 return typeof rich?.imageSlot==='string'?DATA.media.find(m=>m.path===rich.imageSlot&&m.role!=='logo'):undefined;
}
