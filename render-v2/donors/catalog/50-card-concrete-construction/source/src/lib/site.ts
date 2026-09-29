import { readIslands } from './wss-bridge';
export const BINDING = readIslands(document);
export const CLIENT = BINDING.client;
export const PLAN = BINDING.plan;
export const SITE = {
  name: CLIENT.identity.businessName, shortName: CLIENT.identity.businessName,
  phone: CLIENT.identity.phoneDisplay, phoneHref: CLIENT.identity.phoneTel,
  email: CLIENT.identity.email, mailtoHref: CLIENT.identity.email ? 'mailto:' + CLIENT.identity.email : undefined,
  address: {city: CLIENT.identity.city, region: CLIENT.identity.state, street: '', postal: ''},
  hours: typeof CLIENT.trust.hours?.text === 'string' ? CLIENT.trust.hours.text : '',
  nearbyCities: CLIENT.trust.areas,
};
