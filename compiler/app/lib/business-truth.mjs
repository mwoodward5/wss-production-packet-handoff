import { createHash } from "node:crypto";

const UI_JUNK = /^(?:service areas?|street view|transit|traffic|biking|terrain|saved|recents|restaurants|hotels|parking|pharmacies|atms)$/i;
const BAD_MEDIA = /(?:google\.com\/maps\/vt|maps\.gstatic\.com|w32-h32|branding\/mapslogo|streetviewpixels)/i;
const VERTICALS = {
  fencing: /\b(?:fenc(?:e|es|ing)|cedar privacy|chain link|wrought iron|ranch rail|custom gates?)\b/i,
  landscaping: /\b(?:landscap|lawn care|yard care|irrigation|sprinkler|planting|hardscap)\b/i,
  roofing: /\b(?:roof|shingle|gutter)\b/i,
  electrical: /\b(?:electric|panel|wiring|ev charger)\b/i,
};
const SERVICE_ALLOW = {
  fencing: /\b(?:fenc\w*|gate\w*|cedar\w*|iron\w*|chain[ -]?link\w*|ranch[ -]?rail\w*|repair\w*)\b/i,
  landscaping: /\b(?:landscap\w*|lawn\w*|yard\w*|irrigat\w*|sprinkler\w*|plant\w*|patio\w*|paver\w*|hardscap\w*|concrete\w*|driveway\w*|fire[ -]?pit\w*|retaining[ -]?wall\w*|outdoor[ -]?(?:kitchen|bbq)\w*|pool[ -]?design\w*|cleanup\w*|maintenan\w*)\b/i,
  roofing: /\b(?:roof\w*|shingle\w*|gutter\w*|storm\w*|hail\w*|leak\w*)\b/i,
  electrical: /\b(?:electric\w*|panel\w*|wiring\w*|light\w*|charger\w*|troubleshoot\w*)\b/i,
};

function evidenceText(packet, sourceFacts) {
  return [sourceFacts?.copy, packet?.enrichment_sources?.copy?.value, packet?.business?.name,
    ...(packet?.source_evidence || []).map((e) => `${e.field} ${e.value}`)].filter(Boolean).join("\n");
}
function primaryVertical(packet, sourceFacts) {
  const text = evidenceText(packet, sourceFacts);
  const identity = String(sourceFacts?.name || packet?.business?.name || "");
  const identityMatch = Object.entries(VERTICALS).find(([, re]) => re.test(identity));
  if (identityMatch) return identityMatch[0];
  const declared = String(sourceFacts?.category || packet?.business?.category || "").toLowerCase();
  const declaredMatch = Object.keys(VERTICALS).find((v) => declared.includes(v));
  if (declaredMatch) return declaredMatch;
  const scored = Object.entries(VERTICALS).map(([key, re]) => [key, (text.match(new RegExp(re.source, "gi")) || []).length]);
  scored.sort((a, b) => b[1] - a[1]);
  if (scored[0]?.[1] >= 2 && scored[0][1] > (scored[1]?.[1] || 0)) return scored[0][0];
  return declared || "local service";
}
function cleanCity(value) {
  const s = String(value || "").trim();
  if (!s || /(?:contractor|landscap|fenc|roof|service|near me)/i.test(s)) return "";
  return s.replace(/^[^A-Za-z]+|[^A-Za-z .'-]+$/g, "").trim();
}
function cityFromEvidence(text, state) {
  const matches = [...String(text).matchAll(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}),\s*([A-Z]{2})\b/g)];
  const hit = matches.find((m) => !state || m[2] === state);
  return hit?.[1] || "";
}
function evidenceContains(text, value) {
  const fold = (input) => String(input).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const needle = fold(value);
  return Boolean(needle) && fold(text).includes(needle);
}

function cleanServices(values, vertical, businessName = "", evidenceText = "", { provenance = "claimed" } = {}) {
  const allow = SERVICE_ALLOW[vertical];
  const categoryOnly = /^(?:landscaper|landscaping|fencing|fence contractor|roofer|roofing|electrician|electrical)$/i;
  const admitted = [];
  const allowlistMisses = [];
  for (const raw of values || []) {
    const x = String(raw || "").replace(/[^\x20-\x7E]/g, "").trim();
    if (!x || x.toLowerCase() === String(businessName).toLowerCase() || categoryOnly.test(x) || UI_JUNK.test(x)) continue;
    if (!allow || allow.test(x)) admitted.push(x);
    // Lane02 2026-09-09: the four allowlists above are narrower than the real
    // service menus of certified sites ("Siding Repair" at a roofing company,
    // "Deck Building" at a fence company), and the strict filter emptied the
    // packet's whole services list — source-bound work silently vanished from
    // the visible page. A miss is recoverable ONLY when the certified
    // official-source copy literally states the service (same admission rule
    // as buildCanonicalPacket's inSourceText), so donor/contaminated lists
    // still cannot cross in.
    else if (evidenceText && evidenceContains(evidenceText, x)) allowlistMisses.push(x);
    // Owner directive 2026-09-19: preserve real source-supported services.
    // The crawler's OWN extractions (provenance "discovered", carried
    // separately as discovered_services) were read off the business's pages
    // and are source-bound by construction — the allowlist polices CLAIMS
    // (donor/contaminated lists), never the client's actual work menu.
    // 10 discovered services collapsing to 4 broad labels was exactly that
    // deletion. The default stays "claimed": an echoed list cannot
    // re-admit itself (the anti-echo law is test-pinned).
    else if (provenance === "discovered") allowlistMisses.push(x);
  }
  return [...new Set([...admitted, ...allowlistMisses])].slice(0, 10);
}
// Keep this identity vocabulary aligned with source-intake's ownerKey().
// Trade words identify the vertical, not the company owner.
const OWNER_KEY_STOP = /^(?:a|an|and|co|company|corp|corporation|group|inc|llc|ltd|of|service|services|solutions|team|the|construction|contracting|contractor|contractors|electric|electrical|fence|fencing|landscape|landscapes|landscaping|lawn|plumbing|pool|pools|roof|roofing)$/i;

