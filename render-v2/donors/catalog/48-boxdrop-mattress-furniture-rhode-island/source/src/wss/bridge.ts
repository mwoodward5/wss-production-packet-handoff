import { normalize } from './client-contract.cjs';
import type {Client, SitePlan} from './types';
export function bindClient(raw:unknown,plan:SitePlan={}):{client:Client;sitePlan:SitePlan}{
 const client=normalize(raw);
 if(client.services.some(s=>!/\b(mattresses?|furniture|sofas?|sectionals?|recliners?|loveseats?|adjustable bases?|beds?)\b/i.test(s.name)||/\b(hvac|roofing|plumbing|landscaping|cleaning|pest|flower|garden)\b/i.test(s.name)))throw Error('donor_wrong_trade');
 if(!plan || typeof plan!=='object' || Array.isArray(plan) || (Object.keys(plan).length>0 && plan.schema!=='wss-rich-site-plan-v1'))throw Error('site_plan_schema_invalid');
 if(plan.content!==undefined && (!plan.content || typeof plan.content!=='object' || Array.isArray(plan.content) || Object.values(plan.content).some(value=>typeof value!=='string')))throw Error('site_plan_content_invalid');
 // CSD permits a plain string here; disallow mailto headers/extra recipients locally.
 if(client.identity.email && !/^[^\s@?&#,;]+@[^\s@?&#,;]+\.[^\s@?&#,;]+$/.test(client.identity.email))throw Error('donor_email_invalid');
 return {client,sitePlan:plan};
}
function island(id:string,required=false){const text=globalThis.document?.getElementById(id)?.textContent;if(!text){if(required)throw Error('client_data_missing');return {}}return JSON.parse(text)}
export const {client,sitePlan}=bindClient(island('wss-client-data',true),island('wss-site-plan'));
export const gallery=client.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??0)-(b.rank??0)).map((m,i)=>({src:m.path,alt:client.identity.businessName+' — photo '+(i+1)}));
export const nav=[...client.services.map(s=>({to:s.href,label:s.shortLabel})),{to:'/about',label:'About'},...(client.trust.areas.length?[{to:'/locations',label:'Locations'}]:[]),...(client.content.faqs.length?[{to:'/faq',label:'FAQ'}]:[]),{to:'/contact',label:'Contact'}];
export function applyBrand(){if(client.design.paletteSource!=='donor-default' && client.design.paletteSource!=='approved-donor-fallback' && /^#[0-9a-f]{6}$/i.test(client.design.accent))document.documentElement.style.setProperty('--accent',client.design.accent);}
