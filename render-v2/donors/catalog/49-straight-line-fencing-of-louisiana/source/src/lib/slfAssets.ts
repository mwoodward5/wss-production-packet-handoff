import { client, gallery as photos, hours } from './wssBridge'
export const heroImg = client?.hero.poster
export const logoImg = client?.identity.logoOnDark
export const ogImg = heroImg
export const gallery = photos
export const SLF = { name:client?.identity.businessName, short:client?.identity.businessName,phone:client?.identity.phoneDisplay,phoneHref:client?.identity.phoneTel,email:client?.identity.email,city:client ? client.identity.city+', '+client.identity.state : '',facebook:client?.trust.socials.find(s=>{const host=new URL(s).hostname;return host==='facebook.com' || host.endsWith('.facebook.com')}) || '',googleMaps:client?.trust.mapUrl,website:client?.identity.website,hours }
