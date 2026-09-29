'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { proveSpaContent, replaceDataIsland, emptyChannel } = require('../build/content-proof.cjs');

const client = {
  services: [{ name: 'Cedar Deck Repair' }],
  content: { faqs: [] },
  trust: { reviews: [], hours: null, areas: ['East Side'] },
};
const html = Buffer.from('<html><body><section id="services"></section><script id="wss-client-data" type="application/json">' + JSON.stringify(client) + '</script></body></html>');
function result() {
  return {
    files: { 'index.html': html }, client_data: client,
    content_proof_contract: {
      data_island_id: 'wss-client-data',
      render_targets: { services: [{ path: '/', selector: 'section#services' }] },
      channel_availability: { areas: 'unavailable_until_source_bound_render' },
    },
  };
}
function fakeRender({ files, selectors }) {
  const body = files['index.html'].toString();
  const packet = JSON.parse(body.match(/application\/json">([\s\S]*?)<\/script>/)[1]);
  const text = packet.services.map(x => x.name).join(' ');
  return { ok: true, dataIslandPresent: true, selectors: { [selectors[0]]: { count: 1, visibleText: text } } };
}

test('target vs redacted baseline proves a source atom in visible donor target', async () => {
  const proof = await proveSpaContent(result(), fakeRender);
  assert.equal(proof.ok, true);
  assert.equal(proof.content.channels.services.status, 'passed');
  assert.equal(proof.content.channels.areas.status, 'unavailable');
  assert.equal(proof.content.donor_renders.includes('areas'), false);
  assert.equal(proof.route_render.pages[0].content_channels.services.target_changed, true);
});

test('unchanged visible target fails closed', async () => {
  const proof = await proveSpaContent(result(), ({ selectors }) => ({
    ok: true, dataIslandPresent: true,
    selectors: { [selectors[0]]: { count: 1, visibleText: 'Cedar Deck Repair' } },
  }));
  assert.equal(proof.ok, false);
  assert.equal(proof.content.channels.services.status, 'failed');
});

test('data island replacement only changes certified baseline data', () => {
  const next = replaceDataIsland(html, 'wss-client-data', { ...client, services: [] }).toString();
  assert.match(next, /<section id="services"><\/section>/);
  assert.match(next, /"services":\[\]/);
  assert.doesNotMatch(next, /Cedar Deck Repair/);
});

test('local service baseline keeps donor schema while removing source service words', () => {
  const baseline = emptyChannel(client, 'services');
  assert.equal(baseline.services.length, 1);
  assert.equal(baseline.services[0].name, '__WSS_PROOF_REDACTED_SERVICE_1__');
  assert.equal(client.services[0].name, 'Cedar Deck Repair');
});

test('concrete donor baseline keeps a trade term without retaining source service names', () => {
  const concrete = {
    ...client,
    services: [
      { name: 'Concrete', shortLabel: 'Concrete', description: 'Source backed concrete work' },
      { name: 'Screed Installation', shortLabel: 'Screed Installation', description: 'Source backed screed work' },
    ],
    source: { category: 'concrete' },
  };
  const baseline = emptyChannel(concrete, 'services');
  assert.match(baseline.services[0].name, /\b(concrete|screed|flatwork|demolition)\b/i);
  assert.equal(baseline.services.some(x => x.name === 'Concrete' || x.name === 'Screed Installation'), false);
  assert.equal(baseline.services[0].shortLabel, baseline.services[0].name);
  assert.match(baseline.services[1].name, /concrete|screed|flatwork|demolition|construction|excavation|foundation|driveway|renovation|flooring/i);
  assert.notEqual(baseline.services[0].name, baseline.services[1].name);
  assert.equal(baseline.services.some(x => ['Concrete', 'Screed Installation'].includes(x.name)), false);
});

test('concrete proof renders a trade-safe baseline for every service', async () => {
  const concrete = {
    ...client,
    services: [
      { name: 'Concrete', shortLabel: 'Concrete' },
      { name: 'Screed Installation', shortLabel: 'Screed Installation' },
    ],
    source: { category: 'concrete' },
  };
  const proofResult = result();
  proofResult.client_data = concrete;
  proofResult.files = { 'index.html': Buffer.from(html.toString().replace(JSON.stringify(client), JSON.stringify(concrete))) };
  const tradeRender = (args) => {
    const packet = JSON.parse(args.files['index.html'].toString().match(/application\/json">([\s\S]*?)<\/script>/)[1]);
    const valid = packet.services.every(x => /concrete|screed|flatwork|demolition|construction|excavation|foundation|driveway|renovation|flooring/i.test(x.name));
    const rendered = fakeRender(args);
    return { ...rendered, ok: valid, errors: valid ? [] : ['donor_wrong_trade'] };
  };
  const proof = await proveSpaContent(proofResult, tradeRender);
  assert.equal(proof.ok, true);
  assert.equal(proof.route_render.pages[0].content_channels.services.baseline_checked, true);
  assert.equal(proof.route_render.pages[0].content_channels.services.rendered, 2);
});

test('electrical and fencing baselines retain only a trade signal', () => {
  for (const [category, names, trade] of [
    ['electrical', ['Residential Electrical Upgrades', 'Electric'], /electric|wiring|circuit|outlet|panel|generator|lighting/i],
    ['fencing', ['Privacy Fence Installation', 'Custom Gates'], /\bfenc(?:e|es|ing)\b/i],
  ]) {
    const source = { ...client, services: names.map(name => ({ name, shortLabel: name })), source: { category } };
    const baseline = emptyChannel(source, 'services');
    for (let i = 0; i < names.length; i++) {
      assert.match(baseline.services[i].name, trade);
      assert.equal(baseline.services[i].shortLabel, baseline.services[i].name);
      assert.notEqual(baseline.services[i].name, names[i]);
      for (const original of names) assert.equal(baseline.services[i].name.toLowerCase().includes(original.toLowerCase()), false);
    }
  }
});

test('electrical donor accepts the redacted baseline without admitting original service copy', () => {
  const { serviceKind } = require('../donors/catalog/38-grounded-north-west/source/src/lib/service-kind.cjs');
  const electrical = {
    ...client,
    services: [{ name: 'Residential Electrical Upgrades', shortLabel: 'Residential Electrical Upgrades' }],
    source: { category: 'electrical' },
  };
  const baseline = emptyChannel(electrical, 'services');
  assert.ok(serviceKind(baseline.services[0]));
  assert.doesNotMatch(baseline.services[0].name, /Residential Electrical Upgrades/i);
});

test('fencing mappings refuse a category label with no fence service', () => {
  const facts = { category: 'fencing', name: 'Texas Urban Elements', city: 'Dallas', state: 'TX', phone: '555-555-5555', website: 'https://example.test' };
  const services = [{ name: 'Patio Design', description: 'Source-backed patio design and landscaping work.', file: 'content/services/patio-design.md' }];
  const files = { 'content/home.md': 'Source-backed business home copy of sufficient length.', 'content/about.md': 'Source-backed business about copy of sufficient length.', 'content/services/patio-design.md': services[0].description };
  for (const key of ['42-straight-line-fencing-of-louisiana', '49-straight-line-fencing-of-louisiana']) {
    const { mapDonor } = require('../donors/catalog/' + key + '/mapping.cjs');
    assert.throws(() => mapDonor({ facts, services, files, manifest: { category: 'fencing' } }), /wrong_trade|fencing_services_required/);
  }
});
