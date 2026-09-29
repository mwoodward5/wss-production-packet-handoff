import { createSite, type RichPlan } from './bridge';
function island(id:string, required=false) {
 const el=document.getElementById(id);
 if(!el && required) throw new Error('client_data_missing');
 return el?JSON.parse(el.textContent || ''):undefined;
}
export const SITE=createSite(island('wss-client-data',true),island('wss-site-plan') as RichPlan);
export const CLIENT=SITE.client;
export const PLAN=SITE.plan;
export const SERVICES=SITE.services;
// Only the explicit accent role exists in the normalized contract. Font arrays
// and untyped visual payloads are not interpreted as role assignments.
export function applyBranding() {
 if(CLIENT.design.paletteSource!=='donor-default' && CLIENT.design.paletteSource!=='approved-donor-fallback' && /^#[\da-f]{6}$/i.test(CLIENT.design.accent)) {
  document.documentElement.style.setProperty('--volt',CLIENT.design.accent);
  document.documentElement.style.setProperty('--volt-deep',CLIENT.design.accent);
 }
}
