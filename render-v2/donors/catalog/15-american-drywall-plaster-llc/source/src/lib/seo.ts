import {client} from './bridge';
import {business,SITE_URL,serviceAreas,socialProfiles} from './business';
export function ldLocalBusiness(){return {'@context':'https://schema.org','@type':'LocalBusiness',name:business.name,url:SITE_URL,telephone:business.phone,email:business.email||undefined,logo:client.identity.logoOnLight,address:{'@type':'PostalAddress',addressLocality:business.city,addressRegion:business.state},areaServed:serviceAreas,sameAs:socialProfiles};}
export function ldBreadcrumbs(c:{name:string;path:string}[]){return {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:c.map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:SITE_URL+x.path}))};}
export function ldFAQ(f:{q:string;a:string}[]){return {'@context':'https://schema.org','@type':'FAQPage',mainEntity:f.map(x=>({'@type':'Question',name:x.q,acceptedAnswer:{'@type':'Answer',text:x.a}}))};}
export function jsonLdScript(data:unknown){return {type:'application/ld+json' as const,children:JSON.stringify(data).replace(/</g,'\\u003c')};}
export function pageMeta(o:{title:string;description:string;path:string;ogImage?:string}){return [{title:o.title},{name:'description',content:o.description}];}
