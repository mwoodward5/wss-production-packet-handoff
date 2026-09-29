import { getClient, getSitePlan, clientPhoto } from './wss-client';
const client = getClient();
const plan = getSitePlan();
const rawHours = client.trust.hours;
const hoursText = rawHours && typeof rawHours === 'object' && 'text' in rawHours
  && typeof rawHours.text === 'string' ? rawHours.text : '';
export const BUSINESS = {
  name: client.identity.businessName,
  shortName: client.identity.businessName,
  // No founder identity or credentials are present in the normalized contract.
  founder: '', founderTitle: '',
  phone: client.identity.phoneDisplay, phoneHref: client.identity.phoneTel,
  founderPhone: client.identity.phoneDisplay, founderPhoneHref: client.identity.phoneTel,
  email: client.identity.email, city: client.identity.city, state: client.identity.state,
  zip: '', region: [client.identity.city, client.identity.state].filter(Boolean).join(', '),
  serviceArea: client.trust.areas.join(', '),
  hours: hoursText ? [{ day: 'Opening hours', hours: hoursText }] : [],
  primaryServiceAreas: [...client.trust.areas],
  logo: client.identity.logoOnLight, logoOnDark: client.identity.logoOnDark,
};
type RichService = { name?: string; longDescMd?: string; shortDesc?: string };
const richServices: RichService[] = Array.isArray(plan?.services) ? plan.services : [];
function bullets(markdown: string): string[] {
  return markdown.split(/\r?\n/).filter(line => /^\s*[-*]\s+/.test(line))
    .map(line => line.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
}
export const SERVICES = client.services.map((service, index) => {
  const rich = richServices.find(item => item.name === service.name);
  const description = rich?.longDescMd || service.description;
  return {
    slug: service.href.replace(/^\//, ''),
    href: '/services/' + service.href.replace(/^\//, ''), name: service.name, short: service.description,
    imagePath: clientPhoto('gallery', index),
    img: 'client-' + index,
    bullets: bullets(description),
    body: description,
    // The current rich contract has global FAQ facts, not per-service attribution.
    faqs: [] as { q: string; a: string }[],
  };
});
export type Service = (typeof SERVICES)[number];
export const FAQS = [...client.content.faqs];
export const URGENCY_OPTIONS = [
  { id: 'emergency', label: 'Urgent enquiry',
    detail: 'Call to discuss availability. Do not rely on this form for emergency response.', accent: 'red' },
  { id: 'soon', label: 'Upcoming project', detail: 'Ask the company about scheduling.', accent: 'amber' },
  { id: 'planned', label: 'Planned project', detail: 'Describe the work you have in mind.', accent: 'gold' },
  { id: 'estimate', label: 'Request an estimate', detail: 'Discuss scope and pricing directly.', accent: 'ink' },
] as const;
