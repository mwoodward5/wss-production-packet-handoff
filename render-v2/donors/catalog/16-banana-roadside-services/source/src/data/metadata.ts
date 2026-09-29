import {client,serviceItems,european} from './bridge';
const safeJson=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
export function structuredData(route:string) {
  const base={'@context':'https://schema.org'};
  const service=(s:(typeof serviceItems)[number])=>({...base,'@type':'Service',name:s.name,description:s.description,provider:{'@type':'AutomotiveBusiness',name:client.identity.businessName,url:client.identity.website},areaServed:client.trust.areas});
  const values:unknown[]=route==='/' && client.content.faqs.length ? [{...base,'@type':'FAQPage',mainEntity:client.content.faqs.map(f=>({'@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))}] : route==='/services' ? serviceItems.map(service) : route==='/european-battery-services' && european ? [service(european)] : [];
  return values.map(value=>({type:'application/ld+json',children:safeJson(value)}));
}
