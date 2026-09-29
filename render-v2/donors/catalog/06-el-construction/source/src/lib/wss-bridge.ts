import { normalize } from './client-contract.cjs';
import type { Client, SitePlan } from './wss-types';
export function decodeIslands(data:unknown, rich:unknown) {
 const client = normalize(data) as Client;
 if (client.services.some(s => !/concrete|foundation|excavat|flatwork|driveway|demolition|renovat|remodel|flooring|construction|curbs?\b|retaining walls?\b/i.test(s.name))) throw Error('donor_wrong_trade');
 const paths = client.services.map(s => s.href);
 if (paths.some(p => !p || ['/about','/contact','/service-area'].includes(p)) || new Set(paths).size !== paths.length) throw Error('donor_service_routes_required');
 if (client.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.identity.email)) throw Error('donor_email_invalid');
 if (rich != null && (typeof rich !== 'object' || (rich as SitePlan).schema !== 'wss-rich-site-plan-v1')) throw Error('donor_plan_schema_invalid');
 const plan = (rich || {schema:'wss-rich-site-plan-v1'}) as SitePlan;
 return {client,plan};
}
export function readIslands(doc:Pick<Document,'getElementById'>) {
 const raw=doc.getElementById('wss-client-data')?.textContent;
 if (!raw) throw Error('donor_client_data_required');
 const rich=doc.getElementById('wss-site-plan')?.textContent;
 return decodeIslands(JSON.parse(raw),rich ? JSON.parse(rich) : null);
}
export function brandVariables(client:Client):Record<string,string> {
 // CSD declares only accent's role. Font arrays and untyped rich visual objects
 // cannot safely establish display/body or background/foreground assignments.
 const a=client.design.accent;
 return client.design.paletteSource !== 'donor-default' && !/fallback/.test(client.design.paletteSource) && /^#[a-f\d]{6}$/i.test(a)
 ? {'--accent':a,'--gold':a,'--ring':a,'--gradient-gold':`linear-gradient(135deg, ${a}, ${a})`,'--shadow-glow':`0 10px 40px -10px ${a}66`,'--gradient-mesh':`radial-gradient(at 20% 10%, ${a}2e 0px, transparent 50%), radial-gradient(at 0% 80%, ${a}1a 0px, transparent 50%)`} : {};
}
export function heroVideoSource(video:string, reducedMotion:boolean, connection?:{saveData?:boolean;effectiveType?:string}) {
 return !video || reducedMotion || connection?.saveData || ['slow-2g','2g','3g'].includes(connection?.effectiveType || '') ? null : video;
}
