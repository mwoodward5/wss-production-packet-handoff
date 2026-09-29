import { createContext, useContext, useEffect, useState } from 'react';
import contract from './client-contract.cjs';

export interface Service { name: string; shortLabel: string; description: string; href: string }
export interface Media { role: string; path: string; rank: number | null }
export interface Client {
  identity: { businessName: string; city: string; state: string; phoneDisplay: string; phoneTel: string; email: string; website: string; logoOnDark: string; logoOnLight: string };
  hero: { line1: string; emphasis: string; line3: string; eyebrow: string; support: string; poster: string; video: string };
  services: Service[]; media: Media[];
  content: { serviceIntro: string; about: string; seasonalNote: string; whyHeadline: string; ctaHeadline: string; ctaBody: string; values: {title:string;body:string}[]; faqs: {q:string;a:string}[] };
  trust: { badges: {label:string;sublabel:string;meta:string}[]; areas: string[]; hours: {text?:string} | null; socials: string[]; mapUrl: string; bookingUrl: string };
  design: {accent:string; paletteSource:string; fonts:string[]};
}
export interface SitePlan { schema: 'wss-rich-site-plan-v1'; content?: Record<string,string>; pages?: unknown[]; visual?: Record<string,unknown> }
export interface Bridge { client: Client; plan: SitePlan | null; gallery: Media[]; featured?: Media; people?: Media }
function normalizePlan(raw: unknown): SitePlan | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as SitePlan).schema !== 'wss-rich-site-plan-v1') throw new Error('site_plan_schema_invalid');
  const plan = raw as SitePlan;
  if (plan.content !== undefined && (!plan.content || typeof plan.content !== 'object' || Array.isArray(plan.content) || Object.values(plan.content).some(value => typeof value !== 'string'))) throw new Error('site_plan_content_invalid');
  if (plan.pages !== undefined && !Array.isArray(plan.pages)) throw new Error('site_plan_pages_invalid');
  return plan;
}
export function bindClient(raw: unknown, plan: unknown = null): Bridge {
  const client = contract.normalize(raw) as Client;
  if (!client.services.some(s => /\broof(?:ing|s)?\b/i.test(s.name))) throw new Error('roofing_trade_required');
  if (client.identity.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(client.identity.email)) throw new Error('email_invalid');
  if (client.trust.hours?.text !== undefined && typeof client.trust.hours.text !== 'string') throw new Error('hours_text_invalid');
  const sitePlan = normalizePlan(plan);
  const routes = client.services.map(s => s.href).filter(Boolean);
  if (new Set(routes).size !== routes.length) throw new Error('service_routes_ambiguous');
  const gallery = client.media.filter(m => m.role === 'gallery').sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).slice(0,11);
  return {client, plan:sitePlan, gallery, featured: gallery[0], people:client.media.find(m => m.role === 'people')};
}
export function readBridge(doc: Document): Bridge {
  const data = doc.getElementById('wss-client-data');
  if (!data?.textContent) throw new Error('client_data_missing');
  const plan = doc.getElementById('wss-site-plan');
  return bindClient(JSON.parse(data.textContent), plan?.textContent ? JSON.parse(plan.textContent) : null);
}
export function contactDraft(email: string, fields: {name:string;phone:string;address:string;service:string;message:string}) {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('email_required');
  const subject = encodeURIComponent(`Roofing inquiry — ${fields.name}`);
  const body = encodeURIComponent(`Name: ${fields.name}\nPhone: ${fields.phone}\nAddress: ${fields.address}\nService: ${fields.service}\n\n${fields.message}`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}
export const ClientContext = createContext<Bridge | null>(null);
export function useClient() { const value = useContext(ClientContext); if (!value) throw new Error('client_context_missing'); return value; }
export function HeroMedia() {
  const {client} = useClient();
  const [motion,setMotion] = useState(false);
  const [failed,setFailed] = useState(false);
  useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setMotion(!query.matches); update(); query.addEventListener('change',update); return () => query.removeEventListener('change',update); },[]);
  return <><img src={client.hero.poster} alt="" className="absolute inset-0 h-full w-full object-cover" width={1920} height={1280}/>{motion && client.hero.video && !failed && <video src={client.hero.video} poster={client.hero.poster} autoPlay muted loop playsInline onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" aria-hidden />}</>;
}
export function Badges() { const {client} = useClient(); return <>{client.trust.badges.map((b,i) => <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 border border-current text-xs font-semibold tracking-wider uppercase rounded-sm">{b.label}{b.sublabel && ` · ${b.sublabel}`}</span>)}</>; }
export function BrandStyle() {
  const {client} = useClient();
  // CSD specifies an explicit accent role. Unlabelled palettes/fonts are never guessed.
  const accent = /^#[\da-f]{6}$/i.test(client.design.accent) && !/fallback|default/i.test(client.design.paletteSource) ? client.design.accent : '';
  return accent ? <style>{`.btn-safety {background:${accent}}`}</style> : null;
}
