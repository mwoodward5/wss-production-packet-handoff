import { normalize } from '../../../WSS-CONTRACTS/contracts/client-site-data.cjs';
import type { ClientData, SitePlan } from './wss-types';
export function bindClient(raw: unknown, rawPlan?: unknown) {
  const client = normalize(raw) as ClientData;
  // CSD has no category field. Require positive evidence from the certified catalog.
  if (!client.services.some(s => /\b(concrete|screed|flatwork|flat work|demolition)\b/i.test(s.name))) throw Error('concrete_wrong_trade');
  if (client.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(client.identity.email)) throw Error('concrete_email_invalid');
  const plan = rawPlan == null ? null : rawPlan as SitePlan;
  if (plan && plan.schema !== 'wss-rich-site-plan-v1') throw Error('concrete_plan_schema_invalid');
  if (plan?.services && (!Array.isArray(plan.services) || plan.services.some(s => !s || typeof s.name !== 'string' || (s.shortDesc != null && typeof s.shortDesc !== 'string') || (s.longDescMd != null && typeof s.longDescMd !== 'string')))) throw Error('concrete_plan_services_invalid');
  if (plan?.services && new Set(plan.services.map(s => s.name)).size !== plan.services.length) throw Error('concrete_plan_services_ambiguous');
  if (plan?.content != null && (typeof plan.content !== 'object' || Array.isArray(plan.content) || Object.values(plan.content).some(v => typeof v !== 'string'))) throw Error('concrete_plan_content_invalid');
  // Only documented visitor-copy keys are bound; opaque pages/visual objects are not inferred.
  const sectionCopy = {
    area: visitorBody(plan?.content?.['service-area']),
    contact: visitorBody(plan?.content?.contact),
  };
  const hrefs = client.services.map(s => s.href).filter(Boolean);
  if (new Set(hrefs).size !== hrefs.length || hrefs.some(h => ['/trust', '/sitemap.xml', '/api/public/quote'].includes(h))) throw Error('concrete_service_route_collision');
  const services = client.services.map((s, i) => {
    const rich = plan?.services?.find(x => x.name === s.name);
    return { slug: `service-${i + 1}`, href: s.href, name: s.name, blurb: rich?.shortDesc?.trim() || s.description,
      details: rich?.longDescMd || '', ideal: '', icon: (/screed/i.test(s.name) ? 'screed' : /stamp/i.test(s.name) ? 'stamp' : /demolition/i.test(s.name) ? 'demo-wall' : /flat/i.test(s.name) ? 'flat' : 'slab') as 'screed' | 'stamp' | 'demo-wall' | 'flat' | 'slab' };
  });
  const gallery = client.media.filter(m => m.role === 'gallery').slice(0, 9).map((m, i) => ({url: m.path, alt: `${client.identity.businessName} — project image ${i + 1}`, caption: ''}));
  const geo = plan?.localPresence?.mapAndDirections?.geo;
  const coordinates = geo?.verified === true && geo.schemaAllowed === true && typeof geo.lat === 'number' && typeof geo.lng === 'number' && Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && Math.abs(geo.lat) <= 90 && Math.abs(geo.lng) <= 180 ? {lat: geo.lat, lng: geo.lng} : null;
  return { client, plan, services, gallery, coordinates, sectionCopy,
    brand: /^#[\da-f]{6}$/i.test(client.design.accent) && !/fallback|donor-default/i.test(client.design.paletteSource) ? client.design.accent : '' };
}
function visitorBody(value?: string) {
  return (value || '').replace(/\r\n/g, '\n').replace(/^\s*#{1,6}[^\n]*(?:\n|$)/, '').trim();
}
export function readIslands(doc: Pick<Document, 'getElementById'>) {
  const raw = doc.getElementById('wss-client-data')?.textContent;
  if (!raw) throw Error('concrete_client_data_required');
  const plan = doc.getElementById('wss-site-plan')?.textContent;
  return bindClient(JSON.parse(raw), plan ? JSON.parse(plan) : undefined);
}
