'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { metadata } = require('../build/metadata.cjs');
const { normalize } = require('../contracts/client-site-data.cjs');
const prior = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../evidence/burns-build-result.json'), 'utf8')).client_data;
function client(category) {
  const data = structuredClone(prior);
  data.identity.businessName = 'Synthetic Test Company';
  data.source.category = category;
  return normalize(data);
}
test('canonical category survives normalization for the donor data island', () => {
  assert.equal(client('roofing').source.category, 'roofing');
  assert.throws(() => client(''), /client_data_string_length/);
});
test('roofing metadata is never emitted as landscaping', () => {
  const result = metadata(client('roofing'));
  assert.match(result.title, /Roofing in/);
  assert.equal(result.schemaGraph[0]['@type'], 'RoofingContractor');
  assert.doesNotMatch(result.head, /LandscapingBusiness|Landscaping in/);
});
test('electrical metadata uses the real Electrician subtype', () => {
  const result = metadata(client('electrical'));
  assert.match(result.title, /Electrical in/);
  assert.equal(result.schemaGraph[0]['@type'], 'Electrician');
});
test('uncatalogued schema subtypes stay valid LocalBusiness, not a fabricated type', () => {
  assert.equal(metadata(client('photographer')).schemaGraph[0]['@type'], 'LocalBusiness');
});
test('landscaping uses a defined construction business type', () => {
  assert.equal(metadata(client('landscaping')).schemaGraph[0]['@type'],
    'HomeAndConstructionBusiness');
});
test('missing category cannot silently create a landscaping site', () => {
  const data = structuredClone(prior);
  delete data.source.category;
  assert.throws(() => metadata(data), /metadata_certified_category_required/);
});
test('JSON-LD data cannot close the script element', () => {
  const data = structuredClone(client('roofing'));
  data.identity.businessName = 'Test </script><script>alert(1)</script>';
  const result = metadata(data);
  assert.doesNotMatch(result.head, /<script>alert\(1\)/);
  assert.match(result.head, /\\u003c/);
});
test('missing coordinates never turn into a false zero-zero map pin', () => {
  for (const [lat, lng] of [[null, null], ['', ''], [' ', ' '], [false, false],
    [91, 0], [0, -181], [NaN, 0]]) {
    const sitePlan = { localPresence: { mapAndDirections: {
      geo: { verified: true, schemaAllowed: true, lat, lng },
    } } };
    assert.equal(metadata(client('roofing'), { sitePlan }).schemaGraph[0].geo, undefined);
  }
});
test('explicitly verified coordinates are preserved exactly', () => {
  const sitePlan = { localPresence: { mapAndDirections: {
    geo: { verified: true, schemaAllowed: true, lat: 33.6, lng: -117.7 },
  } } };
  assert.deepEqual(metadata(client('roofing'), { sitePlan }).schemaGraph[0].geo,
    { '@type': 'GeoCoordinates', latitude: 33.6, longitude: -117.7 });
  sitePlan.localPresence.mapAndDirections.geo.schemaAllowed = false;
  assert.equal(metadata(client('roofing'), { sitePlan }).schemaGraph[0].geo, undefined);
});
