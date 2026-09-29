import { WSS } from '@/wss/bridge';
function JsonLd({data}:{data:unknown}){return <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(data).replace(/</g,'\\u003c')}}/>;}
export function LocalBusinessSchema(){return <JsonLd data={{'@context':'https://schema.org','@type':'LocalBusiness',name:WSS.identity.businessName,url:WSS.identity.website,telephone:WSS.identity.phoneTel.slice(4),...(WSS.identity.email?{email:WSS.identity.email}:{}),areaServed:WSS.trust.areas}}/>;}
export function OrganizationSchema(){return null;}
export function WebSiteSchema(){return null;}
export function SpeakableSchema(_props:{url:string}){return null;}
export function BreadcrumbSchema({items}:{items:{name:string;url:string}[]}){return <JsonLd data={{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:x.url}))}}/>;}
export function FAQSchema({items}:{items:{q:string;a:string}[]}){if(!items.length)return null;return <JsonLd data={{'@context':'https://schema.org','@type':'FAQPage',mainEntity:items.map(x=>({'@type':'Question',name:x.q,acceptedAnswer:{'@type':'Answer',text:x.a}}))}}/>;}
