'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_ticker_bar !== true || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="ticker-bar">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="ticker-bar"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-ticker-bar__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-ticker-bar__' + suffix;
            if (text != null) n.textContent = text;
            return n;
          };
          const body = make('div', 'body'), track = make('div', 'track'), controls = make('div', 'controls');
          const cards = reviews.map(r => {
            const card = make('figure', 'card');
            card.appendChild(make('blockquote', 'quote', r.quote));
            if (r.author) card.appendChild(make('figcaption', 'author', r.author));
            track.appendChild(card);
            return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next');
          const toggle = make('button', 'button', 'Pause'), status = make('span', 'status');
          for (const b of [prev, next, toggle]) b.type = 'button';
          toggle.setAttribute('aria-label', 'Pause automatic review movement');
          controls.append(prev, status, next, toggle);
          body.append(track, controls);
          root.replaceChildren(body); root.classList.add('wss-ticker-bar');
          root.setAttribute('data-wss-kit-ticker-bar-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
          let index = 0, paused = false, frame = 0, target = 0;
          const reduced = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const label = () => { status.textContent = String(index + 1) + ' / ' + String(cards.length); };
          const stop = () => {
            cancelAnimationFrame(frame); frame = 0;
            track.style.scrollSnapType = '';
          };
          function go(step, automatic) {
            try {
              stop(); index = (index + step + cards.length) % cards.length; label();
              target = cards[index].offsetLeft;
              if (reduced() || !automatic) { track.scrollLeft = target; return; }
              const start = track.scrollLeft, began = performance.now();
              track.style.scrollSnapType = 'none';
              const tick = now => {
                try {
                  if (!root.isConnected || reduced() || paused) { track.scrollLeft = target; stop(); return; }
                  const p = Math.min(1, (now - began) / 1600);
                  track.scrollLeft = start + (target - start) * (p * p * (3 - 2 * p));
                  if (p < 1) frame = requestAnimationFrame(tick);
                  else stop();
                } catch { stop(); }
              };
              frame = requestAnimationFrame(tick);
            } catch { stop(); }
          }
          function pause() {
            paused = true; stop(); track.scrollLeft = target;
            toggle.textContent = 'Resume'; toggle.setAttribute('aria-label', 'Resume automatic review movement');
          }
          prev.addEventListener('click', () => { pause(); go(-1, false); });
          next.addEventListener('click', () => { pause(); go(1, false); });
          toggle.addEventListener('click', () => {
            if (!paused) pause();
            else { paused = false; toggle.textContent = 'Pause'; toggle.setAttribute('aria-label', 'Pause automatic review movement'); }
          });
          track.addEventListener('pointerdown', pause, { passive: true });
          root.addEventListener('mouseenter', () => { if (frame) { stop(); track.scrollLeft = target; } });
          root.addEventListener('focusin', () => { if (frame) { stop(); track.scrollLeft = target; } });
          const timer = setInterval(() => {
            try {
              if (!root.isConnected) { clearInterval(timer); stop(); return; }
              const box = root.getBoundingClientRect();
              if (paused || reduced() || document.hidden || root.matches(':hover') || root.contains(document.activeElement) ||
                  box.bottom <= 0 || box.top >= innerHeight) return;
              go(1, true);
            } catch { clearInterval(timer); stop(); }
          }, 8000);
          label();
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
  name: 'ticker-bar',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'stats']),
  activation: 'flag:kit_ticker_bar',
  budget: Object.freeze({ family: "review-ticker", ambientLoop: "8000ms auto-advance, paused on demand", dwell: null, stagger: "150ms sibling offset", maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-ticker-bar { background:var(--wss-surface); color:var(--wss-text); border-block:1px solid var(--wss-border); animation:none; max-block-size:20svh; overflow:auto; }
.wss-ticker-bar__body { min-inline-size:0; }
.wss-ticker-bar__track { position:relative; display:flex; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:auto; }
.wss-ticker-bar__card { flex:0 0 100%; box-sizing:border-box; margin:0; padding:.75rem 1rem; max-block-size:calc(20svh - 3rem); overflow:auto; scroll-snap-align:start; }
.wss-ticker-bar__quote { margin:0; font:inherit; line-height:1.55; overflow-wrap:anywhere; }
.wss-ticker-bar__author { margin-block-start:.4rem; font-size:.875rem; }
.wss-ticker-bar__controls { display:flex; align-items:center; justify-content:center; gap:.5rem; }
.wss-ticker-bar__button { min-block-size:44px; padding:.35rem .75rem; border:1px solid var(--wss-border); border-radius:.75rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-ticker-bar__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:2px; }
.wss-ticker-bar__status { font-variant-numeric:tabular-nums; }
@media (prefers-reduced-motion:reduce) {
  .wss-ticker-bar, .wss-ticker-bar__body, .wss-ticker-bar__track, .wss-ticker-bar__card,
  .wss-ticker-bar__quote, .wss-ticker-bar__author, .wss-ticker-bar__controls, .wss-ticker-bar__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; scroll-behavior:auto!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'The current composition law supersedes the legacy duplicate trust-rail ticker: this is the sole reviews presentation, replacing the review island. Each real quote appears once, with no cloned twin or fabricated live event. Automatic travel takes 1.6 seconds per eight-second cycle, leaving eighty-percent dwell; focus, hover, user interaction, reduced motion and offscreen state prevent automatic travel. Full quotes remain scrollable inside the twenty-percent-viewport-height ceiling.'
});
