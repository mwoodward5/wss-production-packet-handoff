'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_citation_footer !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim()) return null;
  let phone = null;
  if (typeof b.phone === 'string' && /^\+?[\d().\s-]{7,30}$/.test(b.phone)) {
    const digits = b.phone.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) phone = { display: b.phone, value: (b.phone.trim().startsWith('+') ? '+' : '') + digits };
  }
  const socials = (Array.isArray(b.socials) ? b.socials : []).filter(s => {
    if (!s || typeof s.url !== 'string' || typeof (s.label ?? s.network ?? s.platform) !== 'string') return false;
    try { const u = new URL(s.url); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
  }).map(s => ({ label: s.label ?? s.network ?? s.platform, url: s.url }));
  return { name: b.name, address: typeof b.address === 'string' ? b.address : '', phone, socials };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="citation-footer">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="citation-footer"]');
          if (!root || !root.closest('footer,[role="contentinfo"]') || root.closest('form,[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-citation-footer__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-citation-footer__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), name = make('p', 'name', d.name);
          body.appendChild(name);
          if (d.address) body.appendChild(make('address', 'address', d.address));
          if (d.phone) {
            const phone = make('a', 'link', d.phone.display); phone.href = 'tel:' + d.phone.value; body.appendChild(phone);
          }
          if (d.socials.length) {
            const links = make('div', 'socials');
            for (const social of d.socials) {
              const link = make('a', 'link', social.label); link.href = social.url; link.rel = 'noopener noreferrer'; links.appendChild(link);
            }
            body.appendChild(links);
          }
          root.replaceChildren(body); root.classList.add('wss-citation-footer');
          root.setAttribute('data-wss-kit-citation-footer-done', '1'); root.setAttribute('data-wss-kit-class', 'social');
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
  name: 'citation-footer',
  version: 1,
  class: 'social',
  composesWith: Object.freeze(['reviews', 'showcase']),
  activation: 'flag:kit_citation_footer',
  budget: Object.freeze({ family: "citation-footer", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-citation-footer { color:var(--wss-text); background:var(--wss-surface); animation:none; transition:none; }
.wss-citation-footer__body { display:flex; flex-direction:column; align-items:flex-start; gap:.75rem; padding-block:1rem; border-block-start:1px solid var(--wss-border); }
.wss-citation-footer__name { margin:0; font-weight:600; overflow-wrap:anywhere; }
.wss-citation-footer__address { margin:0; font-style:normal; line-height:1.65; overflow-wrap:anywhere; }
.wss-citation-footer__socials { display:flex; flex-wrap:wrap; gap:.75rem; }
.wss-citation-footer__link { display:inline-flex; align-items:center; min-block-size:44px; color:var(--wss-text); text-decoration:underline; text-underline-offset:.2em; overflow-wrap:anywhere; }
.wss-citation-footer__link:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
.wss-citation-footer__body, .wss-citation-footer__name, .wss-citation-footer__address,
.wss-citation-footer__socials, .wss-citation-footer__link { animation:none; transition:none; }
@media (prefers-reduced-motion:reduce) {
  .wss-citation-footer, .wss-citation-footer__body, .wss-citation-footer__name,
  .wss-citation-footer__address, .wss-citation-footer__socials, .wss-citation-footer__link {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Flag-only, strictly static replacement of an existing footer citation/social slot. It neither creates a second footer nor animates inside one. Exact supplied name, string address, optional telephone and verified HTTPS social identities are retained. The reference LocalBusiness microdata and shimmer are intentionally removed to avoid duplicate entity markup and the footer-animation prohibition. Links cause no request until a visitor activates them.'
});
