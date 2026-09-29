import { DATA, PLAN, serviceMedia, serviceSlug } from "@/wss/bridge";
export interface ServiceFAQ { q: string; a: string; }

export interface Service {
  slug: string;
  name: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  shortDesc: string;
  longDescMd: string;
  icon: string;
  imageSlot: string;
  gallerySlots: string[];
  faqs: ServiceFAQ[];
  schemaType?: string;
  priceRange?: string;
  durationEstimate?: string;
  route: string;
}

export const SERVICES:Service[]=DATA.services.map(s=>{
  const slug=serviceSlug(s);
  const rich=PLAN?.services.find(r=>r.slug===slug&&(!r.name||r.name===s.name));
  const copy=(value:unknown,fallback:string)=>typeof value==='string'&&value.trim()?value:fallback;
  const faqs=Array.isArray(rich?.faqs)?rich.faqs.filter(f=>f&&typeof f.q==='string'&&typeof f.a==='string'&&f.q.trim()&&f.a.trim()):[];
  return {slug,route:s.href||`/services#${slug}`,name:s.name,h1:copy(rich?.h1,s.name),metaTitle:copy(rich?.metaTitle,`${s.name} - ${DATA.identity.businessName}`),metaDescription:copy(rich?.metaDescription,s.description),shortDesc:copy(rich?.shortDesc,s.description),longDescMd:copy(rich?.longDescMd,s.description),icon:'TreeDeciduous',imageSlot:serviceMedia(slug)?.path||'',gallerySlots:[],faqs,schemaType:'Service'};
});
export function getService(slug:string):Service|undefined{return SERVICES.find(s=>s.slug===slug);}
