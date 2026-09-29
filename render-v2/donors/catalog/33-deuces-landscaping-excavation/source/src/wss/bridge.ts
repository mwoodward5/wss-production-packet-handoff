import { normalize } from './client-contract.cjs';
import type { ClientData, SitePlan } from './types';
function validatePlan(raw: unknown): SitePlan {
 if (raw == null) return {schema:'wss-rich-site-plan-v1'};
 if (typeof raw !== 'object' || Array.isArray(raw) || (raw as SitePlan).schema !== 'wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
 const plan=raw as SitePlan;
 if (plan.content !== undefined && (!plan.content || typeof plan.content !== 'object' || Array.isArray(plan.content) || Object.values(plan.content).some(v=>typeof v!=='string'))) throw new Error('site_plan_content_invalid');
 if (plan.services !== undefined) {
  if (!Array.isArray(plan.services)) throw new Error('site_plan_services_invalid');
  const slugs=new Set<string>();
  for (const service of plan.services) {
   if (!service || typeof service!=='object' || typeof service.name!=='string' || !service.name.trim() || typeof service.slug!=='string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service.slug)) throw new Error('site_plan_service_invalid');
   if (slugs.has(service.slug)) throw new Error('site_plan_service_collision');
   slugs.add(service.slug);
   for (const key of ['h1','shortDesc','longDescMd','metaTitle','metaDescription'] as const) if (service[key]!==undefined && typeof service[key]!=='string') throw new Error('site_plan_service_copy_invalid');
   if (service.faqs!==undefined && (!Array.isArray(service.faqs) || service.faqs.some(f=>!f || typeof f.q!=='string' || !f.q.trim() || typeof f.a!=='string' || !f.a.trim()))) throw new Error('site_plan_faq_invalid');
  }
 }
 return plan;
}
export function createBridge(raw: unknown, plan?: unknown) {
 const client: ClientData = normalize(raw);
 // CSD has no category field. Require a core donor trade; never infer it from copy.
 if (!client.services.some(s => /\b(excavation|excavating|landscaping|landscape|earthmoving)\b/i.test(s.name))) throw new Error('donor_trade_mismatch');
 const routes=client.services.map(s=>s.href).filter(Boolean);
 if(new Set(routes).size!==routes.length) throw new Error('service_route_collision');
 if (client.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(client.identity.email)) throw new Error('client_email_invalid');
 const sitePlan = validatePlan(plan);
 const gallery = client.media.filter(m=>m.role==='gallery').map((m,i)=>({src:m.path,alt:`${client.identity.businessName} — project photo ${i+1}`}));
 const hours = typeof client.trust.hours === 'object' && client.trust.hours && 'text' in client.trust.hours && typeof client.trust.hours.text === 'string' ? client.trust.hours.text : '';
 const richService = (href:string) => {
  const service=client.services.find(s=>s.href===href);
  if(!service) return undefined;
  const rich=sitePlan.services?.find(s=>'/'+s.slug===href && s.name.toLowerCase()===service.name.toLowerCase());
  return {service, rich};
 };
 return {client,sitePlan,gallery,hours,richService};
}
function island(id:string, required:boolean) {
 const element=document.getElementById(id);
 if(!element) {if(required) throw new Error('certified_data_missing');return undefined;}
 return JSON.parse(element.textContent || '');
}
export const bridge=createBridge(island('wss-client-data',true),island('wss-site-plan',false));
export const WSS=bridge.client;
export const PLAN=bridge.sitePlan;
export const NAV=[{to:'/',label:'Home'},...WSS.services.filter(s=>s.href).map(s=>({to:s.href,label:s.shortLabel}))];
