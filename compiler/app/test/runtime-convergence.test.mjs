import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreparedBuild } from "../../factory/lib/build-runtime.mjs";
import { runSiteforgePremierBuild } from "../../factory/lib/siteforge-premier-provider.mjs";
import { createMemoryStore } from "../../factory/lib/vertical-history.mjs";
import { SLOTS } from "../../factory/lib/snowflake-picker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function packet(slug = "runtime-convergence-roofing") {
  return {
    slug,
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Runtime Convergence Roofing",
      category: "roofing",
      city: "Plano",
      state: "TX",
      phone: "+12145550199",
    },
    services: ["Roof repair", "Roof replacement"],
    enrichment_sources: {
      phone: { source: "test", confidence: 1, value: "+12145550199" },
    },
    toggles: { map: true },
  };
}

test("prepared runtime plans every Snowflake axis and records history only after provider success", async () => {
  const store = createMemoryStore();
  const prepared = packet("runtime-convergence-adapter");
  let received = null;
  const result = await runPreparedBuild(prepared, {
    providers: {
      store,
      runPremier: async (context) => {
        received = context;
        return { packet: context.packet };
      },
    },
  });

  assert.equal(received.packet, prepared);
  assert.equal(received.truthPacket.business_name, prepared.business.name);
  assert.deepEqual(Object.keys(result.compose_plan), SLOTS);
  assert.match(result.generation_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(received.premierInputs._slotSourcePlan.archetype, result.compose_plan.archetype);
  assert.equal(store.getVerticalHistory("roofing").length, 1);

  const failedStore = createMemoryStore();
  await assert.rejects(
    runPreparedBuild(packet("runtime-convergence-failure"), {
      providers: {
        store: failedStore,
        runPremier: async () => { throw new Error("render failed"); },
      },
    }),
    /render failed/,
  );
  assert.equal(failedStore.getVerticalHistory("roofing").length, 0);
});

test("shared adapter renders the prepared packet through Premier V8 with explicit caller constraints", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-convergence-"));
  const prepared = packet("runtime-convergence-real-v8");
  try {
    const result = await runSiteforgePremierBuild(prepared, {
      outDir,
      capture: false,
      store: createMemoryStore(),
      heroFamily: "service-map-pins",
      sectionsDisabled: ["service-map"],
    });

    assert.equal(result.packet, prepared);
    assert.equal(result.premierInputs.archetype.hero_family, "service-map-pins");
    assert.equal(prepared.hero_family, "service-map-pins");
    assert.equal(prepared.section_plan.includes("atlas-service-map"), false);
    assert.deepEqual(Object.keys(result.compose_plan), SLOTS);
    assert.match(result.generation_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(readFileSync(path.join(outDir, "index.html"), "utf8"), /data-premier-widget=/);
    assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(outDir, "optimization-manifest.json"), "utf8")));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("Studio, previews, CLI, legacy forge, and console converge without bypassing auth or QC", () => {
  const engine = readFileSync(path.join(ROOT, "app/lib/engine-adapter.mjs"), "utf8");
  const server = readFileSync(path.join(ROOT, "app/server.mjs"), "utf8");
  const cli = readFileSync(path.join(ROOT, "factory/pipeline/run.mjs"), "utf8");
  const consoleRoute = readFileSync(path.join(ROOT, "engine/console/src/routes/api/build.ts"), "utf8");

  assert.equal((engine.match(/await runSiteforgePremierBuild\(/g) || []).length, 3);
  assert.doesNotMatch(engine, /pipeline\/05-build-v8\.mjs/);
  assert.match(cli, /await runSiteforgePremierBuild\(packet/);
  assert.doesNotMatch(cli, /import \{ build \}/);
  assert.match(consoleRoute, /await runSiteforgePremierBuild\(packet/);
  assert.doesNotMatch(consoleRoute, /import \{ build \}/);

  const legacy = server.slice(server.indexOf('if (p === "/api/v1/forge"'), server.indexOf('if (seg[0] === "api" && seg[1] === "v1" && seg[2] === "jobs"'));
  assert.ok(legacy.indexOf("StudioApi.authenticateApiRequest(req)") < legacy.indexOf("Engine.startGeneration("));
  assert.match(legacy, /Billing\.generationGate\(auth\.user\)/);
  assert.match(legacy, /Engine\.startGeneration\(/);

  for (const source of [cli, consoleRoute]) {
    const runtimeIndex = source.indexOf("await runSiteforgePremierBuild(");
    const qcIndex = source.indexOf("qc(packet", runtimeIndex);
    const deployIndex = source.indexOf("deploy(packet", qcIndex);
    assert.ok(runtimeIndex >= 0 && qcIndex > runtimeIndex && deployIndex > qcIndex);
    assert.match(source.slice(qcIndex, deployIndex), /qcResult\.qc\.exit/);
  }
});
