"use strict";

// lib/mirror-engine/client-isolation.js — GATE 4C, the build-start precondition.
//
// ROOT INCIDENT: scratchpad data dirs were reused across prospects. A file
// named sizzle4/genie-packet.json, labelled "Ramon", actually contained MUSIC
// CITY ROOFERS data. Validating Ramon's service claims against it produced a
// confident, completely invalid finding — the worst class of defect, because
// every downstream gate passed on foreign truth.
//
// This module makes that structurally impossible BEFORE a build starts:
//
//   1. Every client owns a namespaced, identifier-stamped data dir
//      <root>/clients/<slug>/ with client.stamp.json recording slug, domain,
//      phone digits, business name and created-at.
//   2. assertClientIsolation({ slug, truthSource }) THROWS — the build refuses
//      to start — unless the truth source carries the stamped domain AND the
//      stamped phone.
//   3. A different business dominating the source (declared name, domain count
//      or phone count) fails with exactly which foreign business was found.
//   4. Zero client identifiers in a source claimed for that client is a FAIL,
//      never a warning. A missing/empty/unreadable source is a FAIL, never a
//      vacuous pass.
//
// PARSER RULES (non-negotiable, learned the hard way):
//   · Numeric identity (phone, postal) is matched only on shaped tokens with
//     digit boundaries, so a 16-digit SKU containing a phone's digits never
//     matches, and never inside SVG/CSS geometry (path d, viewBox, transform,
//     points, …). Geometry is excluded STRUCTURALLY, by attribute/property
//     name, before any numeric matcher runs — not filtered out afterwards.
//   · Nothing in here is client-specific. Identity arrives from the stamp;
//     foreign markers arrive from the source, from sibling stamps and from an
//     optional caller-supplied donor registry. This runs on ~500 mirrors.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const STAMP_FILE = "client.stamp.json";
const STAMP_SCHEMA = "mirror-engine-client-stamp-v1";
const CLIENTS_DIRNAME = "clients";

// ---------------------------------------------------------------------------
// Geometry safe zones — same contract as tools/identity.manifest.json.
// A numeric hit inside one of these is a PARSER BUG, so the text is blanked
// before matching rather than the hits being filtered after.
// ---------------------------------------------------------------------------
const SVG_GEOMETRY_ATTRS = [
  "d", "viewBox", "transform", "points", "cx", "cy", "r", "rx", "ry",
  "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "width", "height",
  "stroke-width", "stroke-dasharray", "stroke-dashoffset", "offset",
  "preserveAspectRatio", "gradientTransform", "patternTransform", "pathLength",
];
// A geometry value is numbers, separators and SVG path commands — never letters
// that could carry identity. Both conditions must hold: the NAME is a geometry
// attribute AND the VALUE is pure geometry.
const PURE_GEOMETRY_VALUE = /^[\s\d.,+\-eE%MmLlHhVvCcSsQqTtAaZz()]*$/;

const GEOM_NAMES = SVG_GEOMETRY_ATTRS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// name="…" | name=\"…\" | name='…'      (markup / JSX attribute form)
const GEOM_ATTR_RE = new RegExp(`(?<![A-Za-z0-9_-])(?:${GEOM_NAMES})\\s*=\\s*(\\\\?["'])([\\s\\S]*?)\\1`, "gi");
// "name":"…" | name:'…' | \"name\":\"…\"  (JS/JSON property form)
const GEOM_PROP_RE = new RegExp(`(?<![A-Za-z0-9_-])(?:\\\\?["'])?(?:${GEOM_NAMES})(?:\\\\?["'])?\\s*:\\s*(\\\\?["'])([\\s\\S]*?)\\1`, "gi");
// Opaque encoded payloads: digit soup that can never be a readable identifier.
const DATA_URI_RE = /data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]*(;[A-Za-z0-9-]+)*;base64,[A-Za-z0-9+/=\s\\]{16,}/gi;

const blanks = (n) => " ".repeat(n);

/**
 * Structurally remove every region that cannot carry identity, preserving
 * offsets so reported line numbers stay true.
 * Returns { text, excluded } where excluded counts blanked geometry regions.
 */
function geometrySafeText(raw) {
  let excluded = 0;
  let text = String(raw).replace(DATA_URI_RE, (m) => { excluded++; return blanks(m.length); });
  const blankIfGeometry = (m, _q, value) => {
    if (!PURE_GEOMETRY_VALUE.test(value)) return m; // letters present -> not geometry
    excluded++;
    return blanks(m.length);
  };
  text = text.replace(GEOM_ATTR_RE, blankIfGeometry).replace(GEOM_PROP_RE, blankIfGeometry);
  return { text, excluded };
}

