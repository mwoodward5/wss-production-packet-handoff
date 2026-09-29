import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyDiscoveryBrandColors,
  mergeRenderedGhostTruthPacket,
} from "../lib/engine-adapter.mjs";
import { buildCanonicalPacket } from "../lib/intake-genie-core.mjs";
import {
  build,
  publicAssetIdentity,
  publicHeroMediaContract,
  resolveBusinessPalette,
} from "../../factory/pipeline/05-build-v8.mjs";

test("source-backed colors survive canonical truth, renderer intake, and palette order", () => {
  const sourceColors = ["#005A9C", "#8A2BE2", "#CC5500"];
  const packet = buildCanonicalPacket({
    input: { sources: { website_url: "https://blue-diamond.example" } },
    facts: {
      name: "Blue Diamond Plumbing",
      city: "Austin",
      state: "TX",
      category: "plumbing",
      services: ["Drain Cleaning"],
      discovery: {
        found: { colors: sourceColors },
      },
    },
    discovery: {
      found: { colors: sourceColors },
    },
  });

  assert.deepEqual(packet.facts.branding.colors, sourceColors);
  assert.deepEqual(packet.branding.colors, sourceColors);

  const directCanonicalPalette = resolveBusinessPalette({
    packet,
    compositionPalette: {
      mode: "light",
      background: "#FFFFFF",
      surface: "#FFFFFF",
      ink: "#111111",
      muted: "#555555",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 32,
  });
  assert.deepEqual(directCanonicalPalette.brandColors, sourceColors);

  const rendererPacket = {};
  assert.deepEqual(applyDiscoveryBrandColors(rendererPacket, {
    branding: packet.branding,
    compiled: packet,
  }), sourceColors);
  assert.deepEqual(rendererPacket.brand.colors, sourceColors);
  assert.deepEqual(rendererPacket.source.brandColors, sourceColors);

  const palette = resolveBusinessPalette({
    packet: rendererPacket,
    compositionPalette: {
      mode: "light",
      background: "#FFFFFF",
      surface: "#FFFFFF",
      ink: "#111111",
      muted: "#555555",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    // This seed used to reverse the first two real brand colors.
    seedInt: 32,
  });
  assert.deepEqual(palette.brandColors, sourceColors);
  assert.equal(palette.accent, sourceColors[0]);
  assert.equal(palette.accent2, sourceColors[1]);
});

test("public hero contract reports only the renderer's real selection and eligible inputs", () => {
  const videoChecksum = "a".repeat(64);
  const sourceVideo = {
    kind: "video",
    url: "https://media.blue-diamond.example/crew.mp4",
    source: "business-site",
    label: "Blue Diamond crew",
    presentation: "source-video",
    width: 1920,
    height: 1080,
    hero_eligible: true,
    proof_eligible: true,
    truthful_source: true,
    meta: {
      checksum_sha256: videoChecksum,
      perceptual_hash: "0123456789abcdef",
    },
  };
  const sourcePhoto = {
    kind: "photo",
    url: "https://media.blue-diamond.example/crew.webp",
    source: "business-site",
    label: "Blue Diamond project",
    presentation: "photo-cinematic-light",
    width: 1600,
    height: 1200,
    hero_eligible: true,
    proof_eligible: true,
    truthful_source: true,
  };
  const ambiance = {
    kind: "video",
    url: "https://media.blue-diamond.example/ambiance.mp4",
    source: "ai-ambiance",
    role: "ambiance",
    presentation: "ai-ambiance-video",
    hero_eligible: true,
    proof_eligible: false,
    truthful_source: false,
  };

  const hero = publicHeroMediaContract({
    hero: sourceVideo,
    sourceVideo,
    sourcePhoto,
    ambianceVideo: ambiance,
    unsupportedSourceVideo: {
      kind: "video",
      url: "https://media.blue-diamond.example/unsupported.mov",
      hero_eligible: true,
    },
  });

  assert.equal(hero.selected.url, sourceVideo.url);
  assert.equal(hero.selected.url_kind, "absolute");
  assert.equal(hero.selected.truthful_source, true);
  assert.deepEqual(hero.selected.asset_identity, {
    sha256: videoChecksum,
    method: "declared-content-sha256",
    perceptual_hash: "0123456789abcdef",
  });
  assert.equal(hero.selection_scope, "renderer-finalists");
  assert.deepEqual(hero.eligible.map((item) => item.url), [
    sourceVideo.url,
    sourcePhoto.url,
    ambiance.url,
  ]);
  assert.equal(hero.eligible.at(-1).source, "ai-ambiance");
  assert.equal(hero.eligible.at(-1).proof_eligible, false);
  assert.equal(hero.eligible.at(-1).truthful_source, false);
  assert.equal(hero.eligible.some((item) => item.url.endsWith("unsupported.mov")), false);

  const relative = {
    kind: "photo",
    url: "media/customer-hero.webp",
    source: "upload",
    hero_eligible: true,
    proof_eligible: true,
    truthful_source: true,
  };
  const relativeHero = publicHeroMediaContract({
    hero: relative,
    sourcePhoto: relative,
    sourceVideo: { ...sourceVideo, hero_eligible: false },
  });
  assert.equal(relativeHero.selected.url_kind, "preview-relative");
  assert.deepEqual(relativeHero.eligible.map((item) => item.url), [relative.url]);
});

test("public asset identity prefers served bytes and labels URL-only fallback", (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-public-asset-identity-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const bytes = Buffer.from("served customer asset");
  writeFileSync(path.join(outDir, "hero.webp"), bytes);

  assert.deepEqual(publicAssetIdentity({
    url: "hero.webp",
    meta: {
      checksum_sha256: "f".repeat(64),
      perceptual_hash: "fedcba9876543210",
    },
  }, { outDir }), {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    method: "content-sha256",
    byte_length: bytes.length,
    perceptual_hash: "fedcba9876543210",
  });

  const urlOnly = publicAssetIdentity({
    url: "https://cdn.customer.example/photos/roof-1200x800.webp?w=1200&q=80",
  });
  assert.match(urlOnly.sha256, /^[a-f0-9]{64}$/);
  assert.equal(urlOnly.method, "normalized-url-sha256");
});

test("rendered public packet emits content identities for logo, selected hero, and catalog", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-rendered-asset-identity-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logoPath = path.join(root, "customer-logo.png");
  const photoPath = path.join(root, "customer-project.webp");
  const logoBytes = Buffer.from("customer logo binary");
  const photoBytes = Buffer.from("customer project photo binary");
  writeFileSync(logoPath, logoBytes);
  writeFileSync(photoPath, photoBytes);

  await build({
    slug: "blue-diamond-asset-identity",
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Blue Diamond Plumbing",
      category: "plumbing",
      city: "Austin",
      state: "TX",
      current_website: "https://blue-diamond-plumbing.com/",
    },
    services: ["Drain Cleaning"],
    logo_source: {
      chosen_url: "https://blue-diamond-plumbing.com/logo.png",
      local_path: logoPath,
      origin: "business-site",
      proposed: false,
    },
    media: {
      catalog: [{
        kind: "photo",
        url: "https://blue-diamond-plumbing.com/project.webp",
        local_path: photoPath,
        source: "business-site",
        label: "Blue Diamond project",
        width: 1600,
        height: 1200,
        hero_eligible: true,
        proof_eligible: true,
        truthful_source: true,
        meta: {
          local_path: photoPath,
          perceptual_hash: "0011223344556677",
        },
      }],
    },
    enrichment_sources: {},
  }, { outDir, capture: false });

  const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
  const logoSha = createHash("sha256").update(logoBytes).digest("hex");
  const photoSha = createHash("sha256").update(photoBytes).digest("hex");
  assert.deepEqual(publicPacket.logo_source.asset_identity, {
    sha256: logoSha,
    method: "content-sha256",
    byte_length: logoBytes.length,
  });
  assert.equal(publicPacket.media.hero.selected.asset_identity.sha256, photoSha);
  assert.equal(publicPacket.media.hero.selected.asset_identity.method, "content-sha256");
  assert.equal(publicPacket.media.hero.selected.asset_identity.perceptual_hash, "0011223344556677");
  assert.equal(publicPacket.media.catalog[0].asset_identity.sha256, photoSha);
  assert.deepEqual(publicPacket.asset_identity_manifest, {
    schema: "siteforge-public-asset-identity-v1",
    logo: publicPacket.logo_source.asset_identity,
    hero: publicPacket.media.hero.selected.asset_identity,
    catalog: publicPacket.media.catalog.map((item) => item.asset_identity),
  });
});

