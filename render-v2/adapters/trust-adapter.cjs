'use strict';

const { availableModules, ALL_IDS } = require('../trust/registry.cjs');

const DEFAULT_VISUAL_BUDGET = 5;
const SCHEMA_CLASSES = new Set(['schema']);

function fail(code, detail) {
  const error = new Error(code);
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  throw error;
}

function dedupe(list) {
  return [...new Set(list)];
}

function select(client, donorManifest, { mobile = false } = {}) {
  const preferences = Array.isArray(donorManifest?.trust?.preferences) && donorManifest.trust.preferences.length
    ? donorManifest.trust.preferences
    : ALL_IDS;
  const candidates = availableModules(client, preferences, { mobile });

  const maxVisual = Number.isSafeInteger(donorManifest?.trust?.max_visual_modules)
    ? donorManifest.trust.max_visual_modules
    : DEFAULT_VISUAL_BUDGET;
  if (maxVisual < 0 || maxVisual > 8) fail('trust_visual_budget_invalid', maxVisual);

  const selected = [];
  const usedClasses = new Set();
  let visualCount = 0;

  for (const mod of candidates) {
    const schemaOnly = SCHEMA_CLASSES.has(mod.class) || /schema|site-graph|speed-vitals/.test(mod.id);
    if (schemaOnly) {
      selected.push(mod);
      continue;
    }
    if (visualCount >= maxVisual) continue;
    if (usedClasses.has(mod.class) && !['local','other'].includes(mod.class)) continue;
    selected.push(mod);
    usedClasses.add(mod.class);
    visualCount += 1;
  }

  const css = selected.map(x => x.css).filter(Boolean).join('\n');
  const js = selected.map(x => x.js).filter(Boolean).join('\n');
  const ids = dedupe(selected.map(x => x.id));

  return Object.freeze({
    ids,
    selected,
    css,
    js,
    visualCount,
    moduleCount: selected.length,
  });
}

module.exports = Object.freeze({ select, DEFAULT_VISUAL_BUDGET });
