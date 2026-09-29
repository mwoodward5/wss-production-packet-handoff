'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_holo_badge !== true || !Array.isArray(ctx?.data?.badges)) return null;
  const badges = ctx.data.badges.filter(b => b && typeof b.label === 'string' && b.label.trim())
    .map(b => ({ label: b.label, sublabel: typeof b.sublabel === 'string' ? b.sublabel : '', meta: typeof b.meta === 'string' ? b.meta : '' }));
  return badges.length ? badges : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="holo-badge">(' + function (badges) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="holo-badge"]') ||
            document.querySelector('#credentials') || document.querySelector('#badges');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-holo-badge__body')) return;
          const body = document.createElement('div');
          body.className = 'wss-holo-badge__body';
          for (const badge of badges) {
            const card = document.createElement('article');
            card.className = 'wss-holo-badge__card';
            const sheen = document.createElement('span');
            sheen.className = 'wss-holo-badge__sheen';
            sheen.setAttribute('aria-hidden', 'true');
            card.appendChild(sheen);
            for (const key of ['label', 'sublabel', 'meta']) {
              if (!badge[key]) continue;
              const node = document.createElement(key === 'label' ? 'strong' : 'p');
              node.className = 'wss-holo-badge__' + key;
              node.textContent = badge[key];
              card.appendChild(node);
            }
            card.setAttribute('data-wss-kit-holo-badge-done', '1');
            body.appendChild(card);
          }
          root.replaceChildren(body);
          root.classList.add('wss-holo-badge');
          root.setAttribute('data-wss-kit-holo-badge-done', '1');
          root.setAttribute('data-wss-kit-class', 'badges');
          let active = null;
          const clear = () => {
            try {
              if (active) {
                active.classList.remove('wss-holo-badge__card--active');
                active.style.removeProperty('--wss-holo-badge-position');
                active = null;
              }
            } catch {}
          };
          body.addEventListener('pointermove', event => {
            try {
              if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
                  !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return clear();
              const card = event.target.closest('.wss-holo-badge__card');
              if (!card || !body.contains(card)) return clear();
              if (active !== card) { clear(); active = card; active.classList.add('wss-holo-badge__card--active'); }
              const box = card.getBoundingClientRect();
              if (box.width <= 0) return;
              const x = Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100));
              card.style.setProperty('--wss-holo-badge-position', x.toFixed(2) + '%');
            } catch { clear(); }
          }, { passive: true });
          body.addEventListener('pointerleave', clear, { passive: true });
          window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', clear);
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
  name: 'holo-badge',
  version: 1,
  class: 'badges',
  composesWith: Object.freeze(['reviews', 'stats']),
  activation: 'flag:kit_holo_badge',
  budget: Object.freeze({ family: "holo-sheen", ambientLoop: null, dwell: "1.6s activation transition", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-holo-badge { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-holo-badge__body { display:flex; flex-wrap:wrap; gap:.875rem; }
.wss-holo-badge__card { flex:1 1 12rem; min-inline-size:0; padding:1.25rem; border:1px solid var(--wss-border); border-radius:1.25rem; background:var(--wss-surface); color:var(--wss-text); }
.wss-holo-badge__sheen { display:block; block-size:32px; margin-block-end:1rem; border-radius:1rem; background:linear-gradient(90deg,var(--wss-surface) 35%,var(--wss-text) 45%,var(--wss-text) 55%,var(--wss-surface) 65%); background-size:300% 100%; background-position:50% 0; transition:none; }
.wss-holo-badge__label { display:block; font:inherit; font-weight:600; }
.wss-holo-badge__sublabel, .wss-holo-badge__meta { margin:.5rem 0 0; font-size:.875rem; overflow-wrap:anywhere; }
@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference) {
  .wss-holo-badge__card--active .wss-holo-badge__sheen { background-position:var(--wss-holo-badge-position,50%) 0; transition:background-position 1.6s ease-out; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-holo-badge, .wss-holo-badge__body, .wss-holo-badge__card, .wss-holo-badge__sheen,
  .wss-holo-badge__label, .wss-holo-badge__sublabel, .wss-holo-badge__meta {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
  .wss-holo-badge__sheen { background-position:50% 0!important; }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Ports the pointer-follow credential sheen into a reserved thirty-two-pixel strip, never across readable credential text. Only the badge currently under a fine pointer can transition; leaving it immediately clears the previous moving state. Touch and reduced-motion users receive static cards. No device-orientation permission, tilt on donor elements, manufactured certification icon, or additional badge section is introduced.'
});
