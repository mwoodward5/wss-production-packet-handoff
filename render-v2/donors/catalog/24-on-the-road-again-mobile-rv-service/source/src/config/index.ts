import { WSS, PLAN } from '@/wss/bridge';
export const CLIENT={businessName:WSS.identity.businessName,phone:WSS.identity.phoneDisplay,phoneE164:WSS.identity.phoneTel.slice(4),email:WSS.identity.email,city:WSS.identity.city,region:WSS.identity.state,serviceAreaLabel:WSS.trust.areas.join(' · '),shortDescription:WSS.hero.support};
export const SERVICES=WSS.services.map((s,i)=>({...s,slug:s.href.slice(1)||`service-${i+1}`,shortDesc:s.description.split(/\n\s*\n/)[0],icon:'Wrench',details:(PLAN?.services?.find(x=>x.name===s.name)?.longDescMd || '').split('\n').filter(x=>/^[-*]\s+/.test(x)).map(x=>x.replace(/^[-*]\s+/,''))}));
export const SPECIALTY_SERVICES: {name:string;icon:string;blurb:string}[]=[];
export const TRUST={stats:WSS.trust.stats.filter((s):s is {label:string;value:string|number}=>!!s&&typeof s==='object'&&'label' in s&&typeof s.label==='string'&&'value' in s&&['string','number'].includes(typeof s.value)),badges:WSS.trust.badges,manufacturerTraining:[] as string[]};
export const SOCIAL={googleMaps:WSS.trust.mapUrl};
export const FEATURES={themeToggle:true,mobileCallBar:true};
export const absoluteUrl=(path:string)=>new URL(path,WSS.identity.website).href;
