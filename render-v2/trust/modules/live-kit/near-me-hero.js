'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_near_me_hero !== true) return null;
  const b = ctx?.business;
  if (!b || ![b.name, b.city, b.state].every(x => typeof x === 'string' && x.trim())) return null;
  const areas = Array.isArray(b.serviceAreas) ? b.serviceAreas.filter(x => typeof x === 'string' && x.trim()) : [];
  return {
    location: b.name + ' is based in ' + b.city + ', ' + b.state + '.',
    coverage: areas.length ? b.name + ' in ' + b.city + ', ' + b.state + ' serves ' + areas.join(', ') + '.' : ''
  };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="near-me-hero">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="near-me-hero"]');
          if (!root || root.matches('h1') || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('h1,video,form') || root.querySelector('.wss-near-me-hero__body')) return;
          const body = document.createElement('div'); body.className = 'wss-near-me-hero__body';
          for (const key of ['location', 'coverage']) {
            if (!d[key]) continue;
            const p = document.createElement('p'); p.className = 'wss-near-me-hero__' + key; p.textContent = d[key]; body.appendChild(p);
          }
          root.replaceChildren(body); root.classList.add('wss-near-me-hero');
          root.setAttribute('data-wss-kit-near-me-hero-done', '1'); root.setAttribute('data-wss-kit-class', 'hero-accent');
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
  name: 'near-me-hero',
  version: 1,
  class: 'hero-accent',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_near_me_hero',
  budget: Object.freeze({ family: "near-me-hero", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-near-me-hero { color:var(--wss-text); }
.wss-near-me-hero__body { border-inline-start:2px solid var(--wss-text); padding-inline-start:1rem; max-inline-size:48rem; }
.wss-near-me-hero__location { margin:0; font:inherit; font-weight:600; line-height:1.5; }
.wss-near-me-hero__coverage { margin:.5rem 0 0; font:inherit; line-height:1.65; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-near-me-hero, .wss-near-me-hero__body, .wss-near-me-hero__location, .wss-near-me-hero__coverage {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'A quiet location frame for the existing hero, not a second hero or rewritten headline. It refuses a mount containing h1, forms or video, leaves hero typography and media untouched, and never geolocates the visitor or implies nearest-business ranking. Only business location and explicitly supplied coverage appear. The engine must reserve the one hero-accent class for this treatment.'
});
