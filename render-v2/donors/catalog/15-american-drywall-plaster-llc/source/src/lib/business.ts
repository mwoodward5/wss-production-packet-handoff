import {client,serviceList} from './bridge';
const i=client.identity;
export const SITE_URL=i.website.replace(/\/$/,'');
export const business={name:i.businessName,shortName:i.businessName,tagline:client.hero.eyebrow,city:i.city,state:i.state,zip:'',region:client.trust.areas.join(', '),phone:i.phoneDisplay,phoneRaw:i.phoneTel.slice(4),email:i.email,websiteSource:i.website,googleMaps:client.trust.mapUrl,googleReview:'',facebook:'',angi:'',bbb:'',yelp:''};
export const socialProfiles=client.trust.socials;
export const serviceAreas=client.trust.areas;
export const services={drywall:serviceList('drywall').map(s=>s.description),plaster:serviceList('plaster').map(s=>s.description),interiorPainting:serviceList('painting').filter(s=>!/exterior/i.test(s.name)).map(s=>s.description),exteriorPainting:serviceList('painting').filter(s=>/exterior/i.test(s.name)).map(s=>s.description),flooring:[] as string[]};
export const testimonials=client.trust.reviews.map(r=>({name:r.author,quote:r.text,platform:new URL(r.sourceUrl).hostname,sourceUrl:r.sourceUrl}));
