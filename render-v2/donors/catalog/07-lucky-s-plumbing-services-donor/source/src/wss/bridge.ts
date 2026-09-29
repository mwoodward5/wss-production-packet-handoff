import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';

export type Service = { name: string; shortLabel: string; description: string; href: string };
export type Client = {
  schema: 'wss-client-site-data-v2';
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[];
  media: { role: string; path: string; rank: number | null }[];
  content: { serviceIntro: string; about: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title: string; body: string}[]; faqs: {q: string; a: string}[] };
  trust: { hours: unknown; areas: string[]; badges: {label: string; sublabel: string; meta: string}[]; aggregate: {rating: number | null; count: number | null; sourceUrl: string} | null; reviews: {author: string; text: string; sourceUrl: string}[]; mapUrl: string; bookingUrl: string; socials: string[] };
  design: { paletteSource: string; accent: string; fonts: string[] };
};
export type SitePlan = { schema: 'wss-rich-site-plan-v1'; content?: Record<string, string>; pages?: unknown[]; services?: unknown[]; visual?: Record<string, unknown>; localPresence?: Record<string, unknown> };
export type SiteModel = ReturnType<typeof buildSite>;
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const text = (x: unknown) => typeof x === 'string' ? x.trim() : '';
export function accentHsl(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return '';
  const [r,g,b] = [1,3,5].map(i => parseInt(value.slice(i,i+2),16)/255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min;
  const light = (max+min)/2;
  const saturation = delta ? delta/(1-Math.abs(2*light-1)) : 0;
  const hue = !delta ? 0 : max === r ? ((g-b)/delta+6)%6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4;
  return `${(hue*60).toFixed(3)} ${(saturation*100).toFixed(3)}% ${(light*100).toFixed(3)}%`;
}
export function hoursRows(raw: unknown): { d: string; h: string }[] {
  const data = record(raw);
  if (text(data.text)) return [{d: 'Hours', h: text(data.text)}];
  if (Array.isArray(raw)) return raw.flatMap(x => {
    const r = record(x); const d = text(r.day) || text(r.days);
    const h = text(r.hours) || text(r.display) || text(r.time) || (text(r.open) && text(r.close) ? `${r.open} – ${r.close}` : '');
    return d && h ? [{d,h}] : [];
  });
  return Object.entries(data).filter(([d,h]) => /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(d) && text(h)).map(([d,h]) => ({d,h:text(h)}));
}
export function buildSite(raw: unknown, rawPlan?: unknown) {
  const client = normalize(raw) as Client;
  const p = record(rawPlan);
  if (rawPlan != null && p.schema !== 'wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
  const plan = rawPlan == null ? null : p as SitePlan;
  // The normalized contract has no trade field. Trade enforcement lives in mapDonor.
  const photos = client.media.filter(m => m.role === 'gallery').map((m, i) => ({...m, order:i})).sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.order-b.order).map(m => ({src:m.path, alt:`${client.identity.businessName} gallery image`}));
  const email = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(client.identity.email) ? client.identity.email : '';
  return {
    client, plan, email, photos, dispatch: photos[0] || null,
    accent: client.design.paletteSource !== 'donor-default' && client.design.paletteSource !== 'approved-donor-fallback' ? accentHsl(client.design.accent) : '',
    contactCopy: text(plan?.content?.contact).replace(/^#+[^\n]*\n+/, '').trim(),
    hours: hoursRows(client.trust.hours),
    area: [client.identity.city,client.identity.state].join(', '),
    badges: client.trust.badges.slice(0,3).map(b => ({title:b.label,desc:[b.sublabel,b.meta].filter(Boolean).join(' · ')})),
    proofCards: [
      ...client.trust.badges.map(b => ({title:b.label,desc:[b.sublabel,b.meta].filter(Boolean).join(' · '),sourceUrl:''})),
      ...client.trust.reviews.map(r => ({title:r.author,desc:r.text,sourceUrl:r.sourceUrl})),
    ].slice(0,3),
    // Reuse the numbered matrix for certified values, not invented process promises.
    steps: client.content.values.map((v,i) => ({n:String(i+1).padStart(2,'0'),title:v.title,desc:v.body})),
    // SMS capability has no certified contract field.
    smsHref: '',
  };
}
export function readSite(doc: Document = document): SiteModel | null {
  try {
    const raw = doc.getElementById('wss-client-data')?.textContent;
    if (!raw) return null;
    const plan = doc.getElementById('wss-site-plan')?.textContent;
    return buildSite(JSON.parse(raw), plan ? JSON.parse(plan) : undefined);
  } catch { return null; }
}