// ---------------------------------------------------------------------------
// Shaped numeric matchers. Digit boundaries are load-bearing.
// ---------------------------------------------------------------------------
const PHONE_SHAPE = /(?<!\d)(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?!\d)/g;
const POSTAL_SHAPE = /(?<!\d)\d{5}(?!\d)/g;

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** Every phone-shaped token in geometry-safe text, as {raw, digits}. */
function extractPhones(safeText) {
  const out = [];
  PHONE_SHAPE.lastIndex = 0;
  let m;
  while ((m = PHONE_SHAPE.exec(safeText))) {
    const digits = m[1] + m[2] + m[3];
    if (/^[01]/.test(digits)) continue; // not a NANP subscriber number
    out.push({ raw: m[0], digits });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------
const TLDS = "com|net|org|co|io|us|biz|info|dev|app|xyz|site|online|pro|llc|inc|agency|services|solutions|company|team|shop|store|works|build|contractors|roofing|plumbing|homes|realty|law|clinic|care|life|studio";
const DOMAIN_RE = new RegExp(`(?<![A-Za-z0-9@._-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+(?:${TLDS}))(?![A-Za-z0-9-])`, "gi");

// Infrastructure / platform / directory hosts. Never evidence of a business.
const INFRA_SUFFIXES = new Set([
  "google.com", "googleapis.com", "gstatic.com", "google-analytics.com", "googletagmanager.com",
  "goo.gl", "schema.org", "w3.org", "example.com", "example.org", "localhost",
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "pinterest.com", "nextdoor.com",
  "yelp.com", "bbb.org", "angi.com", "homeadvisor.com", "thumbtack.com", "houzz.com",
  "birdeye.com", "podium.com", "nicejob.com", "trustpilot.com",
  "wss-ai.com", "vercel.app", "vercel.com", "lovable.dev", "lovable.app", "lovableproject.com",
  "netlify.app", "pages.dev", "github.com", "githubusercontent.com", "npmjs.com",
  "unsplash.com", "pexels.com", "cloudfront.net", "amazonaws.com", "cloudinary.com",
  "hubspot.com", "hubspotusercontent.com", "hs-scripts.com", "hsforms.com", "hsforms.net",
  "wix.com", "wixstatic.com", "wixsite.com", "squarespace.com", "webflow.io", "webflow.com",
  "wordpress.com", "wordpress.org", "weebly.com", "godaddy.com", "duda.co",
  "jsdelivr.net", "unpkg.com", "fontawesome.com", "gravatar.com", "typekit.net",
  "openstreetmap.org", "apple.com", "bing.com", "microsoft.com", "mozilla.org",
  "brightdata.com", "firecrawl.dev", "openrouter.ai", "resend.com", "supabase.co",
  "stripe.com", "calendly.com", "sentry.io", "tailwindcss.com", "vitejs.dev", "reactjs.org",
  // CDN / cloud storage / tag infrastructure. Naming one of these as "the
  // foreign business" is noise on a 500-mirror run, so they are excluded by
  // name: a hosting bucket is never evidence of whose data this is.
  "windows.net", "azurewebsites.net", "azureedge.net", "akamaized.net", "akamai.net",
  "fastly.net", "cloudflare.com", "cloudflareinsights.com", "cdn77.net", "imgix.net",
  "googleusercontent.com", "ggpht.com", "ytimg.com", "cdninstagram.com", "shopify.com",
  "doubleclick.net", "clarity.ms", "hotjar.com", "typeform.com", "jotform.com",
  "mailchimp.com", "constantcontact.com", "zapier.com", "twilio.com", "vapi.ai", "elevenlabs.io",
  // Free mailbox hosts — a client's @gmail address is not a business domain.
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "aol.com", "icloud.com",
]);

function normalizeDomain(value) {
  let d = String(value || "").trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0].replace(/[.:]+$/, "");
  return d;
}

const isInfra = (domain) => {
  for (const suffix of INFRA_SUFFIXES) if (domain === suffix || domain.endsWith("." + suffix)) return true;
  return false;
};

/** Business-looking domains in the text, counted. Map<domain, count>. */
function countDomains(text) {
  const counts = new Map();
  DOMAIN_RE.lastIndex = 0;
  let m;
  while ((m = DOMAIN_RE.exec(text))) {
    const d = normalizeDomain(m[1]);
    if (!d || isInfra(d)) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return counts;
}

/** Count a client domain including any subdomain of it. */
function countDomainFamily(counts, domain) {
  let n = 0;
  for (const [d, c] of counts) if (d === domain || d.endsWith("." + domain)) n += c;
  return n;
}

// ---------------------------------------------------------------------------
// Business names
// ---------------------------------------------------------------------------
// Generic words carry no identity, so they are ignored when deciding whether
// two names or a name and a slug refer to the SAME business. ("Falcon Roofing"
// vs "Ramon Roofing" must not match on "roofing".)
const GENERIC_TOKENS = new Set([
  "wss", "test", "the", "a", "an", "and", "of", "for", "at", "by",
  "llc", "inc", "co", "corp", "company", "group", "holdings", "enterprises", "ltd", "lp", "pllc",
  "services", "service", "solutions", "sons", "son", "brothers", "bros", "family", "team",
  "roofing", "roofers", "roof", "roofs", "plumbing", "plumbers", "plumber", "hvac", "heating",
  "cooling", "air", "electric", "electrical", "electricians", "landscaping", "lawn", "construction",
  "contractors", "contractor", "contracting", "builders", "remodeling", "renovations", "restoration",
  "cleaning", "cleaners", "detailing", "auto", "automotive", "pest", "control", "fencing", "fence",
  "paving", "concrete", "flooring", "painting", "painters", "tree", "pool", "spa", "salon", "med",
  "medical", "dental", "dentistry", "law", "legal", "insurance", "realty", "real", "estate",
  "exteriors", "interiors", "siding", "gutters", "windows", "doors", "supply", "specialists", "pros", "pro",
]);

function nameTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function significantTokens(value) {
  const all = nameTokens(value);
  const sig = all.filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t));
  return sig.length ? sig : all; // a fully generic name falls back to all tokens
}
const normalizeName = (value) => nameTokens(value).join(" ");

