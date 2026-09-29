import { DATA, serviceMedia, serviceSlug } from '@/wss/bridge';
export const SERVICE_PHOTOS:Record<string,string>=Object.fromEntries(DATA.services.flatMap(s=>{const slug=serviceSlug(s);const m=serviceMedia(slug);return m?[[slug,m.path]]:[];}));
export function servicePhoto(slug:string):string{return SERVICE_PHOTOS[slug]||'';}