test("terminal truth merges rendered hero evidence without erasing canonical source truth", () => {
  const canonical = {
    version: "intake-genie-v1",
    facts: {
      name: "Blue Diamond Plumbing",
      services: ["Drain Cleaning"],
      branding: { colors: ["#005A9C", "#8A2BE2"] },
    },
    branding: { colors: ["#005A9C", "#8A2BE2"] },
    assets: [{ kind: "photo", url: "https://media.blue-diamond.example/crew.webp" }],
  };
  const publicPacket = {
    schema: "public-business-v1",
    renderer: "05-build-v8",
    generation_fingerprint: "fingerprint-123",
    business: { name: "Blue Diamond Plumbing", city: "Austin", state: "TX" },
    hero_family: "cinematic-video-parallax",
    enrichment_sources: {
      colors: { source: "business-site", value: ["#005A9C", "#8A2BE2"] },
    },
    media: {
      hero: {
        selected: {
          kind: "photo",
          url: "https://media.blue-diamond.example/crew.webp",
          source: "business-site",
          hero_eligible: true,
          proof_eligible: true,
          truthful_source: true,
          asset_identity: {
            sha256: "b".repeat(64),
            method: "declared-content-sha256",
            perceptual_hash: "0011223344556677",
          },
        },
        eligible: [{
          kind: "photo",
          url: "https://media.blue-diamond.example/crew.webp",
          source: "business-site",
          hero_eligible: true,
          proof_eligible: true,
          truthful_source: true,
          asset_identity: {
            sha256: "b".repeat(64),
            method: "declared-content-sha256",
            perceptual_hash: "0011223344556677",
          },
        }],
      },
    },
  };

  const original = structuredClone(canonical);
  const terminal = mergeRenderedGhostTruthPacket(canonical, publicPacket);

  assert.deepEqual(canonical, original);
  assert.deepEqual(terminal.facts, canonical.facts);
  assert.deepEqual(terminal.assets, canonical.assets);
  assert.deepEqual(terminal.rendered_truth.branding.colors, ["#005A9C", "#8A2BE2"]);
  assert.equal(terminal.rendered_truth.renderer, "05-build-v8");
  assert.equal(terminal.hero_media.selected.url, publicPacket.media.hero.selected.url);
  assert.deepEqual(
    terminal.hero_media.selected.asset_identity,
    publicPacket.media.hero.selected.asset_identity,
  );
  assert.deepEqual(terminal.hero_media.eligible, publicPacket.media.hero.eligible);
  assert.equal(terminal.hero_media.selection_scope, "renderer-finalists");
  assert.deepEqual(terminal.rendered_assets.logo_source, publicPacket.logo_source ?? null);
  assert.deepEqual(terminal.rendered_assets.catalog, publicPacket.media.catalog ?? []);
  assert.deepEqual(
    terminal.rendered_assets.asset_identity_manifest,
    publicPacket.asset_identity_manifest ?? null,
  );
});

test("authenticated Ghost context stores the fresh canonical envelope and reads terminal updates", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
  assert.match(server, /const ghostContext = \{[\s\S]*compiled: compiledEnvelope,/);
  assert.match(server, /ghost_context: DB\.get\("jobs", job\.id\)\?\.ghost_context \|\| ghostContext/);
  const immediateAttach = engine.indexOf("const terminalTruth = attachRenderedTruthToGhostJob(job.id, publicPacket)");
  const immediateQc = engine.indexOf('withJobStage(job.id, "qc"', immediateAttach);
  assert.ok(immediateAttach >= 0 && immediateAttach < immediateQc, "non-staged terminal truth must attach before QC can block");
  const stagedRender = engine.indexOf('if (stage === "render")');
  const stagedAttach = engine.indexOf("attachRenderedTruthToGhostJob(jobId", stagedRender);
  const stagedCapture = engine.indexOf('return finishStage("capture_desktop")', stagedRender);
  assert.ok(stagedAttach > stagedRender && stagedAttach < stagedCapture, "staged terminal truth must attach immediately after render");
});
