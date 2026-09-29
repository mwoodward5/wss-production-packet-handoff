import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const ghostContract = readFileSync(new URL("../lib/ghost-build-contract.mjs", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../../factory/pipeline/05-build-v8.mjs", import.meta.url), "utf8");
const intake = readFileSync(new URL("../lib/intake-genie.mjs", import.meta.url), "utf8");

test("Ghost builds expose the public surface v2 release contract", () => {
  assert.match(engine, /PUBLIC_SURFACE_QC_CONTRACT\s*=\s*"public-surface-v2"/);
  assert.match(engine, /qc:\s*publicPreviewQcSummary\(qc\)/);
  assert.match(engine, /precertification_policy:\s*precertified\s*\?\s*PROJECT_PRECERTIFICATION_POLICY\s*:\s*null/);
  assert.match(engine, /screenshots\?\.pass\s*===\s*true/);
  assert.match(ghostContract, /visual_qc_passed:\s*visualQcPassed/);
  assert.match(ghostContract, /qc_contract:\s*qcContract/);
  assert.match(ghostContract, /qc\.precertification_policy\s*===\s*PROJECT_PRECERTIFICATION_POLICY/);
  assert.match(ghostContract, /renderer:\s*"05-build-v8"/);
  assert.match(engine, /generation_fingerprint:\s*packet\.generation_fingerprint\s*\|\|\s*null/);
  assert.match(ghostContract, /generation_fingerprint:\s*built\.generation_fingerprint\s*\|\|\s*null/);
  assert.match(engine, /release_evidence:\s*releaseEvidenceFromQc\(qc\)/);
  assert.match(engine, /release-map-evidence/);
  assert.match(engine, /release-business-identity-match/);
  assert.match(engine, /release-template-family-match/);
  assert.match(ghostContract, /releaseEvidenceComplete\(\s*built\.release_evidence,\s*expectedReleaseIdentity\(context\),\s*\)/);
  assert.match(ghostContract, /code:\s*blockedCode/);
  assert.match(server, /Engine\.startTryOnStaged\(engineBuildInput\)/);
  assert.match(server, /Engine\.dispatchDurableJobAdvance\(job\.id, baseUrl\)/);
  assert.match(server, /ghostBuildContractForJob\(\{ baseUrl, job \}\)/);
});

test("Ghost builds preserve the signed purchase URL in preview output", () => {
  assert.match(engine, /source\?\.launch\?\.purchase_url/);
  assert.match(server, /const checkoutUrl = String\([\s\S]*prospect\.purchase_url[\s\S]*body\.checkout_url[\s\S]*\)\.trim\(\)/);
  assert.match(server, /purchase_url:\s*checkoutUrl/);
  assert.match(server, /const previewExpiresAt = String\([\s\S]*prospect\.preview_expires_at[\s\S]*body\.previewExpiresAt[\s\S]*\)\.trim\(\)/);
  assert.match(server, /expires_at:\s*previewExpiresAt/);
  assert.match(engine, /function applyLaunchData\(packet, source\)/);
  assert.match(engine, /source\?\.launch\?\.expires_at/);
  assert.match(engine, /packet\.preview_expires_at = launchExpiresAt/);
});

test("Ghost builds preserve exact address and coordinates through render enrichment", () => {
  assert.match(server, /const address = resolveGhostInputHint\(\{[\s\S]*?field: "address",[\s\S]*?prospectValue: prospect\.address,[\s\S]*?priorCompiledValue: truth\.intakeGenie\?\.facts\?\.address/);
  assert.match(server, /const latlng = normalizeLatlng\(resolveGhostInputHint\(\{[\s\S]*?field: "latlng",[\s\S]*?prospectValue: prospect\.latlng,[\s\S]*?priorCompiledValue: truth\.latlng \|\| truth\.intakeGenie\?\.facts\?\.latlng/);
  assert.match(server, /prospect_hints:\s*\{\s*name,\s*city,\s*state,\s*category,\s*address,\s*latlng\s*\}/);
  assert.match(server, /const buildAddress = resolveGhostTruthFact\(\{ field: "address", compiledValue: facts\.address, truth \}\)/);
  assert.match(server, /const buildLatlng = normalizeLatlng\(resolveGhostTruthFact\(\{ field: "latlng", compiledValue: facts\.latlng, truth, fallback: null \}\)\)/);
  assert.match(server, /address:\s*buildAddress/);
  assert.match(server, /latlng:\s*buildLatlng/);
  assert.match(engine, /packet\.enrichment_sources\.address = \{ source: "source-intake", confidence: 0\.85, value: sourceFacts\.address \}/);
  assert.match(engine, /packet\.enrichment_sources\.latlng = \{ source: "source-intake", confidence: 0\.9, value: sourceLatLng \}/);
});

test("authenticated Ghost rendering keeps the rich compiler envelope", () => {
  assert.match(server, /build_preview:\s*false/);
  assert.match(server, /const compiledEnvelope = \{[\s\S]*facts: sourceFacts,[\s\S]*evidence: compiled\.evidence \|\| truth\.intakeGenie\?\.evidence \|\| \[\],[\s\S]*assets: compiled\.assets \|\| \[\],[\s\S]*discovery: compiled\.discovery \|\| facts\.discovery \|\| truth\.intakeGenie\?\.discovery \|\| truth\.discovery \|\| \{\},[\s\S]*brand: compiled\.brand \|\| compiled\.branding \|\| facts\.branding[\s\S]*fonts: compiled\.fonts \|\| compiled\.branding\?\.fonts \|\| facts\.branding\?\.fonts[\s\S]*asset_provenance:/);
  assert.match(server, /discovery: compiledEnvelope\.discovery/);
  assert.match(server, /brand: compiledEnvelope\.brand/);
  assert.match(server, /fonts: compiledEnvelope\.fonts/);
  assert.match(server, /compiled: compiledEnvelope/);
  assert.doesNotMatch(server, /persistGhostPreviewPrestageFailure\(\{[\s\S]{0,240}compiled,\s*checkoutUrl/);
  assert.match(server, /queuedGhostBuildContract\(\{[\s\S]{0,180}compiled: compiledEnvelope/);
  assert.doesNotMatch(server, /if \(!built\?\.preview\) \{[\s\S]{0,300}intake:/);
  assert.match(server, /if \(!built\?\.preview\) \{[\s\S]{0,400}ghostBuildContractForJob/);
});

test("fresh compiled facts win unless the owner explicitly locks a field", () => {
  assert.match(server, /import \{ resolveGhostInputHint, resolveGhostTruthFact \} from "\.\/lib\/ghost-truth-precedence\.mjs"/);
  for (const field of ["name", "city", "state", "category", "phone", "email", "address", "latlng", "services"]) {
    assert.match(
      server,
      new RegExp(`resolveGhostTruthFact\\(\\{ field: "${field}", compiledValue: facts\\.${field}, truth`),
      `${field} should use the shared Ghost precedence policy`,
    );
  }
});

test("wrong-donor logos fail closed before V8 render", () => {
  assert.match(server, /import \{ enforceBusinessTruth \} from "\.\/lib\/business-truth\.mjs"/);
  assert.match(server, /const renderAssets = compiledAssets/);
  assert.doesNotMatch(server, /ownerLockedLogo[\s\S]{0,500}authenticated_owner_upload: true/);
  assert.match(server, /const brandTruth = enforceBusinessTruth\(/);
  assert.match(server, /compiled\.assets = renderAssets\.filter\(\(asset\) => asset\?\.kind !== "logo" \|\| asset\.url === verifiedLogoUrl\)/);
  assert.match(server, /const hasSourceLogo = Boolean\(verifiedLogoUrl\)/);
});

test("Ghost builds expose the 108-point authority proof without duplicating renderer logic", () => {
  assert.match(engine, /authority_standard:\s*packet\.authority_standard/);
  assert.match(ghostContract, /authority_standard:\s*authorityStandard\?\.standard\s*\|\|\s*"authority-108-v1"/);
  assert.match(ghostContract, /optimization_manifest_url:\s*optimizationManifestUrl/);
  assert.match(
    ghostContract,
    /truth_packet:\s*\{\s*\.\.\.compiled,\s*authority_standard:\s*authorityStandard,\s*generation_fingerprint:\s*built\.generation_fingerprint\s*\|\|\s*null,\s*release_evidence:\s*releaseEvidence,?\s*\}/,
  );
});

test("Ghost release output persists concrete map, identity, and family evidence", () => {
  assert.match(engine, /stage_payload:[\s\S]*release_expectation:[\s\S]*business_name:[\s\S]*city:[\s\S]*state:[\s\S]*source_website:[\s\S]*template_family:/);
  assert.match(engine, /mapRuntime\?\.response_ok\s*===\s*true/);
  assert.match(engine, /mapRuntime\?\.geometry_ok\s*===\s*true/);
  assert.match(engine, /mapRuntime\?\.pixels_ok\s*===\s*true/);
  assert.match(engine, /jsonLdBusinessNames\(html\)/);
  assert.match(engine, /public_packet_city:\s*publicPacketCity/);
  assert.match(engine, /public_packet_state:\s*publicPacketState/);
  assert.match(engine, /public_packet_source_website:\s*publicPacketSourceWebsite/);
  assert.match(engine, /actualFamily\s*=\s*String\(publicPacket\?\.hero_family/);
  assert.match(ghostContract, /release_evidence:\s*releaseEvidence/);
});

test("Ghost build-preview blocks before render when source evidence is incomplete", () => {
  assert.match(server, /truth\.intakeGenie\?\.assets/);
  assert.match(server, /recoverAuthenticatedGhostLogo\(/);
  assert.match(server, /const renderAssets = compiledAssets/);
  assert.match(server, /const hasSourceLogo = Boolean\(verifiedLogoUrl\)/);
  assert.match(server, /const hasSourceMedia = compiled\.assets\.some\(\(asset\) => \["photo", "video"\]\.includes\(asset\?\.kind\)/);
  assert.match(server, /!sourceFacts\.services\.length \? "verified services"/);
  // No-website lane: the scraped "source logo" requirement is dropped ONLY when
  // there is no website (the business ships a proposed mark, approved at
  // activation). Services + source media stay hard-required for every lane.
  assert.match(server, /const noWebsiteLane = !String\(buildWebsite \|\| ""\)\.trim\(\)/);
  assert.match(server, /\(!noWebsiteLane && !hasSourceLogo\) \? "source logo"/);
  assert.match(server, /!hasSourceMedia \? "source photo or video"/);
  assert.match(server, /errorCode: "source_evidence_incomplete"/);
  assert.match(server, /missing: evidenceMissing/);

  const gate = server.indexOf("const hasSourceLogo = Boolean(verifiedLogoUrl)");
  const auth = server.indexOf("if (!ghostAgencyAuthorized(req))", server.indexOf('p === "/api/ghost-agency/build-preview"'));
  const bodyRead = server.indexOf("const body = await U.readJson(req)", auth);
  const bridge = server.indexOf("recoverAuthenticatedGhostLogo(", bodyRead);
  const response = server.indexOf('errorCode: "source_evidence_incomplete"', gate);
  const render = server.indexOf("Engine.startTryOnStaged(engineBuildInput)", gate);
  assert.ok(auth >= 0 && auth < bodyRead && bodyRead < bridge, "machine auth must run before reading or bridging Ghost assets");
  assert.ok(gate >= 0, "source evidence gate should be present");
  assert.ok(response > gate, "incomplete evidence should return the documented blocked response");
  assert.ok(response < render, "incomplete evidence should be rejected before starting the Ghost render");
});

test("Ghost build-preview claims one durable engine job before compiler or render work", () => {
  const routeStart = server.indexOf('if (p === "/api/ghost-agency/build-preview" && req.method === "POST")');
  const routeEnd = server.indexOf('if (p === "/api/checkout" && req.method === "POST")', routeStart);
  const route = server.slice(routeStart, routeEnd);
  const auth = route.indexOf("if (!ghostAgencyAuthorized(req))");
  const bodyRead = route.indexOf("const body = await U.readJson(req)");
  const claim = route.indexOf("await ghostPreviewIdempotency.claim(");
  const replay = route.indexOf("if (ghostClaim.replay)");
  const reserve = route.indexOf('Engine.createJob("try"');
  const compile = route.indexOf("await ghostPreviewCompileFromInput(");
  const stagedStart = route.indexOf("Engine.startTryOnStaged(engineBuildInput)");
  const localStart = route.indexOf("Engine.startTryOn(engineBuildInput)");

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.ok(auth < bodyRead && bodyRead < claim, "auth and JSON shape validation must precede the durable claim");
  assert.ok(reserve < claim && claim < replay, "a durable candidate shell must exist before the immutable claim");
  assert.ok(replay < compile && compile < stagedStart && compile < localStart, "replays must return before compiler or render work");
  assert.match(route, /const idempotencyKey = suppliedIdempotencyKey \|\| bodyCorrelationId/);
  assert.match(route, /error_code: "GHOST_PREVIEW_CORRELATION_ID_MISMATCH"/);
  assert.match(route, /job: \{ id: ghostClaim\.jobId, correlation_id: correlationId \}/);
  assert.match(route, /jobId: ghostClaim\.jobId,[\s\S]*adoptExistingJob: true/);
  assert.match(route, /if \(!engineActivated && !terminal\)[\s\S]*persistGhostPreviewPrestageFailure/);
  assert.match(engine, /function createOrAdoptTryOnJob\(/);
  assert.match(engine, /adoptExistingJob = false/);
});

test("Intake preview passes an explicit runtime-valid tattoo family with public-source evidence", () => {
  assert.match(intake, /family:\s*previewFamilyForBusiness\(facts\)/);
  assert.match(intake, /category\s*\|\|\s*""\)\.toLowerCase\(\)\s*===\s*"tattoo studio"[\s\S]*\? familyForBusiness\(facts\)[\s\S]*:\s*"auto"/);
  assert.match(intake, /source:\s*\{[\s\S]*evidence,/);
  assert.match(intake, /\["split-editorial-index", "cinematic-video-parallax", "magazine-owner-letter"\]/);
});

test("owner launch detail opens by default and mobile conversion controls do not overlap", () => {
  assert.match(renderer, /class="btn solid lr-buy"[^>]+data-launch-cta/);
  assert.match(renderer, /data-launch-rail(?:\s|>)/);
  assert.match(renderer, /data-launch-chip/);
  assert.doesNotMatch(renderer, /launch-rail\[data-collapsed\]/);
  assert.match(renderer, /body:has\(\[data-launch-chip\]\) \.pchat\{display:none\}/);
  assert.match(renderer, /<header class="top shell" data-sticky-cta data-conversion-rail>/);
  assert.doesNotMatch(renderer, /class="sticky-cta"/);
  // Glass launch tile: countdown urgency, share tools, WSS brand, cross-sell.
  assert.match(renderer, /class="launch-tile glass"/);
  assert.match(renderer, /data-launch-share="email"/);
  assert.match(renderer, /data-launch-share="copy"/);
  assert.match(renderer, /data-countdown=/);
  assert.match(renderer, /lr-more-item/);
  assert.match(renderer, /AnswerCrew/);
});

test("care portrait heroes keep readable headline geometry and full-width mobile media", () => {
  assert.match(
    renderer,
    /\.hero-layout-care \.hero-copy h1\{font-size:clamp\(2\.5rem,4vw,4\.4rem\);line-height:\.98;max-width:100%\}/,
  );
  assert.match(
    renderer,
    /\[class\*="architecture-care-portrait-field"\] \.hero-media-layer\{inset:0 0 68% 0;border-radius:0;opacity:\.5\}/,
  );
  assert.doesNotMatch(
    renderer,
    /\[class\*="architecture-front-page-story"\] \.hero-media-layer,\[class\*="architecture-care-portrait-field"\]/,
  );
  assert.match(
    renderer,
    /\[class\*="architecture-front-page-story"\] \.hero-media-layer,\[class\*="architecture-host-letter"\] \.hero-media-layer\{inset:0 0 68% 0;border-radius:0;opacity:\.5\}/,
  );
});

test("source brand colors visibly drive renderer palette tokens", () => {
  assert.match(renderer, /--brand:\$\{pal\.accentBrandColors\[0\] \|\| pal\.accent\};--brand-2:\$\{pal\.accentBrandColors\[1\] \|\| pal\.accent2\}/);
  assert.match(renderer, /var\(--brand,var\(--brand-raw-1\)\) 22%/);
  assert.match(renderer, /var\(--brand-2,var\(--brand-raw-2\)\) 18%/);
});
