import { makeSite, type Site } from './model';
export let site: Site;
const applied = new WeakMap<Document, string[]>();
export function initialize(doc: Document) {
  for (const key of applied.get(doc) || []) doc.documentElement.style.removeProperty(key);
  applied.delete(doc);
  const data = doc.getElementById('wss-client-data');
  if (!data?.textContent) throw new Error('donor_client_data_required');
  const plan = doc.getElementById('wss-site-plan');
  site = makeSite(JSON.parse(data.textContent), plan?.textContent ? JSON.parse(plan.textContent) : {});
  for (const [key, value] of Object.entries(site.css)) doc.documentElement.style.setProperty(key, value);
  applied.set(doc, Object.keys(site.css));
  return site;
}
