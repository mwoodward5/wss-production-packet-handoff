import {validate,slug,theme} from './core.cjs';
import type {Client, SitePlan, Service} from './core.cjs';
export type {Client,SitePlan,Service};
let client:Client; let plan:SitePlan|undefined;
export function initialize(raw:unknown,sitePlan?:SitePlan){client=validate(raw,sitePlan);plan=sitePlan;return client;}
export function getClient(){if(!client)throw Error('certified_client_data_required');return client;}
export function getPlan(){return plan;}
export function serviceSlug(s:Service){return s.href?s.href.slice(1):slug(s.name);}
export function mediaFor(role:string){return getClient().media.filter(m=>m.role===role).sort((a,b)=>(a.rank??999)-(b.rank??999));}
export function applyBrand(){for(const [key,value] of Object.entries(theme(getClient())))document.documentElement.style.setProperty(key,value);}
export function pageMeta(title:string){const c=getClient();return {meta:[{title:`${title} · ${c.identity.businessName}`},{name:'description',content:c.hero.support}]};}

// Only extend a normalized service when the rich copy agrees with its certified prefix.
export function serviceBody(s:Service){const rich=plan?.services?.find(r=>r.name===s.name&&r.slug===serviceSlug(s));const body=rich?.longDescMd?.replace(/^# .*?\n+/,'').trim();return body&&body.startsWith(s.description)?body:s.description;}
export function contactCopy(){const text=plan?.content?.contact;return typeof text==='string'?text.replace(/^# .*?\n+/,'').trim():'';}
