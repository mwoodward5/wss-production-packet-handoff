'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_vault_reveal !== true || !Array.isArray(ctx?.data?.badges)) return null;
  const badges = ctx.data.badges.filter(b => b && typeof b.label === 'string' && b.label.trim())
    .map(b => ({ label: b.label, sublabel: typeof b.sublabel === 'string' ? b.sublabel : '', meta: typeof b.meta === 'string' ? b.meta : '' }));
  return badges.length >= 2 ? { badges, mobile: ctx?.mode?.mobile === true } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="vault-reveal">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="vault-reveal"]') ||
            document.querySelector('#credentials') || document.querySelector('#trust-badges');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-vault-reveal__body')) return;
          const body = document.createElement('div');
          body.className = 'wss-vault-reveal__body';
          const mobile = d.mobile || window.matchMedia?.('(max-width:767px)').matches;
          d.badges.forEach((badge, i) => {
            const item = document.createElement('article');
            item.className = 'wss-vault-reveal__item';
            if (i < (mobile ? 3 : 4)) item.classList.add('wss-vault-reveal__animated');
            item.style.setProperty('--wss-vault-reveal-delay', String(i * 150) + 'ms');
            for (const [field, tag] of Object.entries({ label: 'strong', sublabel: 'p', meta: 'p' })) {
              if (!badge[field]) continue;
              const node = document.createElement(tag);
              node.className = 'wss-vault-reveal__' + field;
              node.textContent = badge[field];
              item.appendChild(node);
            }
            item.setAttribute('data-wss-kit-vault-reveal-done', '1');
            body.appendChild(item);
          });
          root.replaceChildren(body);
          root.classList.add('wss-vault-reveal');
          root.setAttribute('data-wss-kit-vault-reveal-done', '1');
          root.setAttribute('data-wss-kit-class', 'badges');
          if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.IntersectionObserver) return;
          const observer = new IntersectionObserver(entries => {
            try {
              if (!entries.some(e => e.isIntersecting)) return;
              root.classList.add('wss-vault-reveal--entered');
              observer.disconnect();
            } catch { observer.disconnect(); }
          }, { threshold: 0.15 });
          observer.observe(root);
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
  name: 'vault-reveal',
  version: 1,
  class: 'badges',
  composesWith: Object.freeze(['reviews', 'stats']),
  activation: 'flag:kit_vault_reveal',
  budget: Object.freeze({ family: "vault-reveal", ambientLoop: null, dwell: "1.8s one-shot enter", stagger: "per-item --wss-vault-reveal-delay", maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-vault-reveal { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-vault-reveal__body { display:flex; flex-wrap:wrap; gap:.875rem; }
.wss-vault-reveal__item { flex:1 1 12rem; min-inline-size:0; padding:1.25rem; border:1px solid var(--wss-border); border-radius:1.25rem; background:var(--wss-surface-alt); color:var(--wss-text); opacity:1; translate:none; }
.wss-vault-reveal__label { display:block; font:inherit; font-weight:600; }
.wss-vault-reveal__sublabel, .wss-vault-reveal__meta { margin:.5rem 0 0; overflow-wrap:anywhere; font-size:.875rem; }
@keyframes wss-vault-reveal-enter { from { opacity:.65; translate:0 24px; } to { opacity:1; translate:0 0; } }
@media (prefers-reduced-motion:no-preference) {
  .wss-vault-reveal--entered .wss-vault-reveal__animated { animation:wss-vault-reveal-enter 1.8s cubic-bezier(.16,1,.3,1) var(--wss-vault-reveal-delay) both; }
}
@media (max-width:767px) {
  .wss-vault-reveal__item:nth-child(n+4) { animation:none!important; opacity:1; translate:none; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-vault-reveal, .wss-vault-reveal__body, .wss-vault-reveal__item,
  .wss-vault-reveal__label, .wss-vault-reveal__sublabel, .wss-vault-reveal__meta {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; translate:none!important; opacity:1!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Replaces one credential presentation with the reference vault’s staggered reveal, without a lock overlay, pulse, duplicated credential wall, or blur over factual text. All labels are already readable before intersection; at most four cards on desktop or three on mobile enter once and then remain still. Every credential string comes verbatim from ctx.data.badges. Reviews and a separate statistical treatment provide complementary proof without a second badge module.'
});