/** Do two business names refer to the same business? */
function sameBusinessName(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true; // "Ramon Roofing LLC" vs "Ramon Roofing"
  const sa = new Set(significantTokens(a)), sb = new Set(significantTokens(b));
  if (!sa.size || !sb.size) return false;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const t of small) if (!big.has(t)) return false;
  return true; // every significant token of the shorter name is present in the longer
}

// ---------------------------------------------------------------------------
// Declared-name paths. A BOUNDED list, deliberately: `name` appears on every
// service and review object, so a blanket scan would flag "Slate Roofing" as a
// foreign business. These paths are where a packet declares WHOSE packet it is.
// ---------------------------------------------------------------------------
const DECLARED_NAME_PATHS = [
  ["client"], ["clientName"], ["client_name"], ["slugClient"],
  ["name"], ["business_name"], ["businessName"],
  ["business", "name"], ["business", "business_name"],
  ["facts", "name"], ["facts", "business_name"], ["facts", "businessName"], ["facts", "company"],
  ["brand", "name"], ["profile", "name"], ["place", "name"], ["gbp", "name"],
  ["company"], ["companyName"], ["organization"], ["org", "name"], ["prospect", "name"], ["lead", "name"],
];
const DECLARED_DOMAIN_PATHS = [
  ["domain"], ["website"], ["url"], ["site"], ["siteUrl"],
  ["business", "website"], ["business", "domain"],
  ["facts", "website"], ["facts", "domain"], ["facts", "url"],
  ["primarySource"], ["prospect", "website"], ["lead", "website"],
];
const DECLARED_PHONE_PATHS = [
  ["phone"], ["phoneNumber"], ["phone_number"], ["telephone"],
  ["business", "phone"], ["facts", "phone"], ["facts", "phone_number"],
  ["prospect", "phone"], ["lead", "phone"],
];

/** Read a path, unwrapping the {value, source, publishable} truth-field shape. */
function readPath(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = cur[k];
  }
  if (cur && typeof cur === "object" && !Array.isArray(cur) && "value" in cur) cur = cur.value;
  return typeof cur === "string" || typeof cur === "number" ? String(cur) : undefined;
}

function declaredIdentity(parsed) {
  const pick = (paths) => {
    const out = [];
    for (const p of paths) {
      const v = readPath(parsed, p);
      if (v && v.trim()) out.push({ path: "/" + p.join("/"), value: v.trim() });
    }
    return out;
  };
  return { names: pick(DECLARED_NAME_PATHS), domains: pick(DECLARED_DOMAIN_PATHS), phones: pick(DECLARED_PHONE_PATHS) };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class ClientIsolationError extends Error {
  constructor(result) {
    const lines = result.failures.map((f) => `  ✗ [${f.check}] ${f.reason}`);
    super(`CLIENT ISOLATION VIOLATION — build refused for slug "${result.slug}"\n${lines.join("\n")}`);
    this.name = "ClientIsolationError";
    this.code = "client_isolation_violation";
    this.result = result;
    this.failures = result.failures;
  }
}

// ---------------------------------------------------------------------------
// Namespaced client data dirs
// ---------------------------------------------------------------------------
function defaultClientRoot() {
  if (process.env.MIRROR_CLIENT_ROOT) return path.resolve(process.env.MIRROR_CLIENT_ROOT);
  // A lambda's bundle at /var/task is READ-ONLY; only /tmp is writable. Measured
  // 2026-08-01: three leads passed every gate — logo, email, NAP, identity — and
  // died on the last one with `ENOENT: mkdir /var/task/apps/backend/artifacts/
  // clients/...`. Nothing was wrong with the leads or the engine; the process
  // simply could not create a directory. Same family as ffmpeg and Chromium:
  // something that exists on a developer machine and not in the runtime.
  //
  // /tmp is per-invocation and evaporates, which is correct for a dry run — its
  // whole job is to PROVE a build works, not to keep it. Real builds still write
  // wherever MIRROR_CLIENT_ROOT points.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
    return path.join(os.tmpdir(), "wss-clients");
  }
  return path.resolve(__dirname, "..", "..", "artifacts");
}
const clientsDir = (root) => path.join(path.resolve(root || defaultClientRoot()), CLIENTS_DIRNAME);
const clientDir = (slug, root) => path.join(clientsDir(root), slug);
const stampPath = (slug, root) => path.join(clientDir(slug, root), STAMP_FILE);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

