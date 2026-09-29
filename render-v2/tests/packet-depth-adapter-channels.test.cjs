'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { depthReviews, depthHours, depthFaqs, depthAreas, depthAreaSources, verifiedReviews, verifiedAreas } = require('../adapters/genie-to-client.cjs');

function facts(depth_channels) { return { discovery: { found: { depth_channels } } }; }
const source_url = 'https://example.com/source';
const evidence = 'Exact text observed on the source page.';

test('maps source-backed depth channels and carries provenance', () => {
  const input = facts({
    reviews: [{ quote: 'A thorough job from start to finish.', author: 'A. Customer', source_url, evidence }],
    hours: [{ value: 'Monday: 8:00 AM–5:00 PM', source_url, evidence }],
    faqs: [{ question: 'Do you offer estimates?', answer: 'Yes, contact us to arrange an estimate.', source_url, evidence }],
    areas: [{ value: 'Springfield', source_url, evidence }],
  });
  assert.deepEqual(depthReviews(input), [{ author: 'A. Customer', text: 'A thorough job from start to finish.', sourceUrl: source_url, evidence, rating: null }]);
  assert.deepEqual(depthHours(input), { text: 'Monday: 8:00 AM–5:00 PM', sourceUrl: source_url, evidence });
  assert.deepEqual(depthFaqs(input), [{ q: 'Do you offer estimates?', a: 'Yes, contact us to arrange an estimate.', sourceUrl: source_url, evidence }]);
  assert.deepEqual(depthAreas(input), ['Springfield']);
  assert.deepEqual(depthAreaSources(input), [{ value: 'Springfield', sourceUrl: source_url, evidence }]);
});

test('omits missing, unsourced, and malformed depth rather than making copy', () => {
  assert.deepEqual(depthReviews({}), []);
  assert.equal(depthHours({}), null);
  assert.deepEqual(depthFaqs({}), []);
  assert.deepEqual(depthAreas({}), []);
  const input = facts({
    reviews: [{ quote: 'An invented review paragraph.', author: 'Person', source_url }],
    hours: [{ value: 'Always open', source_url: 'http://example.com', evidence }],
    faqs: [{ question: 'Can I book?', answer: 'Yes, you can book with our office.', source_url, evidence: '' }],
    areas: [{ value: 'Anywhere', source_url, evidence: '' }],
  });
  assert.deepEqual(depthReviews(input), []);
  assert.equal(depthHours(input), null);
  assert.deepEqual(depthFaqs(input), []);
  assert.deepEqual(depthAreas(input), []);
});

test('legacy review and area paths do not admit unsourced claims', () => {
  assert.deepEqual(verifiedReviews({ trust: { reviews: [{ author: 'A Customer', text: 'Excellent work on the project.', source_url }] } }), []);
  assert.equal(verifiedReviews({ trust: { reviews: [{ author: 'A Customer', text: 'Excellent work on the project.', source_url, evidence }] } }).length, 1);
  assert.deepEqual(verifiedAreas({ discovery: { found: { areas: ['Fakeville'] } } }), []);
  assert.deepEqual(verifiedAreas(facts({ areas: [{ value: 'Springfield', source_url, evidence }] })), ['Springfield']);
});
