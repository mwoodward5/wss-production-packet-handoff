import contract from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';

export interface Service { name: string; shortLabel: string; description: string; href: string }
export interface Media { role: string; path: string; rank: number | null }
export interface ClientData {
  schema: string;
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[]; media: Media[];
  content: { serviceIntro: string; about: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; seasonalNote: string; values: { title: string; body: string }[]; faqs: { q: string; a: string }[] };
  trust: { hours: unknown; mapUrl: string; areas: string[]; badges: { label: string; sublabel: string; meta: string }[]; reviews: {author: string; text: string; sourceUrl: string; rating: number | null}[]; aggregate: {rating: number | null; count: number | null; sourceUrl: string} | null; socials: string[]; bookingUrl: string };
  design: { accent: string; paletteSource: string; fonts: string[] };
}
export interface SitePlan {
  schema: 'wss-rich-site-plan-v1';
  pages?: { slug: string }[];
  services?: { name: string; slug: string; shortDesc?: string; longDescMd?: string }[];
  content?: Record<string, string>;
  localPresence?: { mapAndDirections?: { googleBusinessUrl?: string; googlePlaceId?: string } };
}
export function bindSite(input: unknown, planInput?: unknown) {
  const client = contract.normalize(input) as ClientData;
  const plan = (planInput || null) as SitePlan | null;
  if (plan && plan.schema !== 'wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
  if (plan?.content && (typeof plan.content !== 'object' || Array.isArray(plan.content) || Object.values(plan.content).some(v => typeof v !== 'string'))) throw new Error('site_plan_content_invalid');
  if (plan?.services && !Array.isArray(plan.services)) throw new Error('site_plan_services_invalid');
  // CSD v2 has no category field. Conservative runtime guard; mapper enforces exact category.
  if (!client.services.some(s => /\b(auto|automotive|vehicle|car|brake|transmission|engine|oil change|tire|tyre)\b/i.test(s.name))) throw new Error('automotive_trade_evidence_required');
  if (client.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(client.identity.email)) throw new Error('email_invalid');
  const routes = client.services.map(s => s.href).filter(Boolean);
  if (new Set(routes).size !== routes.length) throw new Error('service_routes_duplicate');
  // Rich service copy may enrich only an already certified service and route.
  const serviceCopy = client.services.map(service => {
    const rich = plan?.services?.find(s => s.name?.toLowerCase() === service.name.toLowerCase());
    if (rich && '/' + rich.slug !== service.href) throw new Error('site_plan_service_route_mismatch');
    return {
      ...service,
      summary: typeof rich?.shortDesc === 'string' && rich.shortDesc.trim() ? rich.shortDesc.trim() : service.description,
      detail: typeof rich?.longDescMd === 'string' && rich.longDescMd.trim() ? rich.longDescMd.trim() : service.description,
    };
  });
  const ranked = (roles: string[]) => client.media.filter(m => roles.includes(m.role)).sort((a,b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  const hours = client.trust.hours;
  const hoursText = hours && typeof hours === 'object' && 'text' in hours && typeof hours.text === 'string' ? hours.text : '';
  const place = plan?.localPresence?.mapAndDirections?.googlePlaceId;
  const mapEmbed = typeof place === 'string' && /^[A-Za-z0-9_-]{10,250}$/.test(place) ? 'https://www.google.com/maps?q=' + encodeURIComponent('place_id:' + place) + '&output=embed' : '';
  const copy = {
    about: plan?.content?.about?.trim() || client.content.about,
    contact: plan?.content?.contact?.trim() || client.content.ctaBody,
    serviceArea: plan?.content?.['service-area']?.trim() || '',
  };
  return { client, plan, copy, serviceCopy, gallery: ranked(['gallery']).slice(0,9), portraits: ranked(['about','people']).slice(0,2), hoursText, mapEmbed, location: client.identity.city + ', ' + client.identity.state };
}
export type Site = ReturnType<typeof bindSite>;
export function readSite(): Site {
  const read = (id: string, required = false) => {
    const node = document.getElementById(id);
    if (!node) { if (required) throw new Error('client_data_missing'); return null; }
    if (node.tagName !== 'SCRIPT' || node.getAttribute('type') !== 'application/json') throw new Error('data_island_invalid');
    return JSON.parse(node.textContent || 'null');
  };
  return bindSite(read('wss-client-data', true), read('wss-site-plan'));
}
export function applyBrand(client: ClientData) {
  document.title = client.identity.businessName + ' | ' + client.identity.city + ', ' + client.identity.state;
  // Explicit accent role only. The unroled fonts array cannot select heading/body roles.
  document.documentElement.style.removeProperty('--accent');
  if (/^#[0-9a-f]{6}$/i.test(client.design.accent) && client.design.paletteSource !== 'donor-default' && client.design.paletteSource !== 'approved-donor-fallback') {
    const rgb = client.design.accent.slice(1).match(/../g)!.map(x => parseInt(x,16)/255);
    const max = Math.max(...rgb), min = Math.min(...rgb), d = max-min, l = (max+min)/2;
    let h = 0; if (d) { const [r,g,b] = rgb; h = max===r ? ((g-b)/d+6)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4; }
    document.documentElement.style.setProperty('--accent', `${h*60} ${d ? d/(1-Math.abs(2*l-1))*100 : 0}% ${l*100}%`);
  }
}