/**
 * Create (or re-open) the namespaced, identifier-stamped data dir for a client.
 * Idempotent for identical identity; REFUSES to re-stamp a slug with different
 * identity — that collision is the incident itself.
 */
function ensureClientNamespace({ root, slug, businessName, domain, phone, postal, city, state, allowedSourceRoots = [], force = false }) {
  if (!slug || !SLUG_RE.test(slug)) throw new ClientIsolationError({ slug: String(slug), ok: false, failures: [{ check: "slug", reason: `invalid slug: ${JSON.stringify(slug)}` }] });
  const identity = {
    businessName: String(businessName || "").trim(),
    domain: normalizeDomain(domain),
    phoneDigits: normalizePhone(phone),
    postal: postal ? String(postal).trim() : "",
    city: city ? String(city).trim() : "",
    state: state ? String(state).trim() : "",
  };
  // PHONE LEFT THIS LIST ON 2026-08-01. Phone became an OPTIONAL fact (outreach
  // is email-only), and a client with no published number must still be
  // stampable — otherwise the isolation gate, not the funnel, decides who can
  // be mirrored. businessName + domain still pin the identity, and a supplied
  // phone is still held to exactly 10 NANP digits: optional means "may be
  // absent", never "may be wrong".
  const missing = ["businessName", "domain"].filter((k) => !identity[k]);
  if (missing.length) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp_identity", reason: `cannot stamp client without ${missing.join(", ")} (fail closed: an unstamped client can never be verified)` }] });
  }
  if (identity.phoneDigits && identity.phoneDigits.length !== 10) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp_identity", reason: `phone must reduce to 10 NANP digits, got "${phone}"` }] });
  }

  const dir = clientDir(slug, root);
  const file = stampPath(slug, root);
  const resolvedRoots = [dir, ...allowedSourceRoots.map((r) => path.resolve(r))];

  if (fs.existsSync(file) && !force) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    const drift = ["businessName", "domain", "phoneDigits"].filter((k) => normalizeName(existing[k]) !== normalizeName(identity[k]) && String(existing[k]) !== String(identity[k]));
    if (drift.length) {
      throw new ClientIsolationError({
        slug, ok: false,
        failures: [{ check: "stamp_conflict", reason: `slug "${slug}" is already stamped to ${existing.businessName} (${existing.domain} / ${existing.phoneDigits}); refusing to re-stamp as ${identity.businessName} (${identity.domain} / ${identity.phoneDigits}). Differing fields: ${drift.join(", ")}` }],
      });
    }
    // widen registered source roots, keep createdAt
    const merged = { ...existing, allowedSourceRoots: [...new Set([...(existing.allowedSourceRoots || []), ...resolvedRoots])], updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    return merged;
  }

  fs.mkdirSync(dir, { recursive: true });
  const stamp = {
    schema: STAMP_SCHEMA,
    slug,
    ...identity,
    dataDir: dir,
    allowedSourceRoots: [...new Set(resolvedRoots)],
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(stamp, null, 2));
  return stamp;
}

function readStamp(slug, root) {
  const file = stampPath(slug, root);
  if (!fs.existsSync(file)) return null;
  const stamp = JSON.parse(fs.readFileSync(file, "utf8"));
  if (stamp.schema !== STAMP_SCHEMA) throw new Error(`stamp schema mismatch for ${slug}: ${stamp.schema}`);
  return stamp;
}

/**
 * Widen a stamp with a phone it never had. Phone became an OPTIONAL fact on
 * 2026-08-01, so the first build for a slug can legitimately stamp with an
 * empty phone (outreach is email-only and the enriched fact had not landed
 * yet); the next build for the SAME business then arrives carrying the phone
 * and the agreement check would refuse it forever — measured 2026-08-31 on
 * wss-test-zins-plumbing-cincinnati and wss-test-bellagio-phoenix, both
 * stamped ("", name) and both killed at /facts with stamp_agreement.
 *
 * This is additive identity, not a re-stamp: the caller must have already
 * agreed the business NAME, the empty phone is the only drifted field, and a
 * stamp that already carries a phone is never touched (a different number is
 * still a disagreement, exactly as before). A foreign packet cannot use this
 * door — it still has to match the stamped business name, and once widened
 * the phone is pinned against every later build.
 */
