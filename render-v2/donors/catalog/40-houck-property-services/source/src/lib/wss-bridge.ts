import contract from './client-site-data.cjs';
export type Service = {name:string; shortLabel:string; description:string; href:string};
export type WorkItem = {url:string; alt:string; caption:string; category:string};
export type Client = {
 schema:string; identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;founded:number|null;logoOnDark:string;logoOnLight:string};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];media:{role:string;path:string;rank:number|null}[];
 content:{serviceIntro:string;about:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{areas:string[];badges:{label:string;sublabel:string;meta:string}[];hours:unknown;stats:unknown[];mapUrl:string;bookingUrl:string;socials:string[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null};
 design:{accent:string;paletteSource:string;fonts:string[]};
};
export type SitePlan = {schema?:string;content?:Record<string,string>;pages?:{slug:string;title?:string}[]};
export let site:Client;
export let plan:SitePlan = {};
export function configure(raw:unknown, rich:SitePlan = {}) {
 // A failed reconfiguration must never leave the previous client's facts available.
 site = undefined as unknown as Client; plan = {};
 const next = contract.normalize(raw) as Client;
 // CSD has no category field. Require positive supported-trade evidence; mapping additionally checks certified category.
 if (!next.services.some(s=>/\b(handyman|property maintenance|finish carpentry|carpentry|drywall|home repair)\b/i.test(s.name))) throw Error('donor_trade_evidence_required');
 // Conservative lane gate: an unrelated service cannot enter alongside one matching trade.
 if (!next.services.every(s=>/\b(handyman|property maintenance|carpentry|drywall|home repair|cleaning|landscaping|yard care|remodeling|remodel|moving|painting|flooring|tile|cabinetry|fencing|door repair|fixture repair)\b/i.test(s.name))) throw Error('donor_service_trade_unresolved');
 if (!rich || typeof rich !== 'object' || Array.isArray(rich)) throw Error('site_plan_object_required');
 if (Object.keys(rich).length && rich.schema !== 'wss-rich-site-plan-v1') throw Error('site_plan_schema_invalid');
 if (rich.content !== undefined && (!rich.content || typeof rich.content !== 'object' || Array.isArray(rich.content) || Object.values(rich.content).some(x=>typeof x !== 'string'))) throw Error('site_plan_content_invalid');
 if (rich.pages !== undefined && (!Array.isArray(rich.pages) || rich.pages.some(p=>!p || typeof p.slug !== 'string' || !/^(?:\/?[a-z0-9]+(?:-[a-z0-9]+)*\/?|\/)$/.test(p.slug) || (p.title !== undefined && typeof p.title !== 'string')))) throw Error('site_plan_pages_invalid');
 const routes = next.services.map(s=>s.href).filter(Boolean);
 if (new Set(routes).size !== routes.length) throw Error('service_routes_ambiguous');
 if (next.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.identity.email)) throw Error('email_invalid');
 site=next; plan=Object.freeze({...rich,content:rich.content ? Object.freeze({...rich.content}) : undefined,pages:rich.pages?.map(p=>Object.freeze({...p}))}); return next;
}
export function readIslands(doc:Document) {
 site = undefined as unknown as Client; plan = {};
 return configure(JSON.parse(doc.getElementById('wss-client-data')?.textContent || 'null'), JSON.parse(doc.getElementById('wss-site-plan')?.textContent || '{}'));
}
export function gallery():WorkItem[] {return site.media.filter(m=>m.role==='gallery').map(m=>({url:m.path,alt:'',caption:'',category:'Gallery'}));}
export function secondaryHero():string {return site.media.find(m=>m.role==='hero' && m.path!==site.hero.poster)?.path || '';}
export function pageCopy(key:string):string {return plan.content && Object.hasOwn(plan.content,key) ? plan.content[key] : '';}
export function hoursText():string {const h=site.trust.hours;return h && typeof h==='object' && 'text' in h && typeof h.text==='string' ? h.text : '';}
export function brandStyle():Record<string,string> {return /^#[a-f\d]{6}$/i.test(site.design.accent) && !/fallback|default/i.test(site.design.paletteSource) ? {'--brass':site.design.accent} : {};}
