import { createHash } from "node:crypto";

export const REMIX_PACKET_VERSION = "remix-packet-v1";

const VOLATILE_KEYS = new Set([
  "canonical_hash",
  "compiled_at",
  "created_at",
  "generated_at",
  "timestamp",
  "updated_at",
]);

const clean = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const list = (value, max = 50) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).slice(0, max);
const unique = (values) => [...new Set(values.filter(Boolean))];

function publicUrl(value) {
  const raw = clean(value, 2_048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function sourceId(type, url, index) {
  const seed = `${type}:${url || index}`;
  return `src_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

function sourceRegistry(input = {}, discovery = {}, evidence = []) {
  const rows = [];
  const add = (type, url, ownership = "unverified", meta = {}) => {
    const normalizedUrl = publicUrl(url);
    if (!normalizedUrl) return;
    const key = `${type}:${normalizedUrl}`;
    if (rows.some((row) => `${row.type}:${row.url}` === key)) return;
    rows.push({
      id: sourceId(type, normalizedUrl, rows.length),
      type: clean(type, 40) || "other",
      url: normalizedUrl,
      ownership: ["first_party", "owner_supplied", "third_party"].includes(ownership) ? ownership : "unverified",
      verified: meta.verified === true,
    });
  };

  const sources = input.sources || {};
  add("website", sources.website_url || input.website_url, "first_party", { verified: input.source_verification?.website === true });
  add("business_profile", sources.gbp_url || input.gbp_url, "third_party");
  add("social", sources.social_url || input.social_url, "unverified");
  add("asset_folder", sources.asset_url || input.asset_url, "owner_supplied", { verified: input.owner_upload_verified === true });
  for (const row of list(discovery.searched || discovery.sources, 50)) {
    if (typeof row === "string") add("discovered_page", row, "unverified");
    else add(row?.type || "discovered_page", row?.url || row?.source_url, row?.ownership, row || {});
  }
  for (const row of list(evidence, 100)) {
    if (row && typeof row === "object") add(row.type || "evidence", row.source_url || row.url, row.ownership, row);
  }
  return rows;
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function provenanceFor(value, field, input, sources, evidence = []) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return [];
  const explicit = input?.field_provenance?.[field] || input?.provenance?.[field];
  if (explicit) return list(explicit, 10).map((item) => typeof item === "string"
    ? { source_id: item, method: "provided" }
    : { source_id: clean(item?.source_id, 80) || null, source_url: publicUrl(item?.source_url), method: clean(item?.method, 80) || "provided" })[0];
  const fieldNames = field === "location" ? ["city", "state"] : [field];
  const matches = list(evidence, 200).filter((row) => fieldNames.includes(row?.field));
  const sourced = matches.find((row) => ["official_source", "website", "gbp", "social", "asset_folder"].includes(row?.source_type)
    && (field === "location" || sameValue(row?.value, value)));
  if (sourced) {
    const source = sources.find((row) => row.url === publicUrl(sourced.source_url));
    return { source_id: source?.id || null, source_url: publicUrl(sourced.source_url), method: sourced.source_type };
  }
  const operator = matches.find((row) => sameValue(row?.value, value) || field === "location");
  return { source_id: null, source_url: null, method: clean(operator?.source_type, 80) || "operator_input" };
}

function field(value, name, input, sources, evidence, transform = (item) => item) {
  const normalized = value == null || value === "" ? null : transform(value);
  return { value: normalized, provenance: provenanceFor(normalized, name, input, sources, evidence) };
}

function brandCandidate(value, kind, sources) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return { value: clean(value, 2_048), verified: false, ownership: "unverified", source_id: null };
  const sourceIdValue = clean(value.source_id, 80) || null;
  const source = sources.find((row) => row.id === sourceIdValue);
  const ownership = value.ownership || source?.ownership || "unverified";
  const verified = value.verified === true || value.authenticated_owner_upload === true || source?.verified === true;
  const raw = kind === "logo" || kind === "media" ? publicUrl(value.url || value.value) : clean(value.value ?? value.url, 200);
  if (!raw) return null;
  return { value: raw, verified, ownership, source_id: sourceIdValue };
}

function pickBrand(values, kind, sources) {
  const candidates = list(values, 120).map((value) => brandCandidate(value, kind, sources)).filter(Boolean);
  const score = (item) => (item.verified ? 4 : 0) + (item.ownership === "owner_supplied" ? 3 : item.ownership === "first_party" ? 2 : 0);
  return candidates.sort((left, right) => score(right) - score(left))[0] || null;
}

function brandSection(input, facts, discovery, assets, sources) {
  const discovered = discovery.branding || discovery.brand || discovery.found || {};
  const rawReview = input.brand_review || {};
  const reviewSource = clean(rawReview.verification_source, 40);
  const reviewed = rawReview.verified === true && rawReview.trusted_context === true
    && ["owner_upload", "admin_review", "official_source"].includes(reviewSource)
    ? rawReview
    : {};
  const supplied = input.branding || input.brand || {};
  const candidates = (kind) => [
    ...list(supplied[kind], 120),
    ...list(facts?.branding?.[kind], 120),
    ...list(discovered[kind], 120),
    ...list(assets, 120).filter((asset) => asset?.kind === kind.slice(0, -1) || asset?.kind === kind),
  ];
  const verifiedProvenance = { verified: true, ownership: "owner_supplied", source_id: null };
  const reviewCandidate = reviewed.verified ? verifiedProvenance : { verified: false, ownership: "unverified", source_id: null };
  if (rawReview.logo_url) supplied.logo = { url: rawReview.logo_url, ...reviewCandidate };
  if (rawReview.colors?.length) supplied.colors = rawReview.colors.map((value) => ({ value, ...reviewCandidate }));
  if (rawReview.fonts?.length) supplied.fonts = rawReview.fonts.map((value) => ({ value, ...reviewCandidate }));
  const logo = pickBrand([supplied.logo, facts?.branding?.logo, discovered.logo, discovered.logo_url, ...list(assets).filter((asset) => asset?.kind === "logo")], "logo", sources);
  const decorate = (value) => ({ value, provenance: value && reviewed.verified ? { ...verifiedProvenance, verification_source: reviewSource } : { verified: false, ownership: "unverified", source_id: null } });
  const selectedColors = rawReview.colors?.length ? rawReview.colors : unique(candidates("colors").map((item) => pickBrand([item], "color", sources)?.value)).slice(0, 12);
  const selectedFonts = rawReview.fonts?.length ? rawReview.fonts : unique(candidates("fonts").map((item) => pickBrand([item], "font", sources)?.value)).slice(0, 8);
  return {
    logo: logo ? { url: logo.value, provenance: { verified: logo.verified, ownership: logo.ownership, source_id: logo.source_id } } : null,
    colors: selectedColors.map(decorate),
    fonts: selectedFonts.map(decorate),
    media: candidates("media").concat(candidates("photos"))
      .map((item) => brandCandidate(item, "media", sources))
      .filter(Boolean)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.value === item.value) === index)
      .slice(0, 120),
    precedence: "verified owner-supplied, then verified first-party, then unverified candidate",
  };
}

function requirementsSection(input = {}) {
  const raw = input.requirements || input.build_requirements || {};
  const textList = (value, max) => unique(list(value, max).map((item) => clean(item, 300))).filter(Boolean);
  return {
    site_type: clean(raw.site_type || input.site_type, 80) || null,
    template: clean(raw.template_id || raw.template || input.template_id, 120) || null,
    execution_mode: clean(raw.execution_mode || input.execution_mode, 80) || null,
    page_plan: textList(raw.page_plan || input.page_plan, 30),
    must_include: textList(raw.must_include || input.must_include, 40),
    must_avoid: textList(raw.must_avoid || input.must_avoid, 40),
    settings: raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {},
  };
}

function score(parts) {
  return Math.round((parts.filter(Boolean).length / Math.max(parts.length, 1)) * 100);
}

function readiness(packet) {
  const p = packet.prospect;
  const r = packet.requirements;
  const subscores = {
    sources: score([packet.sources.length > 0, packet.sources.some((row) => row.type === "website")]),
    business_details: score([p.name.value, p.location.value, p.category.value, p.services.value?.length]),
    brand_assets: score([packet.brand.logo, packet.brand.colors.length, packet.brand.fonts.length, packet.brand.media.length]),
    requirements: score([r.site_type, r.template, r.execution_mode, r.page_plan.length]),
    rendered_verification: packet.rendered_verification.verified ? 100 : 0,
  };
  const preRender = Math.round((subscores.sources + subscores.business_details + subscores.brand_assets + subscores.requirements) / 4);
  return { score: preRender, subscores, compile_ready: preRender === 100, release_ready: preRender === 100 && subscores.rendered_verification === 100 };
}

function warningsFor(packet) {
  const warnings = [];
  const add = (code, field, message) => warnings.push({ code, field, message });
  for (const [name, item] of Object.entries(packet.prospect)) if (item?.value == null || (Array.isArray(item?.value) && !item.value.length)) add(`missing_${name}`, `prospect.${name}`, `${name} is unknown and was not invented.`);
  if (!packet.brand.logo) add("missing_brand_asset", "brand.logo", "No verified logo is available.");
  if (!packet.brand.colors.length) add("missing_brand_asset", "brand.colors", "No source-backed colors are available.");
  if (!packet.brand.fonts.length) add("missing_brand_asset", "brand.fonts", "No source-backed fonts are available.");
  if (!packet.brand.media.length) add("missing_brand_asset", "brand.media", "No source-backed media are available.");
  if (!packet.requirements.site_type) add("missing_requirement", "requirements.site_type", "Site type is not set.");
  if (!packet.requirements.template) add("missing_requirement", "requirements.template", "Template is not set.");
  if (!packet.requirements.execution_mode) add("missing_requirement", "requirements.execution_mode", "Execution mode is not set.");
  if (!packet.requirements.page_plan.length) add("missing_requirement", "requirements.page_plan", "Page plan is not set.");
  if (!packet.rendered_verification.verified) add("rendered_verification_required", "rendered_verification", "A real rendered DOM check is required before release.");
  add("owner_approval_required", "build_handoff.owner_approval_required", "Owner approval is required; compilation cannot authorize sending.");
  return warnings;
}

function withoutVolatile(value) {
  if (Array.isArray(value)) return value.map(withoutVolatile);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !VOLATILE_KEYS.has(key)).map((key) => [key, withoutVolatile(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(withoutVolatile(value));
}

export function canonicalHashForRemixPacket(packet) {
  return createHash("sha256").update(stableStringify(packet)).digest("hex");
}

export function buildRemixPacket({ input = {}, facts = {}, discovery = {}, evidence = [], assets = [], warnings = [], renderedVerification = null, renderedEvidence = null } = {}) {
  const sources = sourceRegistry(input, discovery, evidence);
  const renderEvidence = renderedEvidence || renderedVerification;
  const trustedRenderMethod = ["playwright-dom", "browser-dom", "rendered-dom"].includes(clean(renderEvidence?.method, 80));
  const validCheckedAt = Number.isFinite(Date.parse(String(renderEvidence?.checked_at || "")));
  const explicitRenderEvidence = renderEvidence && renderEvidence.verified === true && trustedRenderMethod && validCheckedAt
    && (publicUrl(renderEvidence.url) || clean(renderEvidence.artifact_id, 160));
  const packet = {
    version: REMIX_PACKET_VERSION,
    sources,
    prospect: {
      name: field(facts.name || input.prospect_hints?.name, "name", input, sources, evidence, (value) => clean(value, 160)),
      category: field(facts.category || input.prospect_hints?.category, "category", input, sources, evidence, (value) => clean(value, 100)),
      location: field((facts.city || facts.state || input.prospect_hints?.city || input.prospect_hints?.state) ? {
        city: clean(facts.city || input.prospect_hints?.city, 100) || null,
        state: clean(facts.state || input.prospect_hints?.state, 20) || null,
      } : null, "location", input, sources, evidence),
      phone: field(facts.phone || input.prospect_hints?.phone, "phone", input, sources, evidence, (value) => clean(value, 40)),
      email: field(facts.email, "email", input, sources, evidence, (value) => clean(value, 254)),
      address: field(facts.address || input.prospect_hints?.address, "address", input, sources, evidence, (value) => clean(value, 240)),
      website: field(facts.website || input.sources?.website_url, "website", input, sources, evidence, publicUrl),
      services: field(facts.services || input.prospect_hints?.services, "services", input, sources, evidence, (value) => unique(list(value, 40).map((item) => clean(item, 120))).filter(Boolean)),
    },
    brand: brandSection(input, facts, discovery, assets, sources),
    requirements: requirementsSection(input),
    rendered_verification: {
      required: true,
      verified: Boolean(explicitRenderEvidence),
      method: explicitRenderEvidence ? clean(renderEvidence.method, 80) || null : null,
      checked_at: explicitRenderEvidence ? new Date(renderEvidence.checked_at).toISOString() : null,
      url: explicitRenderEvidence ? publicUrl(renderEvidence.url) : null,
      artifact_id: explicitRenderEvidence ? clean(renderEvidence.artifact_id, 160) || null : null,
    },
    production_locks: { owner_approval_required: true, owner_approved: false, send_allowed: false },
    source_registry: sources,
    media_inventory: list(discovery.media_inventory || discovery.image_inventory, 120),
    navigation_pages: list(discovery.navigation_pages, 30),
    readiness: null,
    warnings: [],
    canonical_hash: "",
  };
  packet.readiness = readiness(packet);
  packet.warnings = [...warningsFor(packet), ...list(warnings, 100).map((item) => typeof item === "string" ? { code: "upstream_warning", field: null, message: clean(item, 500) } : item)];
  packet.readiness.warnings = packet.warnings;
  packet.canonical_hash = canonicalHashForRemixPacket(packet);
  return packet;
}

export default buildRemixPacket;
