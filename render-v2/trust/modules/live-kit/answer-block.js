'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_answer_block !== true) return null;
  const b = ctx?.business;
  if (!b || ![b.name, b.city, b.state].every(x => typeof x === 'string' && x.trim())) return null;
  const place = b.city + ', ' + b.state;
  const items = [{ question: 'Where is ' + b.name + ' based?', answer: b.name + ' is based in ' + place + '.' }];
  const areas = Array.isArray(b.serviceAreas) ? b.serviceAreas.filter(x => typeof x === 'string' && x.trim()) : [];
  const services = Array.isArray(b.services) ? b.services.filter(x => x && typeof x.name === 'string' && x.name.trim()).map(x => x.name) : [];
  if (areas.length) items.push({ question: 'Which areas does ' + b.name + ' serve?', answer: b.name + ', based in ' + place + ', serves ' + areas.join(', ') + '.' });
  if (services.length) items.push({ question: 'Which services does ' + b.name + ' offer?', answer: b.name + ' in ' + place + ' offers ' + services.join(', ') + '.' });
  return items;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="answer-block">(' + function (items) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="answer-block"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-answer-block__body')) return;
          const body = document.createElement('div'); body.className = 'wss-answer-block__body';
          items.forEach((item, i) => {
            const details = document.createElement('details'); details.className = 'wss-answer-block__item'; details.open = i === 0;
            const summary = document.createElement('summary'); summary.className = 'wss-answer-block__question'; summary.textContent = item.question;
            const answer = document.createElement('p'); answer.className = 'wss-answer-block__answer'; answer.textContent = item.answer;
            details.append(summary, answer); body.appendChild(details);
          });
          root.replaceChildren(body); root.classList.add('wss-answer-block');
          root.setAttribute('data-wss-kit-answer-block-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'answer-block',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_answer_block',
  budget: Object.freeze({ family: "answer-cards", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-answer-block { color:var(--wss-text); background:var(--wss-surface); }
.wss-answer-block__body { display:flex; flex-direction:column; gap:.75rem; max-inline-size:50rem; margin-inline:auto; }
.wss-answer-block__item { border:1px solid var(--wss-border); border-radius:1.25rem; background:var(--wss-surface); overflow:hidden; }
.wss-answer-block__item[open] { border-color:var(--wss-text); }
.wss-answer-block__question { padding:1.25rem; min-block-size:44px; box-sizing:border-box; cursor:pointer; font-weight:600; }
.wss-answer-block__question:focus-visible { outline:2px solid var(--wss-text); outline-offset:-4px; }
.wss-answer-block__answer { margin:0; padding:0 1.25rem 1.25rem; line-height:1.65; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-answer-block, .wss-answer-block__body, .wss-answer-block__item, .wss-answer-block__question, .wss-answer-block__answer {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Native disclosure cards contain complete factual answers naming the business and its supplied city/state. Only actual location, listed service areas and named services are used; no free-estimate, insurance, warranty, response-time or pricing sentence is inferred. The module emits no FAQ JSON-LD because the engine already owns that type. An explicit engine-assigned replacement slot prevents a second answer treatment.'
});
