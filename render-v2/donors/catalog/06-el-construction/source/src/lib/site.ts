import { readIslands } from './wss-bridge';
export const {client,plan} = readIslands(document);
const i=client.identity;
const hours=client.trust.hours;
export const site = {
 name:i.businessName, legalName:i.businessName, phone:i.phoneDisplay, phoneTel:i.phoneTel.slice(4), email:/@mysite\.com$/i.test(i.email) ? '' : i.email,
 city:i.city,state:i.state,region:'',url:i.website.replace(/\/$/, ''),
 hours:hours && typeof hours === 'object' && 'text' in hours && typeof hours.text === 'string' ? hours.text : '',
 mapLink:client.trust.mapUrl, mapEmbed:'', reviewLink:'',
};
const icons:Record<string,string>={'commercial-concrete':'Building2','foundations-excavation':'Layers','flatwork-driveways':'Square','concrete-demolition':'Hammer','commercial-renovation':'Paintbrush','home-renovation':'Home','flooring-services':'LayoutGrid'};
export const services = client.services.map(s=>({...s,slug:s.href.slice(1),title:s.name,short:s.description,icon:icons[s.href.slice(1)] || 'Building2'}));
export const cities=client.trust.areas.map((name,index)=>({name,slug:name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `area-${index+1}`}));
export const gallery=client.media.filter(m=>m.role==='gallery').sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)).slice(0,12);
export const stats=client.trust.stats.filter((s):s is {label:string;value:number}=>!!s && typeof s==='object' && 'label' in s && typeof s.label==='string' && 'value' in s && typeof s.value==='number' && Number.isFinite(s.value));
export const serviceImages:Record<string,string>={}; // No service-to-photo association exists in the copied contract.
export const aboutImage=client.media.find(m=>m.role==='about')?.path || '';
export function richCopy(key:'home'|'about'|'contact'|'service-area') {
 const value=plan.content?.[key]; return typeof value==='string' ? value : '';
}
export function serviceNarrative(slug:string) {
 const s=services.find(s=>s.slug===slug);
 const rich=Array.isArray(plan.services) ? plan.services.find(x=>x.slug===slug && x.name===s?.name) : undefined;
 return typeof rich?.longDescMd==='string' ? rich.longDescMd : '';
}
