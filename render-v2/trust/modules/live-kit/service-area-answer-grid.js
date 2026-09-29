'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_service_area_answer_grid !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || !Array.isArray(b.serviceAreas)) return null;
  const areas = Array.from(new Set(b.serviceAreas.filter(a => typeof a === 'string' && a.trim())));
  return areas.length ? { name: b.name, areas } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="service-area-answer-grid">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="service-area-answer-grid"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-service-area-answer-grid__body')) return;
          const body = document.createElement('div'); body.className = 'wss-service-area-answer-grid__body';
          for (const area of d.areas) {
            const card = document.createElement('article'); card.className = 'wss-service-area-answer-grid__card';
            const question = document.createElement('h3'); question.className = 'wss-service-area-answer-grid__question';
            question.textContent = 'Does ' + d.name + ' serve ' + area + '?';
            const answer = document.createElement('p'); answer.className = 'wss-service-area-answer-grid__answer';
            answer.textContent = d.name + ' serves ' + area + '.';
            card.append(question, answer); body.appendChild(card);
          }
          root.replaceChildren(body); root.classList.add('wss-service-area-answer-grid');
          root.setAttribute('data-wss-kit-service-area-answer-grid-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'service-area-answer-grid',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_service_area_answer_grid',
  budget: Object.freeze({ family: "service-area-grid", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-service-area-answer-grid { color:var(--wss-text); background:var(--wss-surface); }
.wss-service-area-answer-grid__body { display:flex; flex-wrap:wrap; gap:.875rem; }
.wss-service-area-answer-grid__card { flex:1 1 15rem; min-inline-size:0; padding:1.25rem; border:1px solid var(--wss-border); border-radius:1.25rem; background:var(--wss-surface); }
.wss-service-area-answer-grid__question { margin:0; font:inherit; font-weight:600; line-height:1.5; overflow-wrap:anywhere; }
.wss-service-area-answer-grid__answer { margin:.75rem 0 0; line-height:1.65; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-service-area-answer-grid, .wss-service-area-answer-grid__body, .wss-service-area-answer-grid__card,
  .wss-service-area-answer-grid__question, .wss-service-area-answer-grid__answer {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'This is the twentieth distinct local-visibility reference module, filling the conversion-list position vacated because InstantQuoteEstimator was already delivered in local intent. It does not duplicate that estimator or LocalLandmarkProof. Each explicit service area receives one complete coverage answer naming the business and place; no headquarters, state, local office or project-history claim is inferred. Flex wrapping preserves donor column ownership, and no duplicate FAQ schema is emitted.'
});
