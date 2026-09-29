import { normalize } from './wss-normalize.js';
import type { ClientData, SitePlan } from './wss-types';
export function readClient(value: unknown): ClientData {
 const data = normalize(value) as ClientData;
 // CSD has no category field: require an explicit tree-care service, never infer from business name.
 if (!data.services.some(s => /\b(tree|arborist|arboriculture|stump)\b/i.test(s.name))) throw new Error('donor_wrong_trade');
 if (data.services.some(s => !/\b(tree|arborist|arboriculture|stump|pruning|bucket truck|lot clearing|land clearing|brush hogging|mulching|landscape maintenance|snow removal|storm damage)\b/i.test(s.name))) throw new Error('donor_wrong_trade');
 if (data.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.identity.email)) throw new Error('donor_email_invalid');
 const hrefs = data.services.map(s => s.href);
 if (hrefs.some(x => !x || ['/', '/about', '/contact', '/services', '/service-area'].includes(x)) || new Set(hrefs).size !== hrefs.length) throw new Error('donor_service_route_invalid');
 return data;
}
function island(id: string): unknown {
 const el = document.getElementById(id);
 if (!el?.textContent) throw new Error('donor_missing_' + id);
 return JSON.parse(el.textContent);
}
export const client = readClient(island('wss-client-data'));
const rawPlan = document.getElementById('wss-site-plan')?.textContent;
export function readSitePlan(value: unknown): SitePlan {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('donor_site_plan_invalid');
 const p = value as SitePlan;
 if (p.schema !== 'wss-rich-site-plan-v1') throw new Error('donor_site_plan_invalid');
 if (p.content && (typeof p.content !== 'object' || Array.isArray(p.content) || Object.values(p.content).some(v => typeof v !== 'string'))) throw new Error('donor_plan_content_invalid');
 if (p.services && (!Array.isArray(p.services) || p.services.some(s => !s || typeof s.name !== 'string' || typeof s.slug !== 'string' || (s.shortDesc != null && typeof s.shortDesc !== 'string') || (s.longDescMd != null && typeof s.longDescMd !== 'string')))) throw new Error('donor_plan_services_invalid');
 if (p.pages && (!Array.isArray(p.pages) || p.pages.some(s => !s || typeof s.slug !== 'string'))) throw new Error('donor_plan_pages_invalid');
 return p;
}
export const sitePlan: SitePlan = readSitePlan(rawPlan ? JSON.parse(rawPlan) : { schema: 'wss-rich-site-plan-v1' });
export const bodyCopy = (key: string, fallback = '') => typeof sitePlan.content?.[key] === 'string' && sitePlan.content[key].trim() ? sitePlan.content[key].replace(/^# [^\n]*\n+/, '').trim() : fallback;
export function markdownSection(markdown: string, heading: string) {
 const sections = markdown.split(/^##\s+/m).slice(1);
 const found = sections.find(s => s.split('\n')[0].trim().toLowerCase() === heading.toLowerCase());
 return found ? found.slice(found.indexOf('\n') + 1).trim() : '';
}
export function sectionCopy(heading: string) { return markdownSection(sitePlan.content?.home || '', heading); }
export function sectionItems(heading: string) {
 const raw = sectionCopy(heading);
 return raw.split(/^###\s+/m).slice(1).map(s => ({title:s.split('\n')[0].trim(),body:s.slice(s.indexOf('\n')+1).trim()})).filter(s => s.title && s.body);
}
export const stats = client.trust.stats.filter((v): v is {label: string; value: number; suffix?: string} => !!v && typeof v === 'object' && typeof (v as {label?: unknown}).label === 'string' && typeof (v as {value?: unknown}).value === 'number' && Number.isFinite((v as {value: number}).value) && ((v as {suffix?: unknown}).suffix == null || typeof (v as {suffix?: unknown}).suffix === 'string'));
export function applyBrand() {
 // The copied contract certifies only accent. Unordered palette/font arrays have no role semantics.
 const accent = client.design.accent;
 if (client.design.paletteSource !== 'donor-default' && client.design.paletteSource !== 'approved-donor-fallback' && /^#[0-9a-f]{6}$/i.test(accent)) {
  for (const key of ['--accent', '--ft3-accent', '--amber-accent', '--ring']) document.documentElement.style.setProperty(key, accent);
  document.documentElement.style.setProperty('--gradient-cta', `linear-gradient(135deg, ${accent}, ${accent})`);
 }
}
