'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_orbiting_trust_ring !== true || !Array.isArray(ctx?.data?.badges)) return null;
  const b = ctx.business;
  const badges = ctx.data.badges.filter(x => x && typeof x.label === 'string' && x.label.trim())
    .slice(0, 6).map(x => ({ label: x.label, sublabel: typeof x.sublabel === 'string' ? x.sublabel : '' }));
  const year = b?.foundedYear;
  const center = Number.isSafeInteger(year) && year >= 1000 && year <= 9999 ? 'Founded ' + String(year) :
    typeof b?.standing === 'string' && b.standing.trim() ? b.standing : null;
  return badges.length >= 3 && center ? { badges, center } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="orbiting-trust-ring">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="orbiting-trust-ring"]') || document.querySelector('#trust-badges');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-orbiting-trust-ring__body')) return;
          const body = document.createElement('div'); body.className = 'wss-orbiting-trust-ring__body';
          const center = document.createElement('p'); center.className = 'wss-orbiting-trust-ring__center'; center.textContent = d.center;
          const ring = document.createElement('span'); ring.className = 'wss-orbiting-trust-ring__orbit'; ring.setAttribute('aria-hidden', 'true');
          const list = document.createElement('div'); list.className = 'wss-orbiting-trust-ring__list';
          d.badges.forEach((badge, i) => {
            const card = document.createElement('article'); card.className = 'wss-orbiting-trust-ring__badge';
            const angle = -Math.PI / 2 + i * Math.PI * 2 / d.badges.length;
            card.style.setProperty('--wss-orbit-x', (50 + Math.cos(angle) * 35).toFixed(3) + '%');
            card.style.setProperty('--wss-orbit-y', (50 + Math.sin(angle) * 35).toFixed(3) + '%');
            const label = document.createElement('strong'); label.className = 'wss-orbiting-trust-ring__label'; label.textContent = badge.label;
            card.appendChild(label);
            if (badge.sublabel) {
              const sub = document.createElement('p'); sub.className = 'wss-orbiting-trust-ring__sub'; sub.textContent = badge.sublabel; card.appendChild(sub);
            }
            list.appendChild(card);
          });
          body.append(ring, center, list);
          root.replaceChildren(body); root.classList.add('wss-orbiting-trust-ring');
          root.setAttribute('data-wss-kit-orbiting-trust-ring-done', '1'); root.setAttribute('data-wss-kit-class', 'badges');
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
  name: 'orbiting-trust-ring',
  version: 1,
  class: 'badges',
  composesWith: Object.freeze(['reviews', 'stats']),
  activation: 'flag:kit_orbiting_trust_ring',
  budget: Object.freeze({ family: "orbit-drift", ambientLoop: "8s ease-in-out infinite", dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-orbiting-trust-ring { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-orbiting-trust-ring__body { position:relative; min-block-size:30rem; max-inline-size:40rem; margin-inline:auto; }
.wss-orbiting-trust-ring__orbit { position:absolute; inline-size:20rem; block-size:20rem; left:50%; top:50%; translate:-50% -50%; border:2px dashed var(--wss-text); border-radius:50%; pointer-events:none; }
.wss-orbiting-trust-ring__center { position:absolute; left:50%; top:50%; translate:-50% -50%; max-inline-size:8rem; margin:0; text-align:center; font-weight:600; overflow-wrap:anywhere; }
.wss-orbiting-trust-ring__badge { position:absolute; left:var(--wss-orbit-x); top:var(--wss-orbit-y); translate:-50% -50%; box-sizing:border-box; inline-size:9rem; max-block-size:9rem; overflow:auto; padding:.875rem; border:1px solid var(--wss-border); border-radius:1rem; color:var(--wss-text); background:var(--wss-surface); }
.wss-orbiting-trust-ring__label { font:inherit; font-weight:600; }
.wss-orbiting-trust-ring__sub { margin:.4rem 0 0; font-size:.8125rem; overflow-wrap:anywhere; }
@keyframes wss-orbiting-trust-ring-drift { 0%,65%,100% { rotate:0deg; } 82.5% { rotate:12deg; } }
@media (prefers-reduced-motion:no-preference) {
  .wss-orbiting-trust-ring__orbit { animation:wss-orbiting-trust-ring-drift 8s ease-in-out infinite; }
  .wss-orbiting-trust-ring:hover .wss-orbiting-trust-ring__orbit,
  .wss-orbiting-trust-ring:focus-within .wss-orbiting-trust-ring__orbit { animation-play-state:paused; }
}
@media (max-width:767px) {
  .wss-orbiting-trust-ring__body { min-block-size:0; }
  .wss-orbiting-trust-ring__orbit { display:none; animation:none!important; }
  .wss-orbiting-trust-ring__center { position:static; translate:none; max-inline-size:none; margin-block-end:1rem; text-align:start; }
  .wss-orbiting-trust-ring__list { display:flex; flex-wrap:wrap; gap:.75rem; }
  .wss-orbiting-trust-ring__badge { position:static; translate:none; flex:1 1 10rem; inline-size:auto; max-block-size:none; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-orbiting-trust-ring, .wss-orbiting-trust-ring__body, .wss-orbiting-trust-ring__orbit,
  .wss-orbiting-trust-ring__center, .wss-orbiting-trust-ring__list, .wss-orbiting-trust-ring__badge {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
  .wss-orbiting-trust-ring__orbit { rotate:none!important; }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Replaces the badge rail with stationary readable credentials surrounding a verified founding-year or standing medallion. Only the decorative perimeter drifts; credentials never spin or require counter-rotation. The perimeter has sixty-five-percent dwell and disappears in the mobile list layout. Optional foundedYear or standing must actually be present in ctx.business; neither is inferred from reviews or a current-year calculation.'
});
