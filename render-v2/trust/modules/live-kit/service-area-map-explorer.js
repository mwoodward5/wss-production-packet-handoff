'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_service_area_map_explorer !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || !Array.isArray(b.serviceAreas)) return null;
  const areas = Array.from(new Set(b.serviceAreas.filter(a => typeof a === 'string' && a.trim())));
  return areas.length ? { name: b.name, areas } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="service-area-map-explorer">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="service-area-map-explorer"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-service-area-map-explorer__body')) return;
          const body = document.createElement('div'); body.className = 'wss-service-area-map-explorer__body';
          const controls = document.createElement('div'); controls.className = 'wss-service-area-map-explorer__controls';
          controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Service areas');
          const answer = document.createElement('p'); answer.className = 'wss-service-area-map-explorer__answer';
          const buttons = [];
          d.areas.forEach((area, i) => {
            const button = document.createElement('button'); button.type = 'button';
            button.className = 'wss-service-area-map-explorer__button'; button.textContent = area;
            button.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
            button.addEventListener('click', () => {
              try {
                answer.textContent = d.name + ' serves ' + area + '.';
                buttons.forEach(n => n.setAttribute('aria-pressed', n === button ? 'true' : 'false'));
              } catch {}
            });
            buttons.push(button); controls.appendChild(button);
          });
          answer.textContent = d.name + ' serves ' + d.areas[0] + '.';
          body.append(controls, answer);
          root.replaceChildren(body); root.classList.add('wss-service-area-map-explorer');
          root.setAttribute('data-wss-kit-service-area-map-explorer-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'service-area-map-explorer',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_service_area_map_explorer',
  budget: Object.freeze({ family: "service-area-map", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-service-area-map-explorer { color:var(--wss-text); background:var(--wss-surface); }
.wss-service-area-map-explorer__body { padding:1.5rem; border:1px solid var(--wss-border); border-radius:1.5rem; }
.wss-service-area-map-explorer__controls { display:flex; flex-wrap:wrap; gap:.625rem; }
.wss-service-area-map-explorer__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:999px; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-service-area-map-explorer__button[aria-pressed="true"] { border-color:var(--wss-text); border-width:2px; }
.wss-service-area-map-explorer__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
.wss-service-area-map-explorer__answer { margin:1.25rem 0 0; line-height:1.65; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-service-area-map-explorer, .wss-service-area-map-explorer__body,
  .wss-service-area-map-explorer__controls, .wss-service-area-map-explorer__button, .wss-service-area-map-explorer__answer {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'The supplied serviceAreas shape has names, not verified per-area coordinates. Accordingly this is an honest non-geographic coverage explorer: no pseudo-random map pins, distances, coverage circles, job locations or invented area-page URLs. Manual chips reveal complete coverage sentences from ctx. It replaces the assigned coverage treatment without network requests or a mapping provider.'
});
