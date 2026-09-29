import { client } from './wss-bridge';
export const SERVICES = client.services.map(s => ({slug:s.href.slice(1),title:s.name,shortTitle:s.shortLabel,blurb:s.description,path:s.href}));
export type CityMeta = {slug:string; city:string; state:string; path:string};
export const CITIES: CityMeta[] = client.trust.areas.map((city,i) => ({slug:String(i),city,state:'',path:'/tree-service-'+city.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}));
export const EASTERN_CITIES: CityMeta[] = [];