function widenClientStampPhone({ root, slug, phoneDigits, prior }) {
  if (!prior || prior.slug !== slug) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp_widen", reason: `no readable stamp to widen for "${slug}"` }], sources: [], checks: [] });
  }
  if (prior.phoneDigits) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp_widen", reason: `stamp for "${slug}" already carries phone ${prior.phoneDigits}; widening is only for stamps written before the fact was known` }], sources: [], checks: [] });
  }
  if (!normalizePhone(phoneDigits) || normalizePhone(phoneDigits).length !== 10) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp_widen", reason: `refusing to widen the stamp for "${slug}" with a phone that does not reduce to 10 NANP digits` }], sources: [], checks: [] });
  }
  const now = new Date().toISOString();
  const updated = { ...prior, phoneDigits: normalizePhone(phoneDigits), updatedAt: now, phoneWidenedAt: now };
  fs.writeFileSync(stampPath(slug, root), JSON.stringify(updated, null, 2));
  return updated;
}

/** Every OTHER registered client is, by definition, a foreign business here. */
function listClients(root) {
  const dir = clientsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => { try { return readStamp(e.name, root); } catch { return null; } })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------
function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === "") return true;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

function normalizeSourceInput(truthSource) {
  if (!truthSource) return [];
  const list = Array.isArray(truthSource) ? truthSource : [truthSource];
  return list.map((s) => (typeof s === "string" ? { path: s } : s)).filter(Boolean);
}

/**
 * Verify one source file against a stamp. Returns a per-source report; never
 * throws for a data defect (that is the caller's job) but always fails closed.
 */
