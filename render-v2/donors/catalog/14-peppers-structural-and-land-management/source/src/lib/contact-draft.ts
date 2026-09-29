import {site} from './wss';
export function draftHref(data:FormData) {
  if (!site.identity.email) return null;
  const fields=['name','email','phone','city','service','timeline','budget','message','contactPreference'];
  const body=fields.map(key=>`${key}: ${String(data.get(key)||'').slice(0,2000)}`).join('\n');
  return `mailto:${site.identity.email}?subject=${encodeURIComponent('Project inquiry')}&body=${encodeURIComponent(body)}`;
}
export function openEmailDraft(data:FormData) { const href=draftHref(data); if(href) window.location.assign(href); }
