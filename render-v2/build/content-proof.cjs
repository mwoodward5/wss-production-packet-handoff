'use strict';

const { safeJson } = require('./metadata.cjs');

const CHANNELS = ['services', 'faqs', 'reviews', 'hours', 'areas'];
const ORIGIN = 'http://wss-proof.local';

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function atoms(client, channel) {
  const rows = channel === 'services' ? (client.services || []).map(x => x.name)
    : channel === 'faqs' ? (client.content?.faqs || []).map(x => x.q)
      : channel === 'reviews' ? (client.trust?.reviews || []).map(x => x.text)
        : channel === 'hours' ? [client.trust?.hours?.text]
          : (client.trust?.areas || []);
  return [...new Set(rows.map(norm).filter(x => x.length >= 4))];
}
function redactedServiceName(client, index) {
  const originals = atoms(client, 'services');
  const tradeTerms = {
    concrete: ['Concrete', 'Screed', 'Flatwork', 'Demolition', 'Construction', 'Excavation', 'Foundation', 'Driveway', 'Renovation', 'Flooring'],
    electrical: ['Electrical', 'Electric', 'Wiring', 'Circuit', 'Outlet', 'Panel', 'Generator', 'Lighting'],
    fencing: ['Fence', 'Fencing', 'Fences'],
  }[client.source?.category];
  if (tradeTerms) {
    // Keep the local baseline inside the donor's trade guard while removing
    // every complete certified service name. The baseline is never published.
    for (const term of tradeTerms) {
      const label = term + ' baseline sentinel ' + (index + 1);
      if (originals.every(atom => !norm(label).includes(atom))) return label;
    }
    throw new Error('spa_content_proof_trade_safe_baseline_unavailable');
  }
  return '__WSS_PROOF_REDACTED_SERVICE_' + (index + 1) + '__';
}
function emptyChannel(client, channel) {
  const copy = JSON.parse(JSON.stringify(client));
  // The donor rejects an empty services array. Keep its schema valid while
  // removing every source service name in this local, never-published baseline.
  if (channel === 'services') {
    copy.services = copy.services.map((service, index) => ({
      ...service,
      name: redactedServiceName(client, index),
      shortLabel: redactedServiceName(client, index),
    }));
    copy.content.serviceIntro = '__WSS_PROOF_REDACTED_SERVICE_INTRO__';
  }
  if (channel === 'faqs') copy.content.faqs = [];
  if (channel === 'reviews') { copy.trust.reviews = []; copy.trust.aggregate = null; }
  if (channel === 'hours') copy.trust.hours = null;
  if (channel === 'areas') { copy.trust.areas = []; delete copy.trust.areaSources; }
  return copy;
}
function replaceDataIsland(bytes, islandId, client) {
  const html = Buffer.from(bytes).toString('utf8');
  const id = String(islandId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(<script\\s+id=["\\\']' + id + '["\\\'][^>]*type=["\\\']application/json["\\\'][^>]*>)[\\s\\S]*?(<\\/script>)', 'i');
  if (!re.test(html)) throw new Error('spa_content_proof_data_island_missing');
  return Buffer.from(html.replace(re, (_, open, close) => open + safeJson(client) + close));
}
function routesFor(files) {
  const routes = { '/': 'index.html', '/index.html': 'index.html' };
  for (const rel of Object.keys(files)) {
    routes['/' + rel] = rel;
    if (rel.endsWith('/index.html')) {
      const base = '/' + rel.slice(0, -'/index.html'.length);
      routes[base] = rel; routes[base + '/'] = rel;
    }
  }
  return routes;
}
function baselineFiles(result, channel) {
  const files = { ...result.files };
  const client = emptyChannel(result.client_data, channel);
  for (const [rel, bytes] of Object.entries(files)) {
    if (rel === 'index.html' || rel.endsWith('/index.html')) {
      files[rel] = replaceDataIsland(bytes, result.content_proof_contract.data_island_id, client);
    }
  }
  return files;
}
function mime(rel) {
  if (rel.endsWith('.html')) return 'text/html; charset=utf-8';
  if (rel.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (rel.endsWith('.css')) return 'text/css; charset=utf-8';
  if (rel.endsWith('.json')) return 'application/json; charset=utf-8';
  if (rel.endsWith('.svg')) return 'image/svg+xml';
  if (rel.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/.test(rel)) return 'image/jpeg';
  if (rel.endsWith('.webp')) return 'image/webp';
  if (/\.woff2?$/.test(rel)) return 'font/woff2';
  return 'application/octet-stream';
}
async function renderDom({ files, routeMap, path, selectors, dataIslandId }) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let badLocalAsset = false;
    const errors = [];
    page.on('pageerror', (error) => { badLocalAsset = true; errors.push(String(error?.message || error).slice(0, 150)); });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
      const rel = routeMap[url.pathname];
      if (!rel || !files[rel]) { badLocalAsset = true; errors.push('missing_local_asset:' + url.pathname); return route.fulfill({ status: 404, body: 'not found' }); }
      return route.fulfill({ status: 200, contentType: mime(rel), body: files[rel] });
    });
    await page.goto(ORIGIN + path, { waitUntil: 'load', timeout: 8000 });
    await page.evaluate(() => new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; observer.disconnect(); resolve(); } };
      let quiet = setTimeout(done, 250);
      const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 250); });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      setTimeout(done, 3500);
    }));
    const snapshot = await page.evaluate(({ selectors, dataIslandId }) => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
      };
      const rows = {};
      for (const selector of selectors) {
        const found = [...document.querySelectorAll(selector)].filter(visible);
        rows[selector] = { count: found.length, visibleText: found.map(el => el.innerText || '').join('\n') };
      }
      return { dataIslandPresent: Boolean(document.getElementById(dataIslandId)), selectors: rows };
    }, { selectors, dataIslandId });
    return { ok: !badLocalAsset, errors, ...snapshot };
  } finally { await browser.close(); }
}

