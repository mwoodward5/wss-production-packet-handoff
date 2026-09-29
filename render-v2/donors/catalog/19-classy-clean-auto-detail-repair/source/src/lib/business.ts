import { getSite, hoursText } from './wss';
export const BUSINESS = {
 get name(){return getSite().identity.businessName}, get shortName(){return getSite().identity.businessName},
 get phone(){return getSite().identity.phoneDisplay}, get phoneHref(){return getSite().identity.phoneTel},
 get email(){return getSite().identity.email}, get city(){return getSite().identity.city}, get state(){return getSite().identity.state},
 get hours(){return hoursText()}, get serviceAreas(){return getSite().trust.areas}, get services(){return getSite().services.map(s=>s.name)},
 get googleMapsUrl(){return getSite().trust.mapUrl}
};
