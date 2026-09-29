'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_open_now_widget !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || typeof b.timeZone !== 'string' || !Array.isArray(b.hours)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: b.timeZone }).format(new Date(0)); } catch { return null; }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const minute = value => {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };
  const intervals = [], rows = [];
  for (let day = 0; day < 7; day++) {
    const entries = b.hours.filter(h => h?.day === days[day]);
    if (!entries.length || entries.some(h => h.closed === true) && (entries.length !== 1 || entries[0].closed !== true)) return null;
    if (entries[0].closed === true) { rows.push(days[day] + ': closed'); continue; }
    for (const h of entries) {
      const open = minute(h.open), close = h.close === '24:00' ? 1440 : minute(h.close);
      if (open === null || close === null || open === close) return null;
      intervals.push({ start: day * 1440 + open, end: day * 1440 + close + (close < open ? 1440 : 0) });
      rows.push(days[day] + ': ' + h.open + '–' + h.close);
    }
  }
  return { name: b.name, timeZone: b.timeZone, intervals, rows };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="open-now-widget">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="open-now-widget"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-open-now-widget__body')) return;
          const body = document.createElement('details'); body.className = 'wss-open-now-widget__body';
          const summary = document.createElement('summary'); summary.className = 'wss-open-now-widget__status';
          const note = document.createElement('p'); note.className = 'wss-open-now-widget__note';
          note.textContent = 'Based on published weekly hours in ' + d.timeZone + '.';
          const list = document.createElement('ul'); list.className = 'wss-open-now-widget__hours';
          for (const row of d.rows) {
            const item = document.createElement('li'); item.className = 'wss-open-now-widget__day'; item.textContent = row; list.appendChild(item);
          }
          body.append(summary, note, list);
          const formatter = new Intl.DateTimeFormat('en-US', { timeZone: d.timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          function update() {
            try {
              const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(p => [p.type, p.value]));
              const day = days.indexOf(parts.weekday), hour = Number(parts.hour), minute = Number(parts.minute);
              if (day < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return;
              const time = day * 1440 + hour * 60 + minute;
              const open = d.intervals.some(i => (time >= i.start && time < i.end) || (time + 10080 >= i.start && time + 10080 < i.end));
              summary.textContent = d.name + (open ? ' — open according to listed hours' : ' — closed according to listed hours');
              summary.setAttribute('data-wss-open', open ? 'true' : 'false');
            } catch {}
          }
          update();
          if (!summary.textContent) return;
          root.replaceChildren(body); root.classList.add('wss-open-now-widget');
          root.setAttribute('data-wss-kit-open-now-widget-done', '1'); root.setAttribute('data-wss-kit-class', 'cta-accent');
          const timer = setInterval(() => {
            if (!root.isConnected) { clearInterval(timer); return; }
            update();
          }, 30000);
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
  name: 'open-now-widget',
  version: 1,
  class: 'cta-accent',
  composesWith: Object.freeze(['reviews', 'showcase']),
  activation: 'flag:kit_open_now_widget',
  budget: Object.freeze({ family: "open-now-clock", ambientLoop: null, dwell: "open/closed state re-checked on an interval", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-open-now-widget { color:var(--wss-text); background:var(--wss-surface); }
.wss-open-now-widget__body { border:1px solid var(--wss-border); border-radius:1.25rem; padding:1rem; }
.wss-open-now-widget__status { min-block-size:44px; cursor:pointer; font-weight:600; line-height:1.5; }
.wss-open-now-widget__status:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
.wss-open-now-widget__note { margin:.75rem 0; font-size:.875rem; line-height:1.5; }
.wss-open-now-widget__hours { margin:0; padding-inline-start:1.25rem; }
.wss-open-now-widget__day { padding-block:.3rem; line-height:1.5; }
@media (prefers-reduced-motion:reduce) {
  .wss-open-now-widget, .wss-open-now-widget__body, .wss-open-now-widget__status,
  .wss-open-now-widget__note, .wss-open-now-widget__hours, .wss-open-now-widget__day {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Computes scheduled open/closed state from the complete supplied weekly schedule in an explicit verified IANA business timeZone, including split shifts, overnight intervals and the Saturday-to-Sunday boundary. Missing days, ambiguous equal opening/closing times, conflicting closed entries or missing timezone omit the module. No visitor-timezone guess, live-staff claim, holiday assumption, countdown or breathing animation is introduced; the wording explicitly limits the result to published weekly hours.'
});