function verifySource(source, stamp, { siblings = [], donorRegistry = [] } = {}) {
  const rep = { path: source.path ? path.resolve(source.path) : "<inline>", checks: [], identifiers: [], foreign: [], geometryRegionsExcluded: 0 };
  const fail = (check, reason) => { rep.checks.push({ check, ok: false, reason }); };
  const pass = (check, detail) => { rep.checks.push({ check, ok: true, ...(detail ? { detail } : {}) }); };

  // --- the source must exist and be readable -------------------------------
  let raw = source.text;
  if (raw == null) {
    if (!source.path) { fail("source_present", "no path and no inline text supplied"); return rep; }
    if (!fs.existsSync(rep.path)) { fail("source_present", `source does not exist: ${rep.path}`); return rep; }
    const st = fs.statSync(rep.path);
    if (!st.isFile()) { fail("source_present", `source is not a file: ${rep.path}`); return rep; }
    raw = fs.readFileSync(rep.path, "utf8");
  }
  if (!raw.trim()) { fail("source_present", `source is empty: ${rep.path}`); return rep; }
  pass("source_present", `${raw.length} bytes`);

  // --- namespace: the source must live in a REGISTERED root ---------------
  if (source.path) {
    const roots = stamp.allowedSourceRoots && stamp.allowedSourceRoots.length ? stamp.allowedSourceRoots : [stamp.dataDir];
    const inRegistered = roots.some((r) => isUnder(r, rep.path));
    if (inRegistered) pass("source_root");
    else fail("source_root", `source lives outside every registered root for "${stamp.slug}" (reused/shared scratchpad dirs are the root incident). Source: ${rep.path}; registered: ${roots.join(", ")}`);

    // a source sitting inside ANOTHER client's namespace is never ours
    const segs = rep.path.split(/[\\/]/);
    const i = segs.lastIndexOf(CLIENTS_DIRNAME);
    const otherSlug = i >= 0 && segs[i + 1] ? segs[i + 1] : null;
    if (otherSlug && otherSlug !== stamp.slug) fail("foreign_namespace", `source is inside another client's namespace: clients/${otherSlug}`);
    else pass("foreign_namespace");
  }

  // --- geometry-safe text, then numeric identity ---------------------------
  const { text: safe, excluded } = geometrySafeText(raw);
  rep.geometryRegionsExcluded = excluded;

  const domainCounts = countDomains(safe);
  const clientDomainCount = countDomainFamily(domainCounts, stamp.domain);
  const phones = extractPhones(safe);
  const phoneCounts = new Map();
  for (const p of phones) phoneCounts.set(p.digits, (phoneCounts.get(p.digits) || 0) + 1);
  const clientPhoneCount = phoneCounts.get(stamp.phoneDigits) || 0;

  const nameRe = new RegExp(`(?<![A-Za-z0-9])${stamp.businessName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s\\u00a0]+")}(?![A-Za-z0-9])`, "gi");
  const clientNameCount = (safe.match(nameRe) || []).length;
  let clientPostalCount = 0;
  if (stamp.postal) {
    POSTAL_SHAPE.lastIndex = 0;
    let m;
    while ((m = POSTAL_SHAPE.exec(safe))) if (m[0] === stamp.postal) clientPostalCount++;
  }

  if (clientDomainCount) rep.identifiers.push({ field: "domain", value: stamp.domain, matchType: "domain-token", count: clientDomainCount });
  if (clientPhoneCount) rep.identifiers.push({ field: "phone", value: stamp.phoneDigits, matchType: "phone-shaped-token", count: clientPhoneCount });
  if (clientNameCount) rep.identifiers.push({ field: "businessName", value: stamp.businessName, matchType: "word-boundary", count: clientNameCount });
  if (clientPostalCount) rep.identifiers.push({ field: "postal", value: stamp.postal, matchType: "postal-shaped-token", count: clientPostalCount });

  // 4. zero client identifiers is a FAIL, never a warning
  if (rep.identifiers.length) pass("client_identifiers_present", rep.identifiers.map((i) => `${i.field}x${i.count}`).join(" "));
  else fail("client_identifiers_present", `ZERO ${stamp.slug} identifiers in a source claimed for ${stamp.businessName} (looked for domain ${stamp.domain}, phone ${stamp.phoneDigits}, name "${stamp.businessName}"${stamp.postal ? `, postal ${stamp.postal}` : ""})`);

  // 2. domain AND phone must both be present
  if (clientDomainCount) pass("client_domain", `${stamp.domain} x${clientDomainCount}`);
  else fail("client_domain", `stamped domain ${stamp.domain} does not appear in the source`);
  // A client stamped with NO phone (phone is optional since 2026-08-01) has no
  // phone to look for; demanding one would fail every phone-less client's
  // source. The domain + name checks above still carry the identity, and the
  // foreign-phone detection below still runs — a stranger's number in the
  // source is caught whether or not the client has one of their own.
  if (!stamp.phoneDigits) pass("client_phone", "not applicable — client publishes no phone");
  else if (clientPhoneCount) pass("client_phone", `${stamp.phoneDigits} x${clientPhoneCount}`);
  else fail("client_phone", `stamped phone ${stamp.phoneDigits} does not appear in the source as a phone-shaped token`);

  // --- 3. foreign business detection --------------------------------------
  const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  const declared = parsed && typeof parsed === "object" ? declaredIdentity(parsed) : { names: [], domains: [], phones: [] };

  for (const d of declared.names) {
    if (sameBusinessName(d.value, stamp.businessName)) continue;
    rep.foreign.push({ kind: "declared_name", business: d.value, at: d.path, evidence: `declared business name "${d.value}" at ${d.path} is not ${stamp.businessName}` });
  }
  for (const d of declared.domains) {
    const nd = normalizeDomain(d.value);
    if (!nd || isInfra(nd) || nd === stamp.domain || nd.endsWith("." + stamp.domain)) continue;
    rep.foreign.push({ kind: "declared_domain", business: nd, at: d.path, evidence: `declared domain ${nd} at ${d.path} is not ${stamp.domain}` });
  }
  for (const d of declared.phones) {
    const digits = normalizePhone(d.value);
    if (!digits || digits === stamp.phoneDigits) continue;
    rep.foreign.push({ kind: "declared_phone", business: d.value, at: d.path, evidence: `declared phone ${d.value} at ${d.path} is not ${stamp.phoneDigits}` });
  }

  // Dominance: a foreign marker that OUT-COUNTS the client's own marker means
  // this document is about someone else. Strictly greater, so a one-line
  // isolation note naming a donor never fails a genuine client source.
  for (const [d, c] of [...domainCounts].sort((a, b) => b[1] - a[1])) {
    if (d === stamp.domain || d.endsWith("." + stamp.domain)) continue;
    if (c > clientDomainCount) rep.foreign.push({ kind: "dominating_domain", business: d, evidence: `domain ${d} appears ${c}x vs the client's ${stamp.domain} ${clientDomainCount}x` });
  }
  for (const [digits, c] of [...phoneCounts].sort((a, b) => b[1] - a[1])) {
    if (digits === stamp.phoneDigits) continue;
    if (c > clientPhoneCount) {
      const sample = phones.find((p) => p.digits === digits);
      rep.foreign.push({ kind: "dominating_phone", business: sample ? sample.raw : digits, evidence: `phone ${sample ? sample.raw : digits} appears ${c}x vs the client's ${stamp.phoneDigits} ${clientPhoneCount}x` });
    }
  }

  // Sibling clients and known donors are named foreign businesses.
  for (const other of [...siblings, ...donorRegistry]) {
    if (!other || other.slug === stamp.slug) continue;
    const oDomain = normalizeDomain(other.domain);
    const oPhone = normalizePhone(other.phone || other.phoneDigits);
    const oName = other.businessName || other.name || "";
    const hits = [];
    if (oDomain && countDomainFamily(domainCounts, oDomain) > clientDomainCount) hits.push(`domain ${oDomain} x${countDomainFamily(domainCounts, oDomain)}`);
    if (oPhone && (phoneCounts.get(oPhone) || 0) > clientPhoneCount) hits.push(`phone ${oPhone} x${phoneCounts.get(oPhone)}`);
    if (oName && !sameBusinessName(oName, stamp.businessName)) {
      const re = new RegExp(`(?<![A-Za-z0-9])${oName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s\\u00a0]+")}(?![A-Za-z0-9])`, "gi");
      const n = (safe.match(re) || []).length;
      if (n > clientNameCount) hits.push(`name "${oName}" x${n}`);
    }
    if (hits.length) rep.foreign.push({ kind: other.slug ? "registered_other_client" : "known_donor", business: oName || oDomain || oPhone, slug: other.slug, evidence: `${oName || oDomain} out-marks the client here: ${hits.join(", ")}` });
  }

  if (rep.foreign.length) {
    const named = [...new Set(rep.foreign.map((f) => f.business))].join(" | ");
    fail("no_foreign_business", `FOREIGN BUSINESS IN A "${stamp.slug}" SOURCE: ${named}\n      ` + rep.foreign.map((f) => `${f.kind}: ${f.evidence}`).join("\n      "));
  } else pass("no_foreign_business");

  return rep;
}

