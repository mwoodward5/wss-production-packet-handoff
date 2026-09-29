import {client,site} from './site';
export const localBusinessSchema={'@context':'https://schema.org','@type':'LocalBusiness',name:site.name,url:site.url,telephone:client.identity.phoneTel.slice(4),...(site.email ? {email:site.email} : {}),address:{'@type':'PostalAddress',addressLocality:site.city,addressRegion:site.state}};
export function faqSchema(items:{q:string;a:string}[]){return {'@context':'https://schema.org','@type':'FAQPage',mainEntity:items.map(x=>({'@type':'Question',name:x.q,acceptedAnswer:{'@type':'Answer',text:x.a}}))};}
export function breadcrumbSchema(items:{name:string;url:string}[]){return {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:x.url}))};}
export function webPageSchema(name:string,description:string,url:string){return {'@context':'https://schema.org','@type':'WebPage',name,description,url};}
export const cityLocalBusinessSchema=()=>localBusinessSchema;
export function jsonLd(value:unknown){return {type:'application/ld+json',children:JSON.stringify(value).replace(/</g,'\\u003c')};}
