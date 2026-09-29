'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_entity_card !== true) return null;
  const b = ctx?.business;
  if (!b || ![b.name, b.city, b.state].every(x => typeof x === 'string' && x.trim())) return null;
  const place = b.city + ', ' + b.state;
  const lines = [b.name + ' is based in ' + place + '.'];
  if (typeof b.address === 'string' && b.address.trim()) lines.push(b.name + ' in ' + place + ' lists its address as ' + b.address + '.');
  if (typeof b.phone === 'string' && /^\+?[\d().\s-]{7,30}$/.test(b.phone) && b.phone.replace(/\D/g, '').length >= 7)
    lines.push(b.name + ' in ' + place + ' lists its telephone number as ' + b.phone + '.');
  const services = Array.isArray(b.services) ? b.services.filter(s => s && typeof s.name === 'string' && s.name.trim()).map(s => s.name) : [];
  if (services.length) lines.push(b.name + ' in ' + place + ' offers ' + services.join(', ') + '.');
  return { name: b.name, lines };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="entity-card">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="entity-card"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-entity-card__body')) return;
          const body = document.createElement('article'); body.className = 'wss-entity-card__body';
          body.setAttribute('aria-label', d.name);
          for (const line of d.lines) {
            const p = document.createElement('p'); p.className = 'wss-entity-card__fact'; p.textContent = line; body.appendChild(p);
          }
          root.replaceChildren(body); root.classList.add('wss-entity-card');
          root.setAttribute('data-wss-kit-entity-card-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'entity-card',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_entity_card',
  budget: Object.freeze({ family: "entity-card", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-entity-card { color:var(--wss-text); background:var(--wss-surface); }
.wss-entity-card__body { max-inline-size:48rem; margin-inline:auto; padding:1.5rem; border:1px solid var(--wss-border); border-inline-start:3px solid var(--wss-text); border-radius:1.5rem; background:var(--wss-surface); }
.wss-entity-card__fact { margin:0; padding-block:.75rem; line-height:1.65; overflow-wrap:anywhere; }
.wss-entity-card__fact + .wss-entity-card__fact { border-block-start:1px solid var(--wss-border); }
@media (prefers-reduced-motion:reduce) {
  .wss-entity-card, .wss-entity-card__body, .wss-entity-card__fact {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Ports the reference identity plate as a static editorial card: no sensor permissions, rotating factual text or duplicate structured-data entity. Every sentence independently names the business and place, with address, phone and services omitted when absent. The exact engine-assigned showcase slot is replaced, never appended beside another identity treatment.'
});
