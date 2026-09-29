import {client,sitePlan} from '@/wss/bridge';
export type FaqItem={question:string;answer:string};
export type SeoPage={slug:string;path:string;title:string;description:string;h1:string;eyebrow:string;primaryKeyword:string;type:string;sections:{heading:string;body:string[]}[];faqs:FaqItem[]};
export const faqs=client.content.faqs.map(f=>({question:f.q,answer:f.a}));
function sections(markdown:string,heading:string){return markdown.split(/\n(?=##? )/).map(part=>{const lines=part.trim().split('\n');const h=lines[0]?.startsWith('#')?lines.shift()!.replace(/^#+ /,''):heading;return {heading:h,body:lines.join('\n').split(/\n\n+/).filter(Boolean)}}).filter(s=>s.body.length)}
function page(path:string,h1:string,description:string,type:string,body:string,faq:FaqItem[]=[]):SeoPage{return {slug:path.slice(1)||'home',path,title:h1,description,h1,eyebrow:client.identity.businessName,primaryKeyword:h1,type,sections:sections(body,h1),faqs:faq}}
function servicePage(service:typeof client.services[number]):SeoPage {
 const body=sections(service.description,service.name);
 const description=body[0]?.body.shift()||'';
 return {...page(service.href,service.name,description,'category',''),sections:body.filter(section=>section.body.length)};
}
export const seoPages:SeoPage[]=[page('/',client.hero.line1,client.hero.support,'home','',faqs),...client.services.map(servicePage),page('/about','About '+client.identity.businessName,'','about',sitePlan.content?.about||client.content.about),page('/contact','Contact '+client.identity.businessName,'','contact',sitePlan.content?.contact||''),...(faqs.length?[page('/faq','Frequently asked questions','','faq','',faqs)]:[]),...(client.trust.areas.length?[page('/locations','Service area','','location',sitePlan.content?.['service-area']||client.trust.areas.join('\n\n'))]:[])];
if(client.services.some(s=>!s.href)||new Set(seoPages.map(p=>p.path)).size!==seoPages.length)throw Error('donor_route_collision_or_missing');
export const pagesByPath=new Map(seoPages.map(p=>[p.path,p]));
export const pagesBySlug=new Map(seoPages.map(p=>[p.slug,p]));
export const getRelatedPages=(page:SeoPage)=>seoPages.filter(p=>p.path!==page.path&&p.type==='category');
