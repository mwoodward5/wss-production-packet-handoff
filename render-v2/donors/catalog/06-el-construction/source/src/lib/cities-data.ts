import {cities} from './site';
export const citiesData=cities.map(c=>({...c,blurb:'',distanceFromHQ:'',intro:'',body:[] as string[],neighborhoods:[] as string[],faqs:[] as {q:string;a:string}[]}));
export const getCityBySlug=(slug:string)=>citiesData.find(c=>c.slug===slug);
