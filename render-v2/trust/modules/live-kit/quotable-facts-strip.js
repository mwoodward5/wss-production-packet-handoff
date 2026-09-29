'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_quotable_facts_strip !== true) return null;
  const b = ctx?.business;
  if (!b || ![b.name, b.city, b.state].every(x => typeof x === 'string' && x.trim())) return null;
  const place = b.city + ', ' + b.state;
  const facts = [b.name + ' is based in ' + place + '.'];
  const areas = Array.isArray(b.serviceAreas) ? b.serviceAreas.filter(x => typeof x === 'string' && x.trim()) : [];
  if (areas.length) facts.push(b.name + ' in ' + place + ' serves ' + areas.join(', ') + '.');
  const services = Array.isArray(b.services) ? b.services.filter(s => s && typeof s.name === 'string' && s.name.trim()).map(s => s.name) : [];
  if (services.length) facts.push(b.name + ' in ' + place + ' offers ' + services.join(', ') + '.');
  const a = b.reviewAggregate;
  if (a && Number.isFinite(a.rating) && a.rating >= 0 && a.rating <= 5 && Number.isSafeInteger(a.count) && a.count > 0)
    facts.push(b.name + ' in ' + place + ' has an aggregate rating of ' + String(a.rating) + ' out of 5 from ' + String(a.count) + ' reviews.');
  return facts;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="quotable-facts-strip">(' + function (facts) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="quotable-facts-strip"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-quotable-facts-strip__body')) return;
          const list = document.createElement('ul'); list.className = 'wss-quotable-facts-strip__body';
          for (const fact of facts) {
            const item = document.createElement('li'); item.className = 'wss-quotable-facts-strip__fact'; item.textContent = fact; list.appendChild(item);
          }
          root.replaceChildren(list); root.classList.add('wss-quotable-facts-strip');
          root.setAttribute('data-wss-kit-quotable-facts-strip-done', '1'); root.setAttribute('data-wss-kit-class', 'stats');
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
  name: 'quotable-facts-strip',
  version: 1,
  class: 'stats',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_quotable_facts_strip',
  budget: Object.freeze({ family: "facts-strip", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-quotable-facts-strip { color:var(--wss-text); background:var(--wss-surface); border-block:1px solid var(--wss-border); }
.wss-quotable-facts-strip__body { display:flex; gap:1rem; overflow-x:auto; scroll-snap-type:x proximity; margin:0; padding:1rem; list-style:none; }
.wss-quotable-facts-strip__fact { flex:0 0 min(85%,24rem); padding:1rem; border-inline-start:2px solid var(--wss-text); line-height:1.65; scroll-snap-align:start; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-quotable-facts-strip, .wss-quotable-facts-strip__body, .wss-quotable-facts-strip__fact {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; scroll-behavior:auto!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Ports the compact quotable strip as a manual, fully readable horizontal rail instead of another unattended ticker. Every complete sentence names the business and supplied place; optional aggregate data must be a valid rating/count pair. No verified-review adjective, provider platform, tenure, emergency promise or warranty is fabricated. The stats class makes this an alternative to, not a companion for, another statistical treatment.'
});
