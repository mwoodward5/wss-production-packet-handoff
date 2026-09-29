'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_instant_quote_estimator !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim()) return null;
  const prices = (Array.isArray(b.services) ? b.services : []).filter(s =>
    s && typeof s.name === 'string' && s.name.trim() &&
    ((typeof s.price === 'string' && s.price.trim()) || (Number.isFinite(s.price) && s.price >= 0))
  ).map(s => ({ name: s.name, price: String(s.price) }));
  return { name: b.name, prices };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="instant-quote-estimator">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="instant-quote-estimator"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-instant-quote-estimator__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-instant-quote-estimator__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body');
          if (d.prices.length) {
            const label = make('label', 'label', 'Service');
            const select = make('select', 'select');
            const output = make('output', 'price');
            d.prices.forEach((p, i) => {
              const option = document.createElement('option'); option.value = String(i); option.textContent = p.name; select.appendChild(option);
            });
            const update = () => {
              const item = d.prices[Number(select.value)];
              if (item) output.textContent = d.name + ' — ' + item.name + ': ' + item.price;
            };
            select.addEventListener('change', update);
            label.appendChild(select); body.append(label, output); update();
          }
          const contact = make('a', 'contact', 'Request a quote from ' + d.name);
          contact.href = '/contact'; body.appendChild(contact);
          root.replaceChildren(body); root.classList.add('wss-instant-quote-estimator');
          root.setAttribute('data-wss-kit-instant-quote-estimator-done', '1'); root.setAttribute('data-wss-kit-class', 'urgency');
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
  name: 'instant-quote-estimator',
  version: 1,
  class: 'urgency',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_instant_quote_estimator',
  budget: Object.freeze({ family: "quote-estimator", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-instant-quote-estimator { color:var(--wss-text); background:var(--wss-surface); max-block-size:20svh; overflow:auto; }
.wss-instant-quote-estimator__body { display:flex; flex-wrap:wrap; align-items:center; gap:1rem; padding:1rem; border:1px solid var(--wss-border); border-radius:1.25rem; }
.wss-instant-quote-estimator__label { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; }
.wss-instant-quote-estimator__select { min-block-size:44px; max-inline-size:100%; padding:.5rem; border:1px solid var(--wss-border); border-radius:.75rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; }
.wss-instant-quote-estimator__price { line-height:1.5; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.wss-instant-quote-estimator__contact { display:inline-flex; align-items:center; min-block-size:44px; padding:.5rem .875rem; border:1px solid var(--wss-text); border-radius:.875rem; color:var(--wss-text); background:var(--wss-surface); text-decoration:none; }
.wss-instant-quote-estimator__select:focus-visible, .wss-instant-quote-estimator__contact:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@media (prefers-reduced-motion:reduce) {
  .wss-instant-quote-estimator, .wss-instant-quote-estimator__body, .wss-instant-quote-estimator__label,
  .wss-instant-quote-estimator__select, .wss-instant-quote-estimator__price, .wss-instant-quote-estimator__contact {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Uses only services[].price, preserving supplied numeric or textual prices without currency assumptions, rounding, synthetic low/high ranges or invented size multipliers. A zero price is displayed as zero, not reworded as a free offer. When no eligible prices exist, the only output is the owner-authorized request-a-quote link to /contact. All controls are static, outside forms, and contained within the urgency height ceiling.'
});
