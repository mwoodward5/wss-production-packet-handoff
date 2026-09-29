import { CLIENT, PLAN, serviceSlug } from './wss';
export const slug = serviceSlug;
const rich = (name:string) => PLAN.services?.find(s=>s.name===name);
export const SITE = {
 name:CLIENT.identity.businessName,legalName:CLIENT.identity.businessName,
 tagline:CLIENT.hero.emphasis,shortDescription:CLIENT.hero.support,longDescription:CLIENT.content.about,
 url:CLIENT.identity.website.replace(/\/$/,''),phone:CLIENT.identity.phoneDisplay,phoneHref:CLIENT.identity.phoneTel,email:CLIENT.identity.email,
 city:CLIENT.identity.city,region:CLIENT.identity.state,regionName:CLIENT.identity.state,
 hoursNote:typeof CLIENT.trust.hours?.text==='string'?CLIENT.trust.hours.text:'',
 sameAs:CLIENT.trust.socials,serviceArea:CLIENT.trust.areas,
 services:CLIENT.services.map(s=>({slug:s.href?s.href.slice(1):slug(s.name),title:s.name,summary:s.description,features:[] as string[]})),
};
export const FAQS=CLIENT.content.faqs;
export const SERVICE_DETAILS=Object.fromEntries(SITE.services.map(s=>[s.slug,{
 h1:s.title,metaTitle:s.title+' · '+SITE.name,metaDescription:s.summary,intro:s.summary,
 paragraphs:(rich(s.title)?.longDescMd || '').split(/\n\n+/).filter(Boolean),bullets:s.features,faqs:[] as {q:string;a:string}[]
}]));
export const CITY_DETAILS=Object.fromEntries(SITE.serviceArea.map(city=>[slug(city),{
 city,slug:slug(city),metaTitle:city+' · '+SITE.name,metaDescription:SITE.name+' · '+city,h1:city,intro:SITE.name,
 paragraphs:[] as string[],neighborhoods:[] as string[],voiceQA:[] as {q:string;a:string}[]
}]));
export const CITY_SLUGS=Object.keys(CITY_DETAILS);
export const SERVICE_SLUGS=Object.keys(SERVICE_DETAILS);
