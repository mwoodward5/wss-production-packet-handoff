import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { applyDiscoveryBrandFonts } from "../../app/lib/engine-adapter.mjs";
import { TRUTH_PACKET_VERSION } from "../lib/build-runtime.mjs";
import {
  generationFingerprint,
  RENDERER_ID,
} from "../lib/snowflake-to-premier.mjs";
import { runSiteforgePremierBuild } from "../lib/siteforge-premier-provider.mjs";
import {
  BUSINESS_TYPE_PAIRS,
  selectBusinessTypography,
} from "./05-build-v8.mjs";

test("brand font discovery prefers an exact approved display and body pair", () => {
  const typography = selectBusinessTypography({
    facts: { branding: { fonts: ["Fraunces", "Archivo"] } },
  }, 9);

  assert.deepEqual(typography, BUSINESS_TYPE_PAIRS[0]);
});

test("a single approved discovered family cannot select a pair", () => {
  const seed = 1;
  const typography = selectBusinessTypography({
    enrichment_sources: { branding: { value: { fonts: ["DM Sans"] } } },
  }, seed);

  assert.deepEqual(typography, BUSINESS_TYPE_PAIRS[seed % BUSINESS_TYPE_PAIRS.length]);
});

test("unknown or hostile font input cannot select an unapproved family", () => {
  const seed = 23;
  const typography = selectBusinessTypography({
    branding: { fonts: ["<script>alert('font')</script>", { family: "Fraunces" }, null] },
    discovery: { found: { fonts: ["https://fonts.example/unsafe.css"] } },
  }, seed);

  assert.deepEqual(typography, BUSINESS_TYPE_PAIRS[seed % BUSINESS_TYPE_PAIRS.length]);
  assert.ok(BUSINESS_TYPE_PAIRS.some((pair) => pair.id === typography.id));
});

test("no approved discovered family preserves the deterministic seeded fallback", () => {
  const seed = 42;
  const packet = { brand: { fonts: ["Unlisted Brand Sans"] } };

  assert.deepEqual(selectBusinessTypography(packet, seed), BUSINESS_TYPE_PAIRS[seed % BUSINESS_TYPE_PAIRS.length]);
  assert.deepEqual(selectBusinessTypography(packet, seed), selectBusinessTypography({}, seed));
});

function preparedPacket(slug) {
  return {
    slug,
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Brand Font Plumbing",
      category: "roofing",
      city: "Plano",
      state: "TX",
      phone: "+12145550199",
    },
    services: ["Roof repair", "Roof replacement"],
    enrichment_sources: {
      phone: { source: "test", confidence: 1, value: "+12145550199" },
    },
  };
}

function reservationStore() {
  const rows = [];
  let active = null;
  return {
    rows,
    async reserveVerticalPlan(_vertical, selectPlan) {
      const selection = await selectPlan(rows.map((row) => row.plan));
      active = { reservation_id: "brand-font-reservation", selection };
      return active;
    },
    async finalizeVerticalPlan() {
      rows.push({ at: new Date(0).toISOString(), plan: active.selection.plan });
      active = null;
      return rows;
    },
    async releaseVerticalPlan() {
      active = null;
      return true;
    },
  };
}

async function renderSourceFonts(slug, fonts) {
  const packet = preparedPacket(slug);
  applyDiscoveryBrandFonts(packet, { fonts });
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-brand-fonts-"));
  const store = reservationStore();
  try {
    const result = await runSiteforgePremierBuild(packet, {
      outDir,
      capture: false,
      store,
    });
    return {
      result,
      packet,
      history: store.rows,
      html: readFileSync(path.join(outDir, "index.html"), "utf8"),
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test("source fonts reserve an approved pair before Premier planning and render it in V8", async () => {
  const { result, packet, history, html } = await renderSourceFonts(
    "brand-font-approved-oswald-merriweather",
    ["Oswald", "Merriweather"],
  );

  assert.deepEqual(packet.brand.fonts, ["Oswald", "Merriweather"]);
  assert.equal(result.compose_plan.typography_pair, "Oswald + Merriweather");
  assert.deepEqual(result.premierInputs.typography, {
    display: "Oswald",
    body: "Merriweather",
    utility: null,
  });
  assert.equal(result.premierInputs._slotSourcePlan.typography_pair, result.compose_plan.typography_pair);
  assert.equal(history[0].plan.typography_pair, result.compose_plan.typography_pair);
  assert.equal(result.generation_fingerprint, generationFingerprint({
    compose_plan: result.compose_plan,
    truth_packet_version: TRUTH_PACKET_VERSION,
    renderer: RENDERER_ID,
  }));
  assert.match(html, /data-font-pair="oswald-merriweather"/);
  assert.match(html, /family=Oswald/);
  assert.match(html, /family=Merriweather/);
});

test("hostile, unknown, or partial source fonts cannot change the deterministic V8 plan or load a family", async () => {
  const slug = "brand-font-hostile-deterministic";
  const hostile = await renderSourceFonts(slug, [
    "<script>alert('font')</script>",
    "Unknown Brand Sans",
    "Oswald",
  ]);
  const control = await renderSourceFonts(slug, []);

  assert.deepEqual(hostile.result.compose_plan, control.result.compose_plan);
  assert.deepEqual(hostile.result.premierInputs.typography, control.result.premierInputs.typography);
  assert.doesNotMatch(hostile.html, /Unknown Brand Sans|alert\('font'\)|fonts\.example/i);
});
