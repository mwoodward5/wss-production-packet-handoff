import { client, sitePlan, slug, paragraphs, serviceHref } from '@/lib/wss';
export const SITE = {
  name: client.identity.businessName, domain: new URL(client.identity.website).hostname,
  url: client.identity.website.replace(/\/$/, ''), phone: client.identity.phoneTel.slice(4),
  phoneDisplay: client.identity.phoneDisplay, phoneTel: client.identity.phoneTel,
  city: client.identity.city, region: client.identity.state,
};
export type CitySlug = string;
export type ProgramSlug = string;
export const CITIES = client.trust.areas.map(name => ({
  slug: slug(name), name, drive: '', minutes: '',
  intro: `${SITE.name} · ${name}`, paragraphs: [] as string[], landmarks: [] as string[],
  voiceQuestion: '', voiceAnswer: '',
}));
export const PROGRAMS = client.services.map(service => {
  const rich = sitePlan?.services?.find(s => s.name === service.name);
  const parts = paragraphs(rich?.longDescMd || service.description);
  return {slug: slug(service.name), name: service.name, shortName: service.shortLabel,
    href: service.href, tagline: '', intro: parts[0] || service.description,
    paragraphs: parts.slice(1), outcomes: [] as string[], whoFor: '', voiceQuestion: '', voiceAnswer: ''};
});
export const HUB_PATH = '/service-areas';
export const cityPath = (s: string) => `/flight-school/${s}`;
export const programPath = (s: string) => `/programs/${s}`;
