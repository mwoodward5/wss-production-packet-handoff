'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_review_schema_bridge !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || typeof b.schemaId !== 'string' || !b.schemaId.trim()) return null;
  const a = ctx?.data?.aggregate ?? b.reviewAggregate;
  const aggregate = a && Number.isFinite(a.rating) && a.rating >= 0 && a.rating <= 5 &&
    Number.isSafeInteger(a.count) && a.count > 0 ? { rating: a.rating, count: a.count } : null;
  const reviews = (Array.isArray(ctx?.data?.reviews) ? ctx.data.reviews : []).filter(r =>
    r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim() &&
    typeof (r.name ?? r.author) === 'string' && (r.name ?? r.author).trim()
  ).map(r => ({
    quote: r.quote ?? r.text, author: r.name ?? r.author,
    rating: Number.isFinite(r.rating) && r.rating >= 0 && r.rating <= 5 ? r.rating : null
  }));
  return aggregate || reviews.length ? { name: b.name, schemaId: b.schemaId, aggregate, reviews } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="review-schema-bridge">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const owner = 'review-schema-bridge';
          const used = new Set((document.documentElement.getAttribute('data-wss-schema-modules') || '').split(' ').filter(Boolean));
          if (!used.has(owner) && used.size >= 2) return;
          const records = [], types = new Set(), matches = [];
          function walk(v, record) {
            if (!v || typeof v !== 'object') return;
            if (Array.isArray(v)) { v.forEach(x => walk(x, record)); return; }
            for (const t of Array.isArray(v['@type']) ? v['@type'] : [v['@type']]) {
              if (typeof t === 'string') types.add(t.split(/[\/#]/).pop());
            }
            if (v['@id'] === d.schemaId && v.name === d.name && v['@type']) matches.push({ value: v, record });
            Object.values(v).forEach(x => walk(x, record));
          }
          for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
            const record = { node, json: JSON.parse(node.textContent) }; records.push(record); walk(record.json, record);
          }
          if (matches.length !== 1) return;
          const hit = matches[0], base = hit.value;
          const normalize = s => s.replace(/\s+/g, ' ').trim();
          const islands = Array.from(document.querySelectorAll('#reviews,#trust,.wss-kit-slot[data-wss-slot="reviews"]'));
          const visible = normalize(islands.map(n => n.innerText || '').join(' '));
          const own = key => Object.prototype.hasOwnProperty.call(base, key);
          let changed = false;
          if (d.aggregate && !own('aggregateRating') && !types.has('AggregateRating')) {
            const plain = visible.replace(/,/g, '');
            if (plain.includes(String(d.aggregate.rating)) && plain.includes(String(d.aggregate.count))) {
              base.aggregateRating = { '@type': 'AggregateRating', ratingValue: d.aggregate.rating, reviewCount: d.aggregate.count, bestRating: 5 };
              changed = true;
            }
          }
          if (!own('review') && !types.has('Review')) {
            const reviews = d.reviews.filter(r => visible.includes(normalize(r.quote)) && visible.includes(normalize(r.author)));
            if (reviews.length) {
              base.review = reviews.map(r => {
                const review = { '@type': 'Review', author: { '@type': 'Person', name: r.author }, reviewBody: r.quote };
                if (r.rating !== null) review.reviewRating = { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 };
                return review;
              });
              changed = true;
            }
          }
          if (!changed) return;
          hit.record.node.textContent = JSON.stringify(hit.record.json)
            .replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
          hit.record.node.setAttribute('data-wss-kit-review-schema-bridge-done', '1');
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
  name: 'review-schema-bridge',
  version: 1,
  class: 'schema',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_review_schema_bridge',
  budget: Object.freeze({ family: "schema-invisible", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css() { return ''; },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Enriches the single existing entity identified by the explicit ctx.business.schemaId and exact business name, rather than emitting another base entity. Adds missing AggregateRating and Review properties only when their facts are visible and the corresponding types are absent elsewhere. Existing properties, including explicitly null properties, are preserved. Omits unproved publishers, relative dates, roles and locations. No search-result eligibility or star-display outcome is promised.'
});
