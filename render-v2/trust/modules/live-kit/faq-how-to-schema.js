'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_faq_how_to_schema !== true) return null;
  const h = ctx?.business?.howTo;
  if (!h || typeof h.name !== 'string' || !h.name.trim() || !Array.isArray(h.steps) || !h.steps.length ||
      !h.steps.every(s => s && typeof s.name === 'string' && s.name.trim() && typeof s.text === 'string' && s.text.trim())) return null;
  return { name: h.name, steps: h.steps.map(s => ({ name: s.name, text: s.text })) };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="faq-how-to-schema">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const owner = 'faq-how-to-schema';
          if (document.querySelector('script[data-wss-schema-module="' + owner + '"]')) return;
          const used = new Set((document.documentElement.getAttribute('data-wss-schema-modules') || '').split(' ').filter(Boolean));
          if (!used.has(owner) && used.size >= 2) return;
          let duplicate = false;
          const walk = v => {
            if (!v || typeof v !== 'object') return;
            if (Array.isArray(v)) { v.forEach(walk); return; }
            const types = Array.isArray(v['@type']) ? v['@type'] : [v['@type']];
            if (types.some(t => typeof t === 'string' && t.split(/[\/#]/).pop() === 'HowTo')) duplicate = true;
            Object.values(v).forEach(walk);
          };
          for (const s of document.querySelectorAll('script[type="application/ld+json"]')) walk(JSON.parse(s.textContent));
          if (duplicate) return;
          const normalize = s => s.replace(/\s+/g, ' ').trim();
          const visible = normalize(document.body?.innerText || '');
          if (!visible.includes(normalize(d.name)) || !d.steps.every(s => visible.includes(normalize(s.name)) && visible.includes(normalize(s.text)))) return;
          const graph = {
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: d.name,
            step: d.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text }))
          };
          const node = document.createElement('script');
          node.type = 'application/ld+json';
          node.setAttribute('data-wss-schema-module', owner);
          node.setAttribute('data-wss-kit-faq-how-to-schema-done', '1');
          node.textContent = JSON.stringify(graph).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
          document.head.appendChild(node);
          used.add(owner); document.documentElement.setAttribute('data-wss-schema-modules', Array.from(used).join(' '));
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
  name: 'faq-how-to-schema',
  version: 1,
  class: 'schema',
  composesWith: Object.freeze(['showcase', 'stats']),
  activation: 'flag:kit_faq_how_to_schema',
  budget: Object.freeze({ family: "schema-invisible", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css() { return ''; },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Invisible HowTo-only emitter; FAQPage is deliberately excluded because the engine owns it. Requires an explicit verified ctx.business.howTo extension containing a name and ordered steps, and checks that the same content is visibly present before emitting. Services are never converted into invented procedural instructions. Existing HowTo anywhere in parsed page JSON-LD suppresses output, malformed existing JSON-LD fails closed, and the shared runtime registry permits at most two schema modules.'
});