function ownerKey(value = "") {
  const tokens = String(value).toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 3 && !OWNER_KEY_STOP.test(token)) || [];
  return [...new Set(tokens)].slice(0, 4).join("-");
}

function publicHost(value = "") {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function isAuthenticatedOwnerUpload(asset = {}) {
  if (asset?.provenance?.authenticated_owner_upload === true || asset?.authenticated_owner_upload === true) return true;
  const source = String(asset?.provenance?.source || asset.source || "").trim();
  const origin = String(asset?.provenance?.origin || asset.origin || "").trim();
  return /^upload$/i.test(source) && /^upload$/i.test(origin);
}

function ownedLogo(asset, businessName) {
  if (!asset?.url || asset.approved === false || BAD_MEDIA.test(asset.url)) return false;
  if (isAuthenticatedOwnerUpload(asset)) return true;

  const provenance = asset.provenance || {};
  const targetKey = ownerKey(businessName);
  const sourceUrl = String(provenance.source_url || asset.source_url || "");
  const sourceHost = String(provenance.source_host || asset.source_host || "").toLowerCase().replace(/^www\./, "");
  const provenanceKey = String(provenance.owner_key || asset.owner_key || "").toLowerCase();
  if (!targetKey || !sourceUrl || !sourceHost || publicHost(sourceUrl) !== sourceHost) return false;

  const targetTokens = targetKey.split("-").filter(Boolean);
  const sourceIdentityMatches = targetTokens.length > 0
    && targetTokens.every((token) => sourceHost.replace(/[^a-z0-9]/g, "").includes(token));
  return provenanceKey === targetKey || sourceIdentityMatches;
}

export function enforceBusinessTruth(packet, { sourceFacts = {}, sourceAssets = [] } = {}) {
  const truth = structuredClone(packet);
  const text = evidenceText(truth, sourceFacts);
  const vertical = primaryVertical(truth, sourceFacts);
  const state = String(sourceFacts.state || truth.business?.state || "").toUpperCase();
  const city = cleanCity(sourceFacts.city || truth.business?.city) || cityFromEvidence(text, state);
  // Allowlist recovery keys on source COPY only — never on packet.source_evidence,
  // whose services rows merely echo the claimed list back (that would let a
  // donor/contaminated service list re-admit itself). The crawler's own
  // extractions (discovered_services) are the one source-bound-by-construction
  // set; packet lists stay policed.
  const evidenceCopy = [sourceFacts?.copy, truth.enrichment_sources?.copy?.value].filter(Boolean).join("\n");
  const crawled = Array.isArray(sourceFacts.discovered_services) ? sourceFacts.discovered_services : [];
  const services = crawled.length
    ? cleanServices(crawled, vertical, truth.business?.name, evidenceCopy, { provenance: "discovered" })
    : cleanServices(truth.services, vertical, truth.business?.name, evidenceCopy, { provenance: "claimed" });
  truth.business = { ...truth.business, category: vertical, city, state };
  truth.services = services;
  truth.media = { ...(truth.media || {}), catalog: (truth.media?.catalog || []).filter((m) => m?.url && !BAD_MEDIA.test(m.url)) };
  const matchedAsset = sourceAssets.find((a) => a.kind === "logo" && a.url === truth.v7_logo?.url);
  const logo = sourceAssets.find((a) => a.kind === "logo" && ownedLogo(a, truth.business?.name)) || (!matchedAsset && truth.v7_logo?.url && ownedLogo({ url: truth.v7_logo.url, source: truth.v7_logo.origin, origin: truth.v7_logo.origin }, truth.business?.name) ? { url: truth.v7_logo.url, source: truth.v7_logo.origin, origin: truth.v7_logo.origin } : null);
  if (!logo) { delete truth.v7_logo; delete truth.logo_source; }
  truth.canonical_truth = Object.freeze({ version: "business-truth-v1", name: truth.business?.name || "", primary_vertical: vertical, city, state, services: truth.services || [], evidence_count: truth.source_evidence?.length || 0 });
  if (logo) truth.logo_source = { ...truth.logo_source, url: logo.url, origin: logo.source || "source", proposed: false, confidence: 0.9, checksum: createHash("sha256").update(logo.url).digest("hex"), transformed_asset_path: logo.meta?.local_path || truth.logo_source?.local_path || null };
  return truth;
}

export const truthGuards = { UI_JUNK, BAD_MEDIA };

/** Test/audit surface for the service admission law; production callers use
 * enforceBusinessTruth, which passes provenance from the values' origin. */
export function cleanServicesWithProvenance(values, vertical, businessName = "", evidenceText = "", options = {}) {
  return cleanServices(values, vertical, businessName, evidenceText, options);
}
