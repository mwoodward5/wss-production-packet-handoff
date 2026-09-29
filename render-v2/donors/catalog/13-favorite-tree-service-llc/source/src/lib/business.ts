import { client } from './wss-bridge';
export const BUSINESS = {
 name: client.identity.businessName, shortName: client.identity.businessName,
 phoneRaw: client.identity.phoneTel.slice(4), phoneDisplay: client.identity.phoneDisplay,
 email: client.identity.email, city: client.identity.city, region: client.identity.state,
 domain: new URL(client.identity.website).host,
 serviceAreas: client.trust.areas,
 foundingDate: client.identity.founded ? String(client.identity.founded) : '',
};
export const TEL_HREF = client.identity.phoneTel;
// SMS support is not certified by CSD: retain the secondary contact slot as mail/contact.
export const SMS_HREF = client.identity.email ? 'mailto:' + client.identity.email : '/contact';
export const REVIEW_URL = client.trust.aggregate?.sourceUrl || client.trust.reviews[0]?.sourceUrl || '';
export const MAPS_LINK = client.trust.mapUrl;
export const TESTIMONIALS = client.trust.reviews.map(t => ({name:t.author, text:t.text, rating:t.rating, sourceUrl:t.sourceUrl}));
export const localBusinessJsonLd = {
 '@context':'https://schema.org', '@type':'LocalBusiness', '@id':client.identity.website+'#business',
 name:BUSINESS.name, url:client.identity.website, telephone:BUSINESS.phoneDisplay,
 ...(BUSINESS.email ? {email:BUSINESS.email} : {}),
 logo:client.identity.logoOnLight, image:client.hero.poster,
 address:{'@type':'PostalAddress',addressLocality:BUSINESS.city,addressRegion:BUSINESS.region},
 ...(BUSINESS.serviceAreas.length ? {areaServed:BUSINESS.serviceAreas} : {}),
 ...(BUSINESS.foundingDate ? {foundingDate:BUSINESS.foundingDate} : {}),
 ...(MAPS_LINK ? {hasMap:MAPS_LINK} : {}), sameAs:client.trust.socials,
 ...(client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null ? {aggregateRating:{'@type':'AggregateRating',ratingValue:client.trust.aggregate.rating,reviewCount:client.trust.aggregate.count}} : {}),
};
