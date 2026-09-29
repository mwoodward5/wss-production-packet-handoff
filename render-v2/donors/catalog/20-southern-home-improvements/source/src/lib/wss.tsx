import { createContext, useContext } from 'react';
import { normalize } from './client-contract.js';
export type Service = {name:string;shortLabel:string;description:string;href:string};
export type Client = {
 schema:string;identity:{businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;logoOnLight:string;logoOnDark:string;founded:number|null};
 hero:{line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};services:Service[];
 media:{role:string;path:string;rank:number|null}[];
 content:{serviceIntro:string;about:string;seasonalNote:string;whyHeadline:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{badges:{label:string;sublabel:string;meta:string}[];reviews:{author:string;text:string;sourceUrl:string;rating:number|null}[];areas:string[];hours:unknown;mapUrl:string;socials:string[]};design:{accent:string;paletteSource:string;fonts:string[]};
};
export type SitePlan={schema:string;content?:Record<string,string>;pages?:{slug:string;title?:string}[];localPresence?:{mapAndDirections?:{geo?:{lat:number;lng:number;verified:boolean}}};visual?:unknown};
export function createSite(raw:unknown, rawPlan:unknown) {
 const client=normalize(raw) as Client;
 const plan=rawPlan as SitePlan;
 if(!plan || plan.schema!=='wss-rich-site-plan-v1') throw Error('site_plan_required');
 if(plan.content && (typeof plan.content!=='object' || Array.isArray(plan.content) || Object.values(plan.content).some(v=>typeof v!=='string'))) throw Error('site_plan_content_invalid');
 if(plan.pages && (!Array.isArray(plan.pages) || plan.pages.some(p=>!p || typeof p.slug!=='string' || !/^\/?(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(p.slug) || (p.title!==undefined && typeof p.title!=='string')))) throw Error('site_plan_pages_invalid');
 const trade=/\b(roof(?:s|ing)?|siding|gutters?|exteriors?|home improvements?|deck(?:s|ing)?|fascias?|soffits?)\b/i;
 if(client.services.some(s=>!trade.test(s.name))) throw Error('donor_wrong_trade');
 if(client.identity.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(client.identity.email)) throw Error('client_email_invalid');
 const g=plan.localPresence?.mapAndDirections?.geo;
 const geo=g?.verified===true && Number.isFinite(g.lat)&&Number.isFinite(g.lng)&&Math.abs(g.lat)<=90&&Math.abs(g.lng)<=180?g:null;
 const h=client.trust.hours as {text?:unknown}|null;
 return {client,plan,area:client.trust.areas.join(' · ')||`${client.identity.city}, ${client.identity.state}`,hours:typeof h?.text==='string'?h.text:'',emailHref:client.identity.email?'mailto:'+client.identity.email:'',geo,googleMaps:geo?`https://www.google.com/maps/dir/?api=1&destination=${geo.lat},${geo.lng}`:client.trust.mapUrl,appleMaps:geo?`https://maps.apple.com/?daddr=${geo.lat},${geo.lng}&dirflg=d`:''};
}
export type Site=ReturnType<typeof createSite>;
export const SiteContext=createContext<Site|null>(null);
export function useSite(){const site=useContext(SiteContext);if(!site)throw Error('client_data_required');return site;}
export function readSite(doc:Document){const read=(id:string)=>{const el=doc.getElementById(id);if(!el?.textContent)throw Error(id+'_required');return JSON.parse(el.textContent);};return createSite(read('wss-client-data'),read('wss-site-plan'));}
export function brandStyle(site:Site){return site.client.design.paletteSource!=='donor-default' && /^#[0-9a-f]{6}$/i.test(site.client.design.accent)?{'--clay':site.client.design.accent}:{};}
export function projectMailto(emailHref:string, fields:{lane:string;urgency:string;zip:string;name:string;contact:string;details:string}) {
 if(!/^mailto:[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(emailHref)) return '';
 const body=[`Service lane: ${fields.lane}`,`Timing: ${fields.urgency}`,`ZIP: ${fields.zip || '(not provided)'}`,`Name: ${fields.name || '(not provided)'}`,`Phone or email: ${fields.contact || '(not provided)'}`,'','Project details:',fields.details || '(none)'].join('\n');
 return `${emailHref}?subject=${encodeURIComponent('Project request — '+fields.lane)}&body=${encodeURIComponent(body)}`;
}
