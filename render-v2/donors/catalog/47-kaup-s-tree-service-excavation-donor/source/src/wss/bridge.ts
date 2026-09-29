// Reuse the exact, read-only copied contract validator.
// @ts-ignore CJS contract has no declarations.
import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
export interface Service { name: string; shortLabel: string; description: string; href: string }
export interface Client {
 schema: string;
 identity: {businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnDark:string;logoOnLight:string};
 hero: {line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services: Service[];
 media: {role:string;path:string;rank:number|null}[];
 content: {serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust: {reviews:{author:string;text:string;sourceUrl:string;rating:number|null}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];badges:{label:string}[];mapUrl:string;bookingUrl:string};
 design:{accent:string;paletteSource:string;fonts:string[]};
}
export interface SitePlan {
 schema:'wss-rich-site-plan-v1';
 pages?: {slug:string;title?:string}[];
 content?: Partial<Record<'home'|'about'|'contact'|'service-area'|'gallery'|'services',string>>;
 localPresence?: {mapAndDirections?:{geo?:{lat:number|null;lng:number|null;verified:boolean;schemaAllowed:boolean}}};
 visual?: Record<string,unknown>;
}
export function bindClient(raw:unknown, rawPlan?:unknown) {
 const client = normalize(raw) as Client;
 // A shared route must never silently show another service's facts.
 const routes = client.services.map(s => s.href).filter(Boolean);
 if (new Set(routes).size !== routes.length || routes.some(href => ['/about','/services','/gallery','/service-area','/contact'].includes(href))) throw Error('client_service_route_ambiguous');
 if (!client.services.some(s => /\b(tree|trees|arborist|arboriculture|stump|excavation|excavating|land clearing|dirt work|storm shelter)\b/i.test(s.name))) throw Error('donor_wrong_trade');
 if (client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw Error('client_email_invalid');
 const plan = rawPlan == null ? undefined : rawPlan as SitePlan;
 if (plan && plan.schema !== 'wss-rich-site-plan-v1') throw Error('site_plan_schema_invalid');
 if (plan?.content && (typeof plan.content !== 'object' || Object.values(plan.content).some(v=>typeof v!=='string'))) throw Error('site_plan_content_invalid');
 if (plan?.pages && (!Array.isArray(plan.pages) || plan.pages.some(p=>!p || typeof p.slug!=='string'))) throw Error('site_plan_pages_invalid');
 const gallery = client.media.filter(m => m.role === 'gallery').slice(0,10);
 const hours = client.trust.hours && typeof client.trust.hours === 'object' && 'text' in client.trust.hours && typeof client.trust.hours.text === 'string' ? client.trust.hours.text : '';
 const candidate = plan?.localPresence?.mapAndDirections?.geo;
 const geo = candidate?.verified === true && typeof candidate.lat === 'number' && typeof candidate.lng === 'number' && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) && Math.abs(candidate.lat)<=90 && Math.abs(candidate.lng)<=180 ? candidate : null;
 const destination = geo ? `${geo.lat},${geo.lng}` : '';
 return {client,plan,gallery,hours,geo,
   googleDirections: destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : '',
   appleDirections: destination ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d` : '',
   services:client.services.map((s,i)=>({...s,id:`service-${i+1}`,label:s.shortLabel,copy:s.description,img:''})),
   inset: gallery[0]?.path || '',
   shelter:client.services.find(s=>/storm shelter|cellar/i.test(s.name)),
 };
}
export type BoundSite = ReturnType<typeof bindClient>;
export function readIslands(doc:Pick<Document,'getElementById'>) {
 const raw=doc.getElementById('wss-client-data')?.textContent;
 if(!raw) throw Error('client_data_missing');
 const plan=doc.getElementById('wss-site-plan')?.textContent;
 return bindClient(JSON.parse(raw),plan?JSON.parse(plan):undefined);
}
export function brandStyle(site:BoundSite):Record<string,string> {
 // Accent alone has a defined role. Never infer roles from arrays.
 return site.client.design.paletteSource !== 'donor-default' && /^#[0-9a-f]{6}$/i.test(site.client.design.accent)
   ? {'--amber-cta':site.client.design.accent,'--amber-cta-hover':site.client.design.accent} : {};
}
