"use strict";
const { createHash } = require("node:crypto");
const { intakeQuality, harvestExactSourceUrls } = require("../firecrawl-intake");
const compiler = require("../intake-genie-compile");
const buildPacket = require("../compile-build-packet");
const MAX_BYTES = 2_000_000;
const hash = b => createHash("sha256").update(b).digest("hex");
const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const fail = reason => ({ ok: false, reason });
const bodyText = value => String(value || "").replace(/\r\n?/g, "\n").trim();
function urlKey(value, site) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hostname.replace(/^www\./, "").toLowerCase() !== site) return "";
    u.hash = ""; u.searchParams.sort(); return u.href;
  } catch { return ""; }
}
function privateSourceUrl(value, site) {
  if (value === site || value === "www." + site) return true;
  if (urlKey(value, site)) return true;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password
    && /^(?:www\.)?(?:instagram\.com|facebook\.com)$/.test(u.hostname.toLowerCase()); }
  catch { return false; }
}
function exactBytes(base64, sha256) {
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
      || !/^[a-f0-9]{64}$/.test(String(sha256 || "")) || base64.length > 3_000_000) return null;
  const bytes = Buffer.from(base64, "base64");
  return bytes.length > 0 && bytes.length <= MAX_BYTES && bytes.toString("base64") === base64
    && hash(bytes) === sha256 ? bytes : null;
}
function preflight({ snapshot_base64, snapshot_sha256, request, prospect_id }) {
  const id = String(prospect_id || "");
  const website = String(request?.website_url || "");
  let site = "";
  try { site = new URL(website).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id) || !site || !urlKey(website, site)
      || request?.request_id !== "ghost:" + id + ":line-genie-certified-v7"
      || !clean(request.prospect_hints?.city) || !clean(request.prospect_hints?.state)
      || !clean(request.prospect_hints?.category)) return fail("prospect_identity_mismatch");
  const bytes = exactBytes(snapshot_base64, snapshot_sha256);
  if (!bytes) return fail("snapshot_bytes_invalid");
  let p;
  try { p = JSON.parse(bytes.toString("utf8")); } catch { return fail("snapshot_json_invalid"); }
  const compiled = p?.compiled || {};
  const contract = compiled.contentContract || {};
  const visitor = contract.visitor_copy || {};
  const files = visitor.files || {};
  const fileHashes = visitor.file_hashes || {};
  const names = Object.keys(files);
  if (p.version !== "2.0" || contract.schema !== "CertifiedPracticePacket/v1"
      || visitor.safety?.pass !== true || (visitor.safety?.violations || []).length
      || !names.length || names.length !== Object.keys(fileHashes).length
      || names.some(name => !/^content\/(?!source-pages\/)[\w/.-]+\.md$/.test(name)
        || typeof files[name] !== "string" || hash(files[name]) !== fileHashes[name]
        || compiled.contentFiles?.[name] !== files[name])) return fail("visitor_files_unsafe");
  const quality = compiled.contentQuality?.visitor || {};
  if (quality.totalFiles !== names.length || quality.passCount !== names.length
      || quality.reviewCount !== 0 || !Array.isArray(quality.files)
      || quality.files.length !== names.length || quality.files.some(row => row.status !== "pass" || row.reasons?.length)
      || names.some(name => !quality.files.some(row => row.sourcePath === name))) return fail("visitor_quality_not_passed");
  const name = clean(p.business?.businessName);
  const city = clean(request.prospect_hints.city);
  const state = clean(request.prospect_hints.state);
  const category = clean(request.prospect_hints.category);
  if (!name || name.length > 160 || /^(?:unknown|your business|company name)$/i.test(name)
      || urlKey(p.business?.domainUrl, site) !== urlKey(website, site)
      || (p.business?.city && clean(p.business.city).toLowerCase() !== city.toLowerCase())
      || (p.business?.state && clean(p.business.state).toLowerCase() !== state.toLowerCase())
      || (p.business?.category && clean(p.business.category).toLowerCase() !== category.toLowerCase())
      || (p.sources?.intakeRequest && JSON.stringify(p.sources.intakeRequest) !== JSON.stringify(request)))
    return fail("packet_request_identity_mismatch");
  const normWords = value => " " + clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const hasLocation = o => o.private_source?.markdown?.toLowerCase().includes(city.toLowerCase())
    && normWords(o.extracted?.address).includes(normWords(state));
  if (p.assetQa?.ownershipVerified === true || clean(compiled.trust?.yearsInBusiness)
      || (p.goldenArtifacts?.protectedNotes || []).length || ["certifications", "licenses", "insurance", "awards", "partnerships"]
      .some(key => Array.isArray(compiled.trust?.[key]) && compiled.trust[key].length)) return fail("unverified_proof_or_asset_approval");
  const urls = p.sources?.urls, observations = p.sources?.observations, pages = compiled.sourceContent?.pages;
  if (!Array.isArray(urls) || !urls.length || urls.some(u => !privateSourceUrl(u, site))
      || !Array.isArray(observations) || !observations.length || observations.some(o => !urlKey(o.source, site))
      || !Array.isArray(pages) || !pages.length) return fail("source_urls_unverified");
  const archived = o => pages.some(page => urlKey(page.sourceUrl, site) === urlKey(o.source, site)
    && /^content\/source-pages\//.test(page.file) && typeof compiled.contentFiles?.[page.file] === "string"
    && hash(compiled.contentFiles[page.file]) === page.sha256
    && compiled.contentFiles[page.file] === o.private_source?.markdown
    && /^private_source_reference_only/.test(page.publicationPolicy || ""));
  const proven = observations.filter(o => o.status === "succeeded" && archived(o));
  if (!proven.some(o => o.extracted?.brandName === name
    && o.private_source.markdown.includes(name) && hasLocation(o)
     && normWords(o.private_source.markdown).includes(normWords(category)))) return fail("source_identity_unproven");
  const services = contract.facts?.services;
  if (!Array.isArray(services) || !services.length
      || (contract.facts?.category && clean(contract.facts.category).toLowerCase() !== category.toLowerCase()))
    return fail("packet_category_or_services_mismatch");
  const extracted = p.sources.extracted || {
    brandName: name, domainUrl: p.business.domainUrl, finalPhone: p.business.phone,
    email: p.business.email, address: p.business.address, hours: p.business.hours,
    exactServices: services.join("\n"), mainServices: services.join("\n"),
  };
  const allowed = new Set(["brandName", "domainUrl", "finalPhone", "email", "address", "hours", "exactServices", "mainServices"]);
  if (Object.keys(extracted).some(key => !allowed.has(key)) || !extracted.brandName
      || !extracted.domainUrl || !extracted.exactServices) return fail("harvest_extraction_unproven");
  for (const [key, value] of Object.entries(extracted)) {
    if (key === "exactServices" || key === "mainServices") {
      const labels = String(value).split(/\r?\n/).filter(Boolean);
      if (!labels.length || labels.some(label => !proven.some(o =>
        [o.extracted?.exactServices, o.extracted?.mainServices].some(list =>
          String(list || "").split(/\r?\n/).some(name => clean(name).toLowerCase() === clean(label).toLowerCase()))
        && intakeQuality.sourceObservationService(o, label)))) return fail("harvest_extraction_unproven");
    } else if (!proven.some(o => o.extracted?.[key] === value
      && (key === "domainUrl" ? urlKey(value, site) === urlKey(website, site)
        : o.private_source.markdown.includes(value)))) return fail("harvest_extraction_unproven");
  }
  if (request.mode !== "full" || request.build_preview !== false || request.dry_run !== true
      || Object.keys(request.corrections || {}).length || request.prospect_hints?.services?.length)
    return fail("unverified_request_correction");
  if (services.some(name => !intakeQuality.serviceLabel(name)
      || !proven.some(o => intakeQuality.sourceObservationService(o, name)))) return fail("service_provenance_unverified");
  if (Object.keys(compiled.contentFiles || {}).some(name => typeof compiled.contentFiles[name] !== "string")) return fail("content_files_invalid");
  // A separately named provider is not this prospect, even if the page was on the same domain.
  if (!Array.isArray(compiled.services) || compiled.services.length !== services.length
      || compiled.services.some(s => s.providerName !== name || !services.includes(s.name)))
    return fail("polluted_service_provider");
  if (pages.some(page => !urlKey(page.sourceUrl, site) || !/^content\/source-pages\//.test(page.file)
      || hash(compiled.contentFiles?.[page.file] || "") !== page.sha256
      || !proven.some(o => urlKey(o.source, site) === urlKey(page.sourceUrl, site)
        && o.private_source?.markdown === compiled.contentFiles[page.file])))
    return fail("source_archive_unverified");
  const required = new Map();
  const add = observation => { if (observation) required.set(urlKey(observation.source, site), observation); };
  add(proven.find(o => o.extracted?.brandName === name
    && o.private_source.markdown.includes(name) && hasLocation(o)
     && normWords(o.private_source.markdown).includes(normWords(category))));
  for (const name of services) add(proven.find(o => intakeQuality.sourceObservationService(o, name)));
  for (const route of compiled.routeContentMap || []) {
    if (!(route.contentFiles || []).some(name => names.includes(name))) continue;
    for (const file of route.sourceContentFiles || []) {
      const page = pages.find(page => page.file === file);
      const observation = page && proven.find(o => urlKey(o.source, site) === urlKey(page.sourceUrl, site));
      if (!observation) return fail("released_route_source_unverified");
      add(observation);
    }
  }
  if (!required.size || required.size > 8) return fail("fresh_source_budget_exceeded");
  return { ok: true, bytes, packet2: p, snapshot_sha256, visitor_files: names.length,
    name, city, state, category, site, hasLocation, extracted,
    required_urls: [...required.keys()], saved_by_url: required };

}
function compareFresh(checked, fresh) {
  const normWords = value => " " + clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const urls = checked.required_urls;
  if (fresh?.ok !== true || !Array.isArray(fresh.observations)
      || fresh.observations.length !== urls.length
      || JSON.stringify(fresh.sources) !== JSON.stringify(urls)
      || JSON.stringify(fresh.coverage?.attempted) !== JSON.stringify(urls)
      || JSON.stringify(fresh.coverage?.succeeded) !== JSON.stringify(urls)
      || fresh.coverage?.counts?.failed !== 0 || fresh.coverage?.counts?.truncated !== 0)
    return fail("fresh_harvest_incomplete");
  const observations = [];
  const pages = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i], saved = checked.saved_by_url.get(url), observed = fresh.observations[i];
    if (urlKey(observed?.source, checked.site) !== url || observed.source !== url
        || observed.status !== "succeeded" || observed.private_source?.markdown_truncated === true
        || saved.private_source?.markdown_truncated === true)
      return fail("fresh_source_url_or_body_mismatch");
    const before = bodyText(saved.private_source?.markdown);
    const after = bodyText(observed.private_source?.markdown);
    if (!before || !after || hash(before) !== hash(after))
      return fail("fresh_source_url_or_body_mismatch");
    // Extracted labels are usable only after the new server observation matches
    // the saved page body and URL. The provider's new extraction may vary.
    observations.push({ ...observed, extracted: saved.extracted });
    pages.push({ url, normalized_sha256: hash(after) });
  }
  const name = checked.name;
  if (!observations.some(o => o.extracted?.brandName === name
      && o.private_source.markdown.includes(name) && checked.hasLocation(o)
       && normWords(o.private_source.markdown).includes(normWords(checked.category))))
    return fail("fresh_identity_unproven");
  const categorySource = observations.find(o => o.extracted?.brandName === checked.name
    && checked.hasLocation(o) && normWords(o.private_source.markdown).includes(normWords(checked.category)));
  if (!categorySource) return fail("fresh_category_unproven");
  const services = checked.packet2.compiled.contentContract.facts.services;
  if (services.some(label => !observations.some(o => intakeQuality.sourceObservationService(o, label))))
    return fail("fresh_service_unproven");
  return { ok: true, observations, pages, category_source_url: categorySource.source };
}
async function importPacket2(input, dependencies = {}) {
  const checked = preflight(input);
  if (!checked.ok) return checked;
  const p = checked.packet2;
  // Rebuild the direct mailed Packet2 with the existing compiler. This is a
  // structural check only; no saved observation becomes trusted until fresh match.
  const replay = buildPacket.compilePacket(p);
  if (replay?.compiled?.contentContract?.visitor_copy?.safety?.pass !== true
      || JSON.stringify(replay.compiled.contentContract.visitor_copy.file_hashes)
        !== JSON.stringify(p.compiled.contentContract.visitor_copy.file_hashes))
    return fail("snapshot_recompile_mismatch");
  const incoming = p.compiled.contentFiles, regenerated = replay.compiled.contentFiles;
  if (Object.keys(incoming).length !== Object.keys(regenerated).length
      || Object.keys(incoming).some(name => name !== "content/content-quality-report.json" && incoming[name] !== regenerated[name]))
    return fail("content_bodies_mismatch");
  const report = "content/content-quality-report.json";
  try {
    const a = JSON.parse(incoming[report]), b = JSON.parse(regenerated[report]);
    delete a.generatedAt; delete b.generatedAt;
    if (JSON.stringify(a) !== JSON.stringify(b)) return fail("quality_report_mismatch");
  } catch { return fail("quality_report_invalid"); }
  // Only this server invokes the existing intake fetcher with its own key.
  // The caller cannot supply observations or an attestation in the request.
  let fresh;
  try {
    fresh = await (dependencies.harvestExactSourceUrls || harvestExactSourceUrls)({
      urls: checked.required_urls, apiKey: dependencies.apiKey || process.env.FIRECRAWL_API_KEY,
    });
  } catch { return fail("fresh_harvest_unavailable"); }
  const matched = compareFresh(checked, fresh);
  if (!matched.ok) return matched;
  const supportedServices = p.compiled.contentContract.facts.services.join("\n");
  const extracted = { ...checked.extracted, exactServices: supportedServices, mainServices: supportedServices };
  const harvest = { ok: true, sources: checked.required_urls, extracted,
    observations: matched.observations, evidence: [], coverage: fresh.coverage };
  const canonical = compiler.compileCanonicalPacket(input.request, harvest);
  if (canonical.ok !== true || canonical.status !== "compiled"
      || canonical.facts?.name !== checked.name
      || clean(canonical.facts?.category).toLowerCase() !== checked.category.toLowerCase()
      || clean(canonical.facts?.city).toLowerCase() !== checked.city.toLowerCase()
      || clean(canonical.facts?.state).toLowerCase() !== checked.state.toLowerCase()
      || canonical.facts?.services_source !== "source_observation"
      || JSON.stringify(canonical.facts?.services) !== JSON.stringify(p.compiled.contentContract.facts.services))
    return fail("fresh_canonical_mismatch");
  const verified = canonical.service_evidence || [];
  if (canonical.facts.services.some(name => !verified.some(e => e.value === name
    && e.verification_status === "source_observation" && e.provenance === "observed"
    && urlKey(e.source_url, checked.site) && e.source_observations?.some(url => urlKey(url, checked.site) === urlKey(e.source_url, checked.site)))))
    return fail("fresh_service_evidence_missing");
  // Existing compiler supplies fresh facts and evidence. Exact released Packet2
  // bodies/hashes are then carried as an immutable whole into the trusted signer.
  canonical.packet2 = p;
  canonical.packet2_hash = compiler.semanticPacketHash(p);
  canonical.job_id = "pagehub:" + canonical.packet2_hash.slice(0, 24);
  canonical.content.services = p.compiled.services;
  canonical.content.content_contract = { ...p.compiled.contentContract,
     facts: { ...p.compiled.contentContract.facts, category: checked.category } };
  canonical.content.content_files = p.compiled.contentFiles;
  canonical.content.content_quality = p.compiled.contentQuality;
  canonical.content.route_content_map = p.compiled.routeContentMap;
  canonical.content.page_plan = p.pagePlan;
  canonical.source_match = { version: "server-exact-source-match-v1",
    pages: matched.pages, matched_count: matched.pages.length,
     category_source_url: matched.category_source_url };
  return { ok: true, packet: canonical, snapshot_sha256: checked.snapshot_sha256 };
}
module.exports = { preflight, compareFresh, importPacket2 };
