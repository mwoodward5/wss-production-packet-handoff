import { CLIENT } from './wss';
const i=CLIENT.identity;
export const BUSINESS={name:i.businessName,shortName:i.businessName,phoneDisplay:i.phoneDisplay,phoneTel:i.phoneTel.slice(4),email:i.email,city:i.city,region:i.state,url:i.website.replace(/\/$/,''),serviceArea:CLIENT.trust.areas};
export const NAP_LINE=`${i.city}, ${i.state}`;