async function proveSpaContent(result, renderer = renderDom) {
  if (!result?.content_proof_contract) throw new Error('spa_content_proof_contract_missing');
  const contract = result.content_proof_contract;
  const channelReports = {};
  const pages = new Map();
  let failed = false;
  let dataIsland = true;
  const donorRenders = [];
  for (const channel of CHANNELS) {
    const declared = contract.render_targets[channel] || [];
    const sourceAtoms = atoms(result.client_data, channel);
    const unavailable = String(contract.channel_availability[channel] || '').startsWith('unavailable');
    if (unavailable) {
      channelReports[channel] = { status: 'unavailable', reason: contract.channel_availability[channel], source_present: sourceAtoms.length > 0 };
      continue;
    }
    if (!sourceAtoms.length) { channelReports[channel] = { status: 'absent', rendered: 0 }; continue; }
    if (!declared.length) {
      failed = true;
      channelReports[channel] = { status: 'failed', reason: 'no_target_declared', rendered: 0 };
      continue;
    }
    donorRenders.push(channel);
    let passed = false;
    for (const target of declared) {
      const route = target.path || '/';
      const selector = target.selector;
      const targetDom = await renderer({ files: result.files, routeMap: routesFor(result.files), path: route, selectors: [selector], dataIslandId: contract.data_island_id });
      const baseFiles = baselineFiles(result, channel);
      const baselineDom = await renderer({ files: baseFiles, routeMap: routesFor(baseFiles), path: route, selectors: [selector], dataIslandId: contract.data_island_id });
      dataIsland = dataIsland && targetDom?.dataIslandPresent === true && baselineDom?.dataIslandPresent === true;
      const targetRow = targetDom?.selectors?.[selector] || {};
      const baselineRow = baselineDom?.selectors?.[selector] || {};
      const targetText = norm(targetRow.visibleText);
      const baseText = norm(baselineRow.visibleText);
      const novel = sourceAtoms.filter(atom => targetText.includes(atom) && !baseText.includes(atom));
      const targetChecked = targetDom?.ok === true && Number(targetRow.count) > 0;
      const baselineChecked = baselineDom?.ok === true && Number(baselineRow.count) > 0;
      const targetChanged = targetChecked && baselineChecked && targetText !== baseText;
      const rendered = targetChanged ? novel.length : 0;
      const row = pages.get(route) || { path: route, content_channels: {} };
      row.content_channels[channel] = {
        targets_expected: declared.length, target_checked: targetChecked, baseline_checked: baselineChecked,
        target_changed: targetChanged, rendered,
        ...(targetDom?.errors?.length ? { target_errors: targetDom.errors } : {}),
        ...(baselineDom?.errors?.length ? { baseline_errors: baselineDom.errors } : {}),
      };
      pages.set(route, row);
      if (targetChecked && baselineChecked && targetChanged && rendered > 0) passed = true;
    }
    if (!passed || !pages.get('/')?.content_channels?.[channel]?.rendered) failed = true;
    channelReports[channel] = { status: passed ? 'passed' : 'failed', rendered: pages.get('/')?.content_channels?.[channel]?.rendered || 0 };
  }
  if (!donorRenders.length) failed = true;
  const status = !failed && dataIsland ? 'passed' : 'failed';
  return {
    ok: status === 'passed',
    content: {
      version: 'wss-spa-content-proof-v1', status, data_island: dataIsland,
      donor_consumes_content: donorRenders.length > 0, donor_renders: donorRenders,
      sections: 0, channels: channelReports,
    },
    route_render: { status, pages: [...pages.values()] },
  };
}

module.exports = Object.freeze({ proveSpaContent, renderDom, atoms, emptyChannel, replaceDataIsland, baselineFiles });
