'use strict';

/**
 * test/veo-clip-runner-live-ground-truth.test.js
 *
 * Live Station contract tests — retargeted at the live runner
 * (scripts/ads-station/animate-image-runner.cjs) per issue #353.
 *
 * These tests encode the six live-measured facts from PR #350:
 *   1. Two scene clips are produced and joined (not first-clip-wins).
 *   2. Crop dialog Select is pressed before Save becomes pressable.
 *   3. Success is the (1/1) counter, never just a Save click.
 *   4. Google's refusal text is preserved verbatim.
 *   5. Queries are scoped to the open modal (checked via static analysis).
 *   6. Stale video elements from before Generate are excluded.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const station = require('../scripts/ads-station/animate-image-runner.cjs');
const { runVeoClipJob, mp4DurationSeconds, SIMGAD_PREFIX } = station;

const LEGACY = 'https://legacy-roofer.example.com/';
const ADS_PARAMS = 'ocid=123&euid=abc&authuser=0';
const FAST = {
  scanTimeoutMs: 40,
  scanPollMs: 1,
  saveTimeoutMs: 40,
  fillTimeoutMs: 40,
  generateTimeoutMs: 40,
  generatePollMs: 1,
  stepPauseMs: 0,
};

function box(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function makeMp4(seconds, timescale = 1000) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt8(0, 0);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16);
  return Buffer.concat([
    box('ftyp', Buffer.from('isomisom\u0000\u0000\u0002\u0000avc1mp41', 'latin1')),
    box('moov', box('mvhd', mvhd)),
  ]);
}

function job() {
  return {
    prospectId: 'p-live-ground-truth',
    sourceUrl: LEGACY,
    adsParams: ADS_PARAMS,
    timing: FAST,
  };
}

function livePage(overrides = {}) {
  const state = {
    filled: 0,
    saveClicks: 0,
    cropSelects: 0,
    generateClicks: 0,
    acceptance: 0,
    requirementError: '',
    cropRequired: false,
    acceptedWithoutCrop: true,
    staleClips: ['blob:https://ads.google.com/stale-preview'],
    generatedClips: [
      'blob:https://ads.google.com/scene-1',
      'blob:https://ads.google.com/scene-2',
    ],
    clipBytes: new Map([
      ['blob:https://ads.google.com/scene-1', makeMp4(5)],
      ['blob:https://ads.google.com/scene-2', makeMp4(5)],
      ['blob:https://ads.google.com/stale-preview', makeMp4(10)],
    ]),
    downloads: [],
    ...overrides,
  };

  return {
    state,
    async goto() {},
    async adBlockerNotice() { return { present: false, text: '' }; },
    async videoLengthLabel() { return 'Video length 10s'; },
    async adaptImagesChecked() { return false; },
    async setAdaptImagesChecked() { return false; },
    async sceneSlots() { return { addButtons: Math.max(0, 2 - state.filled), filled: state.filled }; },
    async clickAddScene() { state.acceptance = 0; return true; },
    async modalTabs() { return ['Website or social', 'Free stock images', 'Upload']; },
    async clickModalTab(name) { return name === 'Website or social' || name === 'Upload'; },
    async fillScanUrl(url) { return url === LEGACY; },
    async submitScanUrl() { return true; },
    async scanResults() {
      return [
        { index: 0, src: `${SIMGAD_PREFIX}owned-a` },
        { index: 1, src: `${SIMGAD_PREFIX}owned-b` },
      ];
    },
    async selectScanResult(index) {
      if (!state.cropRequired && state.acceptedWithoutCrop && !state.requirementError) state.acceptance = 1;
      return index === 0 || index === 1;
    },
    async resolveCropDialog() {
      if (!state.cropRequired) return { present: false, ok: true };
      state.cropSelects += 1;
      if (!state.requirementError) state.acceptance = 1;
      return { present: true, ok: true };
    },
    async imageAcceptanceCount() { return state.acceptance; },
    async imageRequirementError() { return state.requirementError; },
    async saveEnabled() { return state.forceSaveEnabled === true || state.acceptance === 1; },
    async clickSave() {
      state.saveClicks += 1;
      if (state.acceptance !== 1) return false;
      state.filled += 1;
      return true;
    },
    async uploadIntoModal() { return false; },
    async generateEnabled() { return state.filled === 2; },
    async clickGenerate() { state.generateClicks += 1; return state.filled === 2; },
    async expectedClipCount() { return 2; },
    async clipSources() {
      return state.generateClicks ? [...state.staleClips, ...state.generatedClips] : state.staleClips.slice();
    },
    async downloadClip(src) {
      state.downloads.push(src);
      const bytes = state.clipBytes.get(src);
      if (!bytes) throw new Error(`unexpected clip ${src}`);
      return bytes;
    },
    async closeModal() { return true; },
  };
}

async function run(page) {
  const joins = [];
  const out = await runVeoClipJob(job(), {
    page,
    writeFile: async () => {},
    joinClips: async (buffers) => {
      joins.push(buffers.map((buffer) => mp4DurationSeconds(buffer)));
      return makeMp4(buffers.reduce((sum, buffer) => sum + mp4DurationSeconds(buffer), 0));
    },
  });
  return { out, joins };
}

test('live contract: two new 5s scene clips are collected and joined; stale video is ignored', async () => {
  const page = livePage();
  const { out, joins } = await run(page);
  assert.equal(out.ok, true);
  assert.equal(out.clipCount, 2);
  assert.deepEqual(out.clipDurations, [5, 5]);
  assert.equal(out.durationSec, 10);
  assert.deepEqual(joins, [[5, 5]]);
  assert.deepEqual(page.state.downloads, page.state.generatedClips);
  assert.ok(!page.state.downloads.includes(page.state.staleClips[0]));
});

test('live contract: one scene clip is a refusal, never a first-video success', async () => {
  const page = livePage({ generatedClips: ['blob:https://ads.google.com/scene-1'] });
  const { out, joins } = await run(page);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'clip_count_incomplete');
  assert.match(out.detail, /expected 2 scene clips; only 1 appeared/);
  assert.deepEqual(joins, []);
});

test('live contract: crop dialog Select happens before the image can reach (1/1)', async () => {
  const page = livePage({ cropRequired: true });
  const { out } = await run(page);
  assert.equal(out.ok, true);
  assert.equal(page.state.cropSelects, 2);
  assert.equal(page.state.saveClicks, 2);
  assert.equal(page.state.generateClicks, 1);
});

test('live contract: Google image requirement refusal keeps its own reason and never generates', async () => {
  const page = livePage({ requirementError: "Image doesn't meet requirements", acceptedWithoutCrop: false });
  const { out } = await run(page);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'image_does_not_meet_requirements');
  assert.match(out.detail, /Image doesn't meet requirements/);
  assert.equal(page.state.saveClicks, 0);
  assert.equal(page.state.generateClicks, 0);
});

test('live contract: Save looking enabled cannot substitute for Images for your ad (1/1)', async () => {
  const page = livePage({ acceptedWithoutCrop: false, forceSaveEnabled: true });
  const { out } = await run(page);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'image_selection_unconfirmed');
  assert.match(out.detail, /never reached \(1\/1\)/);
  assert.equal(page.state.saveClicks, 0);
  assert.equal(page.state.generateClicks, 0);
});

test('real adapter is scoped to the open modal and the visible aria-labelled URL input', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'ads-station', 'animate-image-runner.cjs'),
    'utf8',
  );
  assert.match(source, /\$\{VEO_URL_INPUT_SELECTOR\}:visible/);
  assert.doesNotMatch(source, /placeholder[^\n]*Enter your URL/i);
  assert.match(source, /\[role="dialog"\]:visible input\[type=file\]/);
  assert.match(source, /const root = D\.imageDialog\(\);\s*if \(!root\) return \[\];/);
  assert.doesNotMatch(source, /\/aw\/assetstudio\/videos/);
});
