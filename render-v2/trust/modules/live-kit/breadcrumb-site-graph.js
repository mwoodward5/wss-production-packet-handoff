'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_breadcrumb_site_graph !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || typeof b.website !== 'string') return null;
  try {
    const website = new URL(b.website);
    if (!['https:', 'http:'].includes(website.protocol) || website.username || website.password) return null;
    let trail = [];
    if (Array.isArray(b.breadcrumbs) && b.breadcrumbs.length >= 2) {
      const valid = b.breadcrumbs.every(c => {
        if (!c || typeof c.name !== 'string' || !c.name.trim() || typeof c.url !== 'string') return false;
        try { const u = new URL(c.url, website); return u.origin === website.origin && !u.username && !u.password; } catch { return false; }
      });
      if (valid) trail = b.breadcrumbs.map(c => ({ name: c.name, url: new URL(c.url, website).href }));
    }
    return { name: b.name, website: website.href, trail };
  } catch { return null; }
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="breadcrumb-site-graph">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const owner = 'breadcrumb-site-graph';
          if (document.querySelector('script[data-wss-schema-module="' + owner + '"]')) return;
          const used = new Set((document.documentElement.getAttribute('data-wss-schema-modules') || '').split(' ').filter(Boolean));
          if (!used.has(owner) && used.size >= 2) return;
          const types = new Set();
          const walk = v => {
            if (!v || typeof v !== 'object') return;
            if (Array.isArray(v)) { v.forEach(walk); return; }
            for (const type of Array.isArray(v['@type']) ? v['@type'] : [v['@type']]) {
              if (typeof type === 'string') types.add(type.split(/[\/#]/).pop());
            }
            Object.values(v).forEach(walk);
          };
          for (const s of document.querySelectorAll('script[type="application/ld+json"]')) walk(JSON.parse(s.textContent));
          const graph = [];
          if (!types.has('WebSite')) graph.push({ '@type': 'WebSite', '@id': d.website + '#website', url: d.website, name: d.name });
          const nav = document.querySelector('nav[aria-label*="breadcrumb" i],.wss-breadcrumbs');
          const text = (nav?.innerText || '').replace(/\s+/g, ' ');
          if (!types.has('BreadcrumbList') && d.trail.length >= 2 && d.trail.every(c => text.includes(c.name.replace(/\s+/g, ' ')))) {
            graph.push({
              '@type': 'BreadcrumbList',
              itemListElement: d.trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url }))
            });
          }
          if (!graph.length) return;
          const node = document.createElement('script'); node.type = 'application/ld+json';
          node.setAttribute('data-wss-schema-module', owner); node.setAttribute('data-wss-kit-breadcrumb-site-graph-done', '1');
          node.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
            .replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
          document.head.appendChild(node);
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
  name: 'breadcrumb-site-graph',
  version: 1,
  class: 'schema',
  composesWith: Object.freeze(['showcase', 'hero-accent']),
  activation: 'flag:kit_breadcrumb_site_graph',
  budget: Object.freeze({ family: "schema-invisible", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css() { return ''; },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Invisible WebSite and optional BreadcrumbList enrichment only; never emits LocalBusiness, Service, FAQPage or WebPage. The website URL must be supplied by ctx.business, and breadcrumb labels and destinations must be explicitly supplied and visibly represented by the existing breadcrumb navigation. No Home, Services, town URL or service slug is synthesized. Each already-present schema type is independently skipped; malformed JSON-LD fails closed.'
});