/**
 * Slug/name coherence. The slug is human-authored and carries the INTENDED
 * client, so a business name that shares nothing with its slug is the incident
 * signature ("wss-test-ramon-roofing-fort-worth" vs "Music City Roofers").
 */
function slugCoherence(slug, businessName, city) {
  // Possessive-aware coherence (staged module, adversarially reviewed, then
  // teacher-hardened): "Sal's Heating & Cooling" matched NOTHING in
  // "sal-s-heating-and-cooling" under the old tokenizer and a real client was
  // refused for its own name. Trade words ("concrete") name the category, not
  // the business — never identity alone. Safety intent untouched: a slug for a
  // genuinely different business still fails closed, and any internal error
  // fails closed too.
  try {
    const { slugCoherent } = require("./slug-possessive");
    const r = slugCoherent({ slug, businessName, city });
    if (r.ok) return { ok: true, detail: `slug carries token(s): ${(r.sharedTokens || []).join(", ")}` };
    return {
      ok: false,
      reason: `slug "${slug}" shares no identifying token with business name "${businessName}"${city ? ` or city "${city}"` : ""} — the slug and the data describe different businesses`,
    };
  } catch {
    return { ok: false, reason: `coherence check errored for "${slug}" — failing closed` };
  }
}

/**
 * Verify client isolation. Returns a structured result; does not throw for a
 * data defect. Fails closed on every missing input.
 */
function verifyClientIsolation({ slug, truthSource, root, donorRegistry = [], stamp: stampOverride } = {}) {
  const failures = [];
  const result = { slug, root: path.resolve(root || defaultClientRoot()), sources: [], failures, checks: [], ok: false };

  if (!slug) { failures.push({ check: "slug", reason: "no slug supplied" }); return result; }

  let stamp = stampOverride || null;
  if (!stamp) {
    try { stamp = readStamp(slug, root); } catch (e) { failures.push({ check: "stamp", reason: `unreadable stamp for "${slug}": ${e.message}` }); return result; }
  }
  if (!stamp) {
    failures.push({ check: "stamp", reason: `no client stamp at ${stampPath(slug, root)} — a build cannot start for an unstamped client (fail closed; run: client-isolation-check.cjs init --slug ${slug} …)` });
    return result;
  }
  result.stamp = { slug: stamp.slug, businessName: stamp.businessName, domain: stamp.domain, phoneDigits: stamp.phoneDigits, createdAt: stamp.createdAt };

  if (stamp.slug !== slug) failures.push({ check: "stamp", reason: `stamp in clients/${slug}/ declares slug "${stamp.slug}"` });

  const coh = slugCoherence(slug, stamp.businessName, stamp.city);
  result.checks.push({ check: "slug_coherence", ok: coh.ok, ...(coh.ok ? { detail: coh.detail } : { reason: coh.reason }) });
  if (!coh.ok) failures.push({ check: "slug_coherence", reason: coh.reason });

  const sources = normalizeSourceInput(truthSource);
  if (!sources.length) {
    failures.push({ check: "truth_source", reason: `no truth source supplied for "${slug}" — a build with no verified source is never a pass` });
    return result;
  }

  const siblings = listClients(root).filter((c) => c.slug !== slug);
  for (const s of sources) {
    const rep = verifySource(s, stamp, { siblings, donorRegistry });
    result.sources.push(rep);
    for (const c of rep.checks) if (!c.ok) failures.push({ check: c.check, source: rep.path, reason: c.reason });
  }

  result.ok = failures.length === 0;
  return result;
}

/**
 * BUILD-START PRECONDITION. Throws ClientIsolationError unless every claimed
 * truth source provably belongs to this client. Call before any mutable
 * operation; there is no flag that turns it off.
 */
function assertClientIsolation(options) {
  const result = verifyClientIsolation(options);
  if (!result.ok) throw new ClientIsolationError(result);
  return result;
}

/**
 * The engine seam. Derives the client's declared identity from the incoming
 * request itself, so it needs no new request field and cannot be bypassed:
 *   · first build for a slug stamps the namespace from the request (and is
 *     still checked for slug/name coherence, which is what catches a packet
 *     labelled with the wrong client);
 *   · every later build for that slug must AGREE with the stamp on phone and,
 *     when both carry one, on domain.
 * Any supplied truthSource files go through the full source verification.
 */
