'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../contracts/client-site-data.cjs');
const { applyUniversalContract } = require('../adapters/universal-contract.cjs');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../evidence/burns-build-result.json'), 'utf8')).client_data;
const fresh = () => structuredClone(baseline);

test('source-backed depth survives normalization while absent channels stay empty', () => {
  const data = fresh();
  data.content.faqs = [{ q: 'Where do you work?', a: 'We work in the listed service area.', sourceUrl: 'https://example.com/faq', evidence: 'FAQ on business site' }];
  data.trust.reviews = [{ author: 'A Customer', text: 'The work was completed on time.', rating: 5, sourceUrl: 'https://example.com/review', evidence: 'Published review' }];
  data.trust.hours = { text: 'Monday: 9–5', sourceUrl: 'https://example.com/hours', evidence: 'Hours page' };
  data.trust.areas = ['Springfield'];
  data.trust.areaSources = [{ value: 'Springfield', sourceUrl: 'https://example.com/areas', evidence: 'Service area page' }];
  const out = normalize(data);
  assert.equal(out.content.faqs[0].evidence, 'FAQ on business site');
  assert.equal(out.trust.reviews[0].evidence, 'Published review');
  assert.equal(out.trust.hours.sourceUrl, 'https://example.com/hours');
  assert.equal(out.trust.areaSources[0].value, 'Springfield');
  const empty = fresh();
  empty.content.faqs = []; empty.trust.reviews = []; empty.trust.hours = null;
  empty.trust.areas = []; empty.trust.areaSources = [];
  assert.equal(Object.hasOwn(normalize(empty).trust, 'areaSources'), false);
  assert.equal(normalize(empty).trust.hours, null);
});

test('invalid or half-bound evidence fails closed', () => {
  const data = fresh();
  data.content.faqs = [{ q: 'Where do you work?', a: 'We work in the listed service area.', sourceUrl: 'https://example.com/faq' }];
  assert.throws(() => normalize(data), /client_data_provenance_pair_required/);
  data.content.faqs[0].evidence = 'Business FAQ';
  data.trust.hours = { text: 'Monday: 9–5', sourceUrl: 'http://example.com/hours', evidence: 'Hours page' };
  assert.throws(() => normalize(data), /client_data_url_invalid/);
  data.trust.hours = null;
  data.trust.areaSources = [{ value: 'Springfield', sourceUrl: 'https://example.com', evidence: '' }];
  assert.throws(() => normalize(data), /client_data_string_length/);
});

test('new source-bound packets require 1:1 provenance for every depth claim', () => {
  const data = fresh();
  data.source.depthProvenance = 'source-bound-v1';
  data.trust.hours = null;
  data.trust.areas = [];
  assert.equal(normalize(data).source.depthProvenance, 'source-bound-v1');
  data.content.faqs = [{ q: 'Where do you work?', a: 'We work in the listed service area.' }];
  assert.throws(() => normalize(data), /client_data_provenance_pair_required/);
  data.content.faqs = [];
  data.trust.reviews = [{ author: 'A Customer', text: 'Excellent work on the project.', sourceUrl: 'https://example.com/review' }];
  assert.throws(() => normalize(data), /client_data_provenance_pair_required/);
  data.trust.reviews = [];
  data.trust.hours = { text: 'Monday: 9-5' };
  assert.throws(() => normalize(data), /client_data_provenance_pair_required/);
  data.trust.hours = null;
  data.trust.areas = ['Fakeville', 'Springfield'];
  data.trust.areaSources = [{ value: 'Springfield', sourceUrl: 'https://example.com/areas', evidence: 'Springfield service area' }];
  assert.throws(() => normalize(data), /client_data_area_sources_mismatch/);
  data.trust.areas = ['Springfield'];
  assert.equal(normalize(data).trust.areaSources[0].value, 'Springfield');
});

test('empty certified depth stays empty through the rich adapter', () => {
  const data = fresh();
  data.source.depthProvenance = 'source-bound-v1';
  data.trust.hours = null;
  data.trust.areas = [];
  data.content.faqs = [];
  const google = { status: 'mapped', fields: { gbpLink: 'https://example.com/profile', hours: 'Always open', serviceArea: 'Fakeville' } };
  const out = applyUniversalContract(data, path.join(__dirname, '../fixtures'), { google }).client;
  assert.equal(out.trust.hours, null);
  assert.deepEqual(out.trust.areas, []);
  assert.deepEqual(out.content.faqs, []);
});
