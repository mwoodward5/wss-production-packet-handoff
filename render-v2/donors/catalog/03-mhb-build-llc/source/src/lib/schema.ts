import { business, services } from './business';
import { client } from './bridge';
const SITE = business.url;
export const orgSchema = {'@context':'https://schema.org','@type':'Organization','@id':`${SITE}/#organization`,name:business.name,url:SITE,telephone:business.phone,...(business.email?{email:business.email}:{}),logo:new URL(client.identity.logoOnLight,SITE).href};
export const websiteSchema = {'@context':'https://schema.org','@type':'WebSite','@id':`${SITE}/#website`,url:SITE,name:business.name,publisher:{'@id':`${SITE}/#organization`}};
export const localBusinessSchema = {...orgSchema,'@type':'HomeAndConstructionBusiness','@id':`${SITE}/#localbusiness`,address:{'@type':'PostalAddress',addressLocality:business.city,addressRegion:business.state},...(client.trust.areas.length?{areaServed:client.trust.areas}:{}),makesOffer:services.map(s=>({'@type':'Offer',itemOffered:{'@type':'Service',name:s.name,url:`${SITE}/services/${s.slug}`}}))};
export const breadcrumb = (items:{name:string;path:string}[]) => ({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((it,i)=>({'@type':'ListItem',position:i+1,name:it.name,item:`${SITE}${it.path}`}))});
export const serviceSchema = (name:string,description:string,slug:string) => ({'@context':'https://schema.org','@type':'Service',name,description,provider:{'@id':`${SITE}/#localbusiness`},url:`${SITE}/services/${slug}`,...(client.trust.areas.length?{areaServed:client.trust.areas}:{})});
export const faqSchema = (faqs:{q:string;a:string}[]) => ({'@context':'https://schema.org','@type':'FAQPage',mainEntity:faqs.map(f=>({'@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))});
