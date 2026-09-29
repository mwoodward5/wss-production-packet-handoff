import { CLIENT, SITE, SERVICES } from './wss';
export const BUSINESS = {
 name:CLIENT.identity.businessName,shortName:CLIENT.identity.businessName,
 phone:CLIENT.identity.phoneDisplay,phoneE164:CLIENT.identity.phoneTel.slice(4),email:CLIENT.identity.email,
 city:CLIENT.identity.city,state:CLIENT.identity.state,region:CLIENT.trust.areas.join(' · '),
 domain:new URL(CLIENT.identity.website).host,hours:SITE.hoursText,hoursShort:SITE.hoursText,
 longDescription:CLIENT.content.about,services:SERVICES.slice(0,4),additionalServices:SERVICES.slice(4).map(s=>s.name),
 founded:CLIENT.identity.founded,
};
export const NAV = [
 {to:'/',label:'Home'},{to:'/services',label:'Services'},
 ...(CLIENT.trust.areas.length?[{to:'/service-areas',label:'Service Areas'}]:[]),
 {to:'/about',label:'About'},...(SITE.gallery.length?[{to:'/gallery',label:'Gallery'}]:[]),
 ...(CLIENT.content.faqs.length?[{to:'/faq',label:'FAQ'}]:[]),{to:'/contact',label:'Contact'}
];
