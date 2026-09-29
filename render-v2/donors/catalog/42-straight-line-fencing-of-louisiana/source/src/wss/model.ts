import { normalize } from './client-contract.cjs';

export type Service = { name: string; shortLabel: string; description: string; href: string };
type Media = { role: string; path: string; rank: number | null };
export type Client = {
  schema: string;
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[]; media: Media[];
  content: { about: string; serviceIntro: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: { title: string; body: string }[]; faqs: { q: string; a: string }[] };
  trust: { badges: { label: string }[]; stats: unknown[]; aggregate: { rating: number | null; count: number | null; sourceUrl: string } | null; hours: unknown; areas: string[]; mapUrl: string; socials: string[] };
  design: { accent: string; paletteSource: string; fonts: string[] };
};
export type SitePlan = {
  schema?: string;
  pages?: { slug: string }[];
  services?: { name: string; slug: string; longDescMd?: string }[];
  content?: { home?: string; about?: string; contact?: string; 'service-area'?: string };
  visual?: Record<string, unknown>;
  localPresence?: Record<string, unknown>;
};
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const copy = (x: unknown) => typeof x === 'string' ? x.trim() : '';
// Only fields actually emitted by the copied universal adapter are consumed.
// Reject malformed consumed fields before React mounts; opaque plans stay unused.
function readPlan(raw: unknown): SitePlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('donor_site_plan_object');
  const p = raw as SitePlan;
  if (p.schema && p.schema !== 'wss-rich-site-plan-v1') throw new Error('donor_site_plan_schema');
  for (const key of ['pages', 'services'] as const) {
    if (p[key] !== undefined && !Array.isArray(p[key])) throw new Error('donor_site_plan_' + key);
  }
  for (const page of p.pages || []) {
    if (!page || typeof page.slug !== 'string') throw new Error('donor_site_plan_page');
  }
  for (const service of p.services || []) {
    if (!service || typeof service.name !== 'string' || typeof service.slug !== 'string' ||
      (service.longDescMd !== undefined && typeof service.longDescMd !== 'string')) throw new Error('donor_site_plan_service');
  }
  if (p.content !== undefined) {
    if (!p.content || typeof p.content !== 'object' || Array.isArray(p.content)) throw new Error('donor_site_plan_content');
    for (const key of ['home', 'about', 'contact', 'service-area'] as const) {
      if (p.content[key] !== undefined && typeof p.content[key] !== 'string') throw new Error('donor_site_plan_copy');
    }
  }
  return p;
}
export function makeSite(raw: unknown, rawPlan: unknown = {}) {
  const c = normalize(raw) as Client;
  const p = readPlan(rawPlan);
  // CSD v2 drops category. Require an explicit fence service as the minimum runtime trade guard.
  // Authoritative category rejection happens in mapDonor before normalization.
  if (!c.services.some(s => /\bfenc(?:e|es|ing)\b/i.test(s.name))) throw new Error('donor_wrong_trade');
  if (c.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.identity.email)) throw new Error('donor_email_invalid');
  const hrefs = c.services.map(s => s.href).filter(Boolean);
  if (new Set(hrefs).size !== hrefs.length) throw new Error('donor_service_route_duplicate');
  const ordered = c.media.map((m, i) => ({ ...m, order: i })).sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order));
  const gallery = ordered.filter(m => m.role === 'gallery').slice(0, 10).map((m, i) => ({ src: { url: m.path }, caption: 'Project photo ' + (i + 1), tall: [0, 3, 7].includes(i) }));
  const stats = c.trust.stats.flatMap(value => {
    const s = object(value);
    return typeof s.label === 'string' && (typeof s.value === 'string' || typeof s.value === 'number') ? [{ n: String(s.value), l: s.label }] : [];
  });
  if (c.trust.aggregate?.rating != null && c.trust.aggregate.count != null) stats.push({ n: String(c.trust.aggregate.rating), l: `${c.trust.aggregate.count} reviews` });
  const hours = copy(object(c.trust.hours).text);
  const css: Record<string, string> = {};
  // accent is the only explicit certified palette role in the copied CSD contract.
  if (c.design.paletteSource !== 'donor-default' && c.design.paletteSource !== 'approved-donor-fallback' && /^#[\da-f]{6}$/i.test(c.design.accent)) {
    for (const role of ['--brass', '--hero-brass', '--primary', '--ring']) css[role] = c.design.accent;
  }
  return {
    client: c, plan: p, identity: c.identity, hero: c.hero, content: c.content, css,
    services: c.services.map((s, i) => ({ ...s, idx: String(i + 1).padStart(2, '0'), body: s.description, img: null as { url: string } | null })),
    gallery, craftImage: ordered.find(m => m.role === 'about')?.path || '',
    process: [] as { n: string; t: string; b: string }[],
    faqs: c.content.faqs, chips: c.trust.badges.map(b => b.label), stats,
    hours, areas: c.trust.areas, mapUrl: c.trust.mapUrl, socials: c.trust.socials,
    localCopy: copy(p.content?.['service-area']),
  };
}
export type Site = ReturnType<typeof makeSite>;
export function resolveRoute(site: Site, path: string) {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/') return { kind: 'home' as const };
  const service = site.client.services.find(s => s.href === normalized);
  if (service) {
    const rich = site.plan.services?.find(s =>
      s.name.trim().toLowerCase() === service.name.toLowerCase() &&
      '/' + s.slug.replace(/^\/+|\/+$/g, '') === service.href);
    return { kind: 'service' as const, title: service.name, body: copy(rich?.longDescMd) ? rich!.longDescMd! : service.description };
  }
  const section = normalized.slice(1);
  const declared = (site.plan.pages || []).some(p => copy(object(p).slug).replace(/^\/+|\/+$/g, '') === section);
  if (declared && ['about', 'contact', 'services', 'service-area', 'gallery'].includes(section)) {
    if (section === 'gallery' && !site.gallery.length) return { kind: 'missing' as const };
    if (section === 'service-area' && !site.areas.length && !site.mapUrl && !site.localCopy && !site.socials.length) return { kind: 'missing' as const };
    return { kind: 'section' as const, section: section as 'about' | 'contact' | 'services' | 'service-area' | 'gallery' };
  }
  return { kind: 'missing' as const };
}