function guardBuildStart({ slug, facts = {}, truthSource, root, donorRegistry = [] } = {}) {
  const businessName = facts.business_name || facts.businessName || facts.name || "";
  const phone = facts.phone || "";
  const domain = normalizeDomain(facts.website || facts.domain || "");
  const failures = [];

  const coh = slugCoherence(slug, businessName, facts.city);

  // The stamp is read FIRST: a stamp on disk is stronger evidence of whose slug
  // this is than the slug's own wording, and "already bound to another
  // business" is a different (and more precise) answer than "the slug reads
  // oddly". Both are reported when both are true.
  let stamp = null;
  try { stamp = readStamp(slug, root); } catch (e) {
    throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "stamp", reason: e.message }], sources: [], checks: [] });
  }

  if (!stamp) {
    if (!coh.ok) throw new ClientIsolationError({ slug, ok: false, failures: [{ check: "slug_coherence", reason: coh.reason }], sources: [], checks: [] });
    // First build for this slug: stamp it. Domain is optional in a request, so
    // fall back to the deterministic mirror host — the stamp still pins phone
    // and name, which is what a foreign packet cannot fake.
    stamp = ensureClientNamespace({
      root, slug, businessName, phone,
      domain: domain || `${slug}.wss-ai.com`,
      postal: facts.postal_code || facts.postal || "",
      city: facts.city || "", state: facts.state || "",
    });
    stamp.firstBuild = true;
  } else {
    // `field` is machine-readable on purpose: the engine maps a business-name
    // disagreement onto its existing 409 slug_conflict contract, so Gate 4C
    // makes that check DURABLE (a stamp on disk) instead of in-memory only,
    // without changing the error a caller already handles.
    // A stamp with NO phone that meets a request which carries one is the
    // stamp-predates-the-fact case (phone has been optional since
    // 2026-08-01), not a foreign packet: widen the stamp additively when the
    // business name agrees, and hold the widened phone from now on. Every
    // other phone disagreement still fails exactly as before.
    if (!stamp.phoneDigits && normalizePhone(phone) && sameBusinessName(businessName, stamp.businessName)) {
      stamp = widenClientStampPhone({ root, slug, phoneDigits: normalizePhone(phone), prior: stamp });
      stamp.widenedPhone = true;
    }
    if (normalizePhone(phone) !== stamp.phoneDigits) {
      const stampPhone = stamp.phoneDigits || "no phone";
      failures.push({ check: "stamp_agreement", field: "phone", boundTo: stamp.phoneDigits, reason: `request phone ${phone || "(none)"} (${normalizePhone(phone) || "0 digits"}) disagrees with the stamp for "${slug}" (${stampPhone}, ${stamp.businessName})` });
    }
    if (domain && stamp.domain && !isInfra(stamp.domain) && domain !== stamp.domain && !domain.endsWith("." + stamp.domain)) {
      failures.push({ check: "stamp_agreement", field: "domain", boundTo: stamp.domain, reason: `request domain ${domain} disagrees with the stamp for "${slug}" (${stamp.domain})` });
    }
    if (!sameBusinessName(businessName, stamp.businessName)) {
      failures.push({ check: "stamp_agreement", field: "businessName", boundTo: stamp.businessName, reason: `request business name "${businessName}" is a DIFFERENT BUSINESS from the stamped "${stamp.businessName}" for slug "${slug}"` });
    }
    if (failures.length) throw new ClientIsolationError({ slug, ok: false, failures, sources: [], checks: [] });
  }

  if (truthSource) return assertClientIsolation({ slug, truthSource, root, donorRegistry, stamp });
  return {
    ok: true, slug,
    stamp: { slug: stamp.slug, businessName: stamp.businessName, domain: stamp.domain, phoneDigits: stamp.phoneDigits },
    sources: [], failures: [],
    // An operator-registered stamp is authoritative, so an odd-reading slug is
    // reported and not blocked once the identity itself agrees.
    checks: [
      { check: "stamp_agreement", ok: true },
      ...(stamp.widenedPhone ? [{ check: "stamp_widened_phone", ok: true, detail: `stamp carried no phone; pinned ${stamp.phoneDigits} from this request` }] : []),
      { check: "slug_coherence", ok: coh.ok, ...(coh.ok ? { detail: coh.detail } : { reason: coh.reason, blocking: false }) },
    ],
  };
}

module.exports = {
  // preconditions
  assertClientIsolation,
  verifyClientIsolation,
  guardBuildStart,
  ClientIsolationError,
  // namespaces
  ensureClientNamespace,
  widenClientStampPhone,
  readStamp,
  listClients,
  clientDir,
  clientsDir,
  stampPath,
  defaultClientRoot,
  // matchers, exported so gates and tests use the SAME code path
  geometrySafeText,
  extractPhones,
  countDomains,
  normalizeDomain,
  normalizePhone,
  sameBusinessName,
  significantTokens,
  slugCoherence,
  declaredIdentity,
  STAMP_FILE,
  STAMP_SCHEMA,
  SVG_GEOMETRY_ATTRS,
};
