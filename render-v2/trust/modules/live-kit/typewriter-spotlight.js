'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_typewriter_spotlight !== true || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="typewriter-spotlight">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="typewriter-spotlight"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-typewriter-spotlight__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-typewriter-spotlight__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), stage = make('div', 'stage'), controls = make('div', 'controls');
          const cards = reviews.map((r, i) => {
            const card = make('figure', 'card'); card.hidden = i !== 0;
            card.appendChild(make('blockquote', 'quote', r.quote));
            if (r.author) card.appendChild(make('figcaption', 'author', r.author));
            const line = make('div', 'line'), cursor = make('span', 'cursor');
            line.setAttribute('aria-hidden', 'true'); line.appendChild(cursor); card.appendChild(line);
            stage.appendChild(card); return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next'), status = make('span', 'status');
          prev.type = next.type = 'button'; let index = 0;
          function show(step) {
            try {
              index = (index + step + cards.length) % cards.length;
              cards.forEach((card, i) => { card.hidden = i !== index; });
              status.textContent = String(index + 1) + ' / ' + String(cards.length);
            } catch {}
          }
          prev.addEventListener('click', () => show(-1)); next.addEventListener('click', () => show(1));
          controls.append(prev, status, next); body.append(stage, controls); show(0);
          root.replaceChildren(body); root.classList.add('wss-typewriter-spotlight');
          root.setAttribute('data-wss-kit-typewriter-spotlight-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'typewriter-spotlight',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'showcase']),
  activation: 'flag:kit_typewriter_spotlight',
  budget: Object.freeze({ family: "typewriter", ambientLoop: null, dwell: "1.8s one-shot typing entry per card", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-typewriter-spotlight { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-typewriter-spotlight__body { max-inline-size:48rem; margin-inline:auto; }
.wss-typewriter-spotlight__card { margin:0; padding:1.5rem; }
.wss-typewriter-spotlight__card[hidden] { display:none; }
.wss-typewriter-spotlight__quote { margin:0; font:inherit; font-size:1.25rem; line-height:1.65; overflow-wrap:anywhere; }
.wss-typewriter-spotlight__author { margin-block-start:1rem; }
.wss-typewriter-spotlight__line { position:relative; block-size:24px; margin-block-start:1.25rem; overflow:hidden; border-radius:12px; background:var(--wss-surface-alt); }
.wss-typewriter-spotlight__cursor { display:block; inline-size:25%; min-inline-size:32px; block-size:24px; border-radius:12px; background:var(--wss-text); }
.wss-typewriter-spotlight__controls { display:flex; gap:.75rem; align-items:center; justify-content:center; }
.wss-typewriter-spotlight__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:.875rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-typewriter-spotlight__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@keyframes wss-typewriter-spotlight-cursor { from { translate:0 0; } to { translate:300% 0; } }
@media (prefers-reduced-motion:no-preference) {
  .wss-typewriter-spotlight__card:not([hidden]) .wss-typewriter-spotlight__cursor { animation:wss-typewriter-spotlight-cursor 1.8s ease-out both; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-typewriter-spotlight, .wss-typewriter-spotlight__body, .wss-typewriter-spotlight__card,
  .wss-typewriter-spotlight__quote, .wss-typewriter-spotlight__author, .wss-typewriter-spotlight__line,
  .wss-typewriter-spotlight__cursor, .wss-typewriter-spotlight__controls, .wss-typewriter-spotlight__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; translate:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'The premium interpretation retains the reference spotlight and typewriter cursor but never types away, truncates, paraphrases or temporarily hides the selected quote. A broad underline cursor travels once when a review is selected; there is no blinking caret or automatic quote rotation. Each review exists once, and previous/next buttons replace rather than supplement the former review treatment.'
});
