'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_local_business_schema !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || typeof b.schemaId !== 'string' || !b.schemaId.trim()) return null;
  const additions = {};
  for (const key of ['legalName', 'description', 'email', 'priceRange']) {
    if (typeof b[key] === 'string' && b[key].trim()) additions[key] = b[key];
  }
  if (typeof b.phone === 'string' && /^\+?[\d().\s-]{7,30}$/.test(b.phone) && b.phone.replace(/\D/g, '').length >= 7) additions.telephone = b.phone;
  if (typeof b.address === 'string' && b.address.trim()) additions.address = b.address;
  if (Array.isArray(b.socials)) {
    const urls = b.socials.map(s => s?.url).filter(url => {
      try { const u = new URL(url); return typeof url === 'string' && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
    });
    if (urls.length) additions.sameAs = Array.from(new Set(urls));
  }
  if (Array.isArray(b.paymentMethods) && b.paymentMethods.length &&
      b.paymentMethods.every(v => typeof v === 'string' && v.trim())) additions.paymentAccepted = b.paymentMethods.join(', ');
  return Object.keys(additions).length ? { name: b.name, schemaId: b.schemaId, additions } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="local-business-schema">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const owner = 'local-business-schema';
          const used = new Set((document.documentElement.getAttribute('data-wss-schema-modules') || '').split(' ').filter(Boolean));
          if (!used.has(owner) && used.size >= 2) return;
          const matches = [];
          const walk = (v, record) => {
            if (!v || typeof v !== 'object') return;
            if (Array.isArray(v)) { v.forEach(x => walk(x, record)); return; }
            const types = (Array.isArray(v['@type']) ? v['@type'] : [v['@type']])
              .filter(x => typeof x === 'string').map(x => x.split(/[\/#]/).pop());
            if (v['@id'] === d.schemaId && v.name === d.name && types.includes('LocalBusiness')) matches.push({ value: v, record });
            Object.values(v).forEach(x => walk(x, record));
          };
          for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
            const record = { node, json: JSON.parse(node.textContent) }; walk(record.json, record);
          }
          if (matches.length !== 1) return;
          const hit = matches[0]; let changed = false;
          for (const key of Object.keys(d.additions)) {
            if (Object.prototype.hasOwnProperty.call(hit.value, key)) continue;
            hit.value[key] = d.additions[key]; changed = true;
          }
          if (!changed) return;
          hit.record.node.textContent = JSON.stringify(hit.record.json)
            .replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
          hit.record.node.setAttribute('data-wss-kit-local-business-schema-done', '1');
          used.add(owner); document.documentElement.setAttribute('data-wss-schema-modules', Array.from(used).join(' '));
        } catch {}
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
      else arm();
      window.addEventListener('load', arm, { once: true });
      const observer = new MutationObserver(arm);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 6000);
    } catch {}
  }.toString() + ')(JSON.parse(' + payload + '));<\/script>';
}

module.exports = Object.freeze({
  name: 'local-business-schema',
  version: 1,
  class: 'schema',
  composesWith: Object.freeze(['showcase', 'social']),
  activation: 'flag:kit_local_business_schema',
  budget: Object.freeze({ family: "schema-invisible", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css() { return ''; },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Enrichment-only variant that updates missing allowlisted properties on one existing LocalBusiness node, matched by explicit schemaId and business name. It never creates or re-emits the base entity, changes an existing property, guesses coordinates, creates a favicon image claim, or duplicates aggregate/service/FAQ data. Only supplied verified scalar identity fields, HTTPS social identities and explicit payment methods qualify. Missing or ambiguous base nodes and malformed JSON-LD produce no change.'
});
