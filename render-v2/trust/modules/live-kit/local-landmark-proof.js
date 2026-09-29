'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_local_landmark_proof !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || !Array.isArray(b.landmarkProofs)) return null;
  const proofs = b.landmarkProofs.filter(p => p && [p.landmark, p.town, p.work].every(v => typeof v === 'string' && v.trim()))
    .map(p => ({
      sentence: b.name + ' documents a ' + p.work + ' project near ' + p.landmark + ' in ' + p.town + '.',
      detail: typeof p.detail === 'string' && p.detail.trim()
        ? b.name + ' records this detail for that project near ' + p.landmark + ' in ' + p.town + ': “' + p.detail + '”'
        : ''
    }));
  return proofs.length ? proofs : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="local-landmark-proof">(' + function (proofs) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="local-landmark-proof"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-local-landmark-proof__body')) return;
          const body = document.createElement('div'); body.className = 'wss-local-landmark-proof__body';
          for (const proof of proofs) {
            const card = document.createElement('article'); card.className = 'wss-local-landmark-proof__card';
            for (const key of ['sentence', 'detail']) {
              if (!proof[key]) continue;
              const p = document.createElement('p'); p.className = 'wss-local-landmark-proof__' + key; p.textContent = proof[key]; card.appendChild(p);
            }
            body.appendChild(card);
          }
          root.replaceChildren(body); root.classList.add('wss-local-landmark-proof');
          root.setAttribute('data-wss-kit-local-landmark-proof-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'local-landmark-proof',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_local_landmark_proof',
  budget: Object.freeze({ family: "landmark-proof", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-local-landmark-proof { color:var(--wss-text); background:var(--wss-surface); }
.wss-local-landmark-proof__body { display:flex; gap:1rem; overflow-x:auto; scroll-snap-type:x proximity; padding-block:.5rem; }
.wss-local-landmark-proof__card { flex:0 0 min(85%,25rem); box-sizing:border-box; padding:1.5rem; border:1px solid var(--wss-border); border-radius:1.25rem; background:var(--wss-surface); scroll-snap-align:start; }
.wss-local-landmark-proof__sentence { margin:0; line-height:1.65; font-weight:600; overflow-wrap:anywhere; }
.wss-local-landmark-proof__detail { margin:1rem 0 0; line-height:1.65; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-local-landmark-proof, .wss-local-landmark-proof__body, .wss-local-landmark-proof__card,
  .wss-local-landmark-proof__sentence, .wss-local-landmark-proof__detail {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; scroll-behavior:auto!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Requires explicit verified project-to-landmark evidence in the optional ctx.business.landmarkProofs extension. A town list, business address or nearby landmark alone is not project proof and cannot activate it. The manual cards retain supplied project descriptions and quote any detail verbatim without inventing recency, distances, outcomes or coordinates. This module is delivered once and owns the showcase presentation when selected.'
});
