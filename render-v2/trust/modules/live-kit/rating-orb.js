'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_rating_orb !== true) return null;
  const reviews = ctx?.data?.reviews;
  if (Array.isArray(reviews) && reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim()).length >= 3) return null;
  const a = ctx?.data?.aggregate ?? ctx?.business?.reviewAggregate;
  if (!a || !Number.isFinite(a.rating) || a.rating < 0 || a.rating > 5 || !Number.isSafeInteger(a.count) || a.count <= 0) return null;
  return { rating: a.rating, count: a.count };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="rating-orb">(' + function (d) {
    'use strict';
    try {
      const reduced = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="rating-orb"]') ||
            document.querySelector('#reviews[data-wss-rating-strip] .wss-rs__score');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-rating-orb__body')) return;
          const body = document.createElement('div');
          body.className = 'wss-rating-orb__body';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 144 144');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('class', 'wss-rating-orb__graphic');
          function circle(radius, name) {
            const c = document.createElementNS(svg.namespaceURI, 'circle');
            for (const [key, value] of Object.entries({ cx: 72, cy: 72, r: radius, pathLength: 100, class: name })) c.setAttribute(key, String(value));
            svg.appendChild(c);
            return c;
          }
          circle(51, 'wss-rating-orb__track');
          const progress = circle(51, 'wss-rating-orb__progress');
          progress.setAttribute('stroke-dasharray', String(d.rating * 20) + ' ' + String(100 - d.rating * 20));
          circle(65, 'wss-rating-orb__halo');
          const text = document.createElement('div');
          text.className = 'wss-rating-orb__text';
          const value = document.createElement('strong');
          value.className = 'wss-rating-orb__value';
          value.textContent = String(d.rating) + ' / 5';
          const count = document.createElement('span');
          count.className = 'wss-rating-orb__count';
          count.textContent = String(d.count) + (d.count === 1 ? ' review' : ' reviews');
          text.append(value, count);
          body.append(svg, text);
          root.replaceChildren(body);
          root.classList.add('wss-rating-orb');
          root.setAttribute('data-wss-kit-rating-orb-done', '1');
          root.setAttribute('data-wss-kit-class', 'reviews');
          function motion() {
            try { root.classList.toggle('wss-rating-orb--motion', !reduced()); } catch {}
          }
          motion();
          if (window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', motion);
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
  name: 'rating-orb',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'showcase']),
  activation: 'flag:kit_rating_orb',
  budget: Object.freeze({ family: "rating-halo", ambientLoop: "8s ease-in-out infinite halo", dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-rating-orb { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-rating-orb__body { position:relative; inline-size:12rem; max-inline-size:100%; margin-inline:auto; }
.wss-rating-orb__graphic { display:block; inline-size:100%; block-size:auto; overflow:visible; }
.wss-rating-orb__track { fill:none; stroke:var(--wss-border); stroke-width:6; }
.wss-rating-orb__progress { fill:none; stroke:var(--wss-text); stroke-width:6; rotate:-90deg; transform-origin:center; }
.wss-rating-orb__halo { fill:none; stroke:var(--wss-text); stroke-width:3; stroke-dasharray:8 17; }
.wss-rating-orb__text { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.35rem; }
.wss-rating-orb__value { font:inherit; font-size:1.5rem; font-weight:600; font-variant-numeric:tabular-nums; }
.wss-rating-orb__count { font-size:.875rem; color:var(--wss-text); }
@keyframes wss-rating-orb-halo { 0%,60%,100% { stroke-dashoffset:0; } 80% { stroke-dashoffset:12; } }
@media (prefers-reduced-motion:no-preference) {
  .wss-rating-orb--motion .wss-rating-orb__halo { animation:wss-rating-orb-halo 8s ease-in-out infinite; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-rating-orb, .wss-rating-orb__body, .wss-rating-orb__graphic, .wss-rating-orb__track,
  .wss-rating-orb__progress, .wss-rating-orb__halo, .wss-rating-orb__text {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Replaces the aggregate-only review treatment, or fills an engine-assigned rating-orb replacement slot. Rating and count remain exact and stationary; only the outer dashed halo moves, with sixty-percent dwell. No platform attribution, count-up, fabricated aggregate, duplicated review presentation, or external asset is introduced. Uses the resolved text/surface contrast pair. Harmonizes with badges and a separate factual showcase. Browser contrast and pixel-diff acceptance remain unclaimed.'
});
