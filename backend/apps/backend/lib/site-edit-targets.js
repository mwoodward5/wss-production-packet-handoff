"use strict";
// lib/site-edit-targets.js — resolves a caller-supplied siteSlug (from the
// voice site-edit tools) to a REAL, ghost-owned Vercel deploy target
// ({ projectName, aliasHost }), replacing the single hardcoded pilot entry
// that used to live inline in api/vapi-tools/site-edit.js and
// api/admin/run-edit-job.js.
//
// Why this is data-driven and not a bigger allowlist literal: ghost only
// controls the Vercel deploy (can redeploy it with VERCEL_TOKEN /
// VERCEL_TEAM_ID via lib/forge.js vercelDeploy) for sites built through the
// in-repo donor-forge pipeline (api/admin/forge-jobs.js -> lib/forge.js
// `deploy` stage). That pipeline stamps the project name and requested
// alias onto the prospect row at record.forge_job.input.project_name /
// .preview_host, and the alias the deploy stage actually confirmed live at
// record.forge_job.deploy.alias.
//
// Prospects built through the default, external SiteForge pipeline
// (record.build_dispatch / record.siteforge_callback, populated by
// lib/siteforge.js + api/webhooks/siteforge.js) do NOT have a ghost-owned
// deploy target: their preview_url is a path inside SiteForge's own
// multi-tenant Vercel app (e.g. https://siteforge-app-seven.vercel.app/try/
// <slug>/), which this repo's Vercel credentials cannot redeploy. Those
// prospects are correctly excluded here.
//
// FALLBACK_SITES keeps the one proven, hand-provisioned pilot (AB
// Detailing) working exactly as before, with zero DB dependency.
//
// =====================================================================
// T15 (voice-site-edit-loop) — SiteForge redeploy target — STATUS + SPEC
// =====================================================================
// As of this comment, SiteForge (wss-intake-compiler-siteforge repo,
// app/lib/engine-adapter.mjs runDurableTryStage + app/lib/
// ghost-source-archive.mjs) best-effort-mirrors every ghost-dispatched
// build's file tree into this same wss-site-sources/<prospect_id>/ bucket,
// once an operator wires GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_URL/_KEY into
// SiteForge's Vercel env. That closes HALF the gap: the archive
// lib/site-editor.js needs to exist. It does NOT close the other half —
// this function still returns null for every SiteForge-built prospect,
// so a voice caller is rejected at api/vapi-tools/site-edit.js before
// runSiteEdit() ever looks at the archive. That is intentional: ghost has
// no Vercel project to redeploy those edits to. Do NOT wire the archive's
// mere existence into an automatic "yes, editable" answer here — the
// archive being present only means editing is POSSIBLE, not that there is
// anywhere safe to publish the result yet.
//
// THE FIX (not implemented — do not half-build this): "promote on first
// voice edit" — the first time a caller asks to edit a SiteForge-built
// prospect's site, ghost provisions a NEW ghost-owned Vercel project from
// the archived source and repoints the prospect at it, so every edit after
// that is a normal, already-proven targetFromForgeJob() redeploy.
//
//   1. Detect eligibility: record.build_dispatch/record.siteforge_callback
//      present AND targetFromForgeJob(record) is null (no ghost deploy
//      exists yet) AND record.voice_edit_promotion is not already set
//      (idempotency — see #5).
//   2. Confirm the archive actually landed: list
//      wss-site-sources/<prospect_id>/ (reuse the same listAll()/download()
//      helpers lib/site-editor.js already has — do not duplicate the
//      Supabase Storage client). Empty listing = SiteForge hasn't archived
//      this prospect yet (build predates this change, or the cross-repo
//      Supabase env vars are still unset on SiteForge's Vercel project) —
//      fail closed with a caller-facing "not ready yet" message, never a
//      bare 500.
//   3. Download every archived file into memory and call the EXISTING
//      lib/forge.js vercelDeploy({ files, projectName, aliasHost }) — the
//      same function the donor-forge `deploy` stage already uses, so this
//      reuses a proven code path instead of a new one. projectName must be
//      a fresh, Vercel-safe slug derived from prospect_id (lowercase,
//      alphanumeric + hyphens only, <= 100 chars — prospect_id is not
//      guaranteed Vercel-safe as-is, e.g. a raw Google place_id-derived
//      id); pick an aliasHost following the FALLBACK_SITES convention
//      (`<slug>.wss-ai.com`) and confirm it doesn't collide with an
//      existing donor-forge project.
//   4. On success, persist BOTH:
//        record.voice_edit_promotion = { projectName, aliasHost,
//          promotedAt, promotedFrom: "siteforge" }
//        AND the row's canonical preview_url / record.preview_url updated
//        to the new https://<aliasHost>/ — this is the exact field
//        lib/build-on-click.js prospectPreviewUrl() and
//        lib/reveal-links.js buildRevealLink() both read. Under the
//        current build-on-click (lazy) architecture, a reveal link's
//        signed payload only embeds a preview_url if one already existed
//        at SEND time (api/reveal.js line ~91); for a prospect whose site
//        was built lazily on first click, api/reveal.js re-resolves
//        prospectPreviewUrl(prospect) from the LIVE row on every request
//        (api/reveal.js line ~104), so promoting here correctly repoints
//        any reveal link that has not yet been opened. It can NEVER
//        repoint a reveal link that already had a preview_url frozen into
//        its signed payload at send time (all such links are permanently
//        bound to the old SiteForge /try/<token>/ page) — fixing that
//        requires minting and resending a new reveal link, an outreach/
//        consent decision outside this function's scope.
//   5. Add a targetFromPromotion(record) resolver (mirrors
//      targetFromForgeJob above) checked in resolveSiteEditTarget() so a
//      SECOND edit on an already-promoted prospect just returns the
//      promoted { projectName, aliasHost } directly, without re-promoting.
//      This also doubles as the idempotency guard for #1 — a promotion
//      must be a single conditional DB write (upsert with a uniqueness
//      check on record.voice_edit_promotion, or a stage-machine lock like
//      api/admin/forge-jobs.js uses) so two concurrent voice-edit requests
//      for the same never-promoted prospect cannot each provision their
//      own Vercel project and alias fight over the same host.
//
// RISKS that make this unsafe to auto-trigger mid-voice-call without more
// design work (why this stays a spec, not code):
//   - Cost + irreversibility: provisioning a Vercel project and registering
//     a subdomain is a real, standing resource, triggered by an
//     unauthenticated-feeling voice request; needs a rate limit and
//     probably owner visibility before or immediately after, not silent.
//   - The original SiteForge /try/<token>/ page keeps serving forever —
//     ghost cannot delete it or redirect it (no control over SiteForge's
//     routing). Anyone still holding that link sees a permanently stale,
//     non-editable snapshot with no indication a newer version exists.
//   - Divergence: the instant the promoted copy is edited, it and the
//     original SiteForge build are different pages. Anything keyed to the
//     old preview_url (internal reporting, admin console links already
//     rendered in an open browser tab, etc.) silently goes stale.
//   - Concurrency (see #5) — two simultaneous first-edit requests must not
//     race to promote the same prospect twice.
// =====================================================================

const { select, conditionalUpdate } = require("./store");
const { listAll, download } = require("./site-editor");
const { vercelDeploy } = require("./forge");
const { clientReferenceCode, referenceBody, referenceMatches } = require("./client-reference");

const FALLBACK_SITES = Object.freeze({
  "ab-professional-detailing": Object.freeze({
    projectName: "ab-professional-detailing",
    aliasHost: "ab-professional-detailing.wss-ai.com",
  }),
});

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function stripProtocol(host) {
  return String(host || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

// A prospect only counts as a real, ghost-owned deploy target if the
// donor-forge pipeline actually ran a deploy stage for it and recorded a
// Vercel project name. The preview_host/alias is optional (some jobs may not
// have a live alias yet), but the project name is required — it is what
// lib/forge.js vercelDeploy() needs to push a redeploy.
function targetFromForgeJob(record = {}) {
  const job = record && typeof record === "object" ? record.forge_job : null;
  if (!job || typeof job !== "object") return null;
  const input = job.input && typeof job.input === "object" ? job.input : {};
  const deploy = job.deploy && typeof job.deploy === "object" ? job.deploy : {};
  const projectName = String(input.project_name || "").trim();
  if (!projectName) return null;
  const aliasHost = stripProtocol(deploy.alias) || String(input.preview_host || "").trim();
  return aliasHost ? { projectName, aliasHost } : { projectName };
}

/**
 * Resolve a caller-supplied siteSlug to a verified { projectName, aliasHost }
 * deploy target. Returns null when the slug is unknown, unauthorized, or the
 * lookup fails for any reason — callers MUST treat null as "reject the
 * edit", never fall back to a guessed/default target.
 */
async function resolveSiteEditTarget(siteSlug) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return null;
  if (FALLBACK_SITES[slug]) return FALLBACK_SITES[slug];

  // Mirror Engine sites (wss-test-*) are ghost-owned by construction: the
  // engine created the Vercel project named exactly <slug>, aliased it to
  // <slug>.wss-ai.com, and archived the deployed tree to
  // wss-site-sources/<slug>/ (engine.js `editable` check). So the slug IS the
  // deploy target — but only when the archive actually landed; without it
  // runSiteEdit() has nothing to edit, so fail closed exactly like every
  // other path here.
  if (/^wss-test-[a-z0-9-]+$/.test(slug)) {
    try {
      const archived = await listAll(slug);
      if (archived.length) return { projectName: slug, aliasHost: `${slug}.wss-ai.com` };
      console.warn(`site-edit: mirror '${slug}' has no archived source; rejecting edit`);
      return null;
    } catch (error) {
      console.warn(`site-edit: archive check failed for '${slug}': ${error.message}`);
      return null;
    }
  }

  try {
    const found = await select("ghost_agency_prospects", `prospect_id=eq.${encodeURIComponent(slug)}&limit=1`);
    if (!found || found.ok !== true || !Array.isArray(found.data) || !found.data[0]) return null;
    const row = found.data[0];
    const record = row.record && typeof row.record === "object" ? row.record : {};

    // Check if already promoted
    const promotedTarget = targetFromPromotion(record);
    if (promotedTarget) return promotedTarget;

    const forgeJobTarget = targetFromForgeJob(record);
    if (forgeJobTarget) return forgeJobTarget;

    // Detect eligibility for promotion (SiteForge-built, not yet promoted)
    const isSiteForgeBuilt = (record.build_dispatch || record.siteforge_callback) && !forgeJobTarget;
    const isNotPromoted = !record.voice_edit_promotion;

    if (isSiteForgeBuilt && isNotPromoted) {
      // PROMOTION LOGIC (Step 2-4 from spec)
      const prospectId = row.prospect_id;

      // 2. Confirm archive
      const archivedFiles = await listAll(prospectId);
      if (!archivedFiles.length) {
        console.warn(`Promotion skipped: no archived source for site '${prospectId}'`);
        return null; // Fail closed with "not ready yet"
      }

      // 3. Download, provision Vercel project, and deploy
      const files = {};
      for (const rel of archivedFiles) {
        files[rel] = await download(prospectId, rel);
      }

      // Generate Vercel-safe project name and alias host
      const newProjectName = `ghost-${slug.replace(/[^a-z0-9-]/g, '-').slice(0, 90)}`;
      const newAliasHost = `${newProjectName}.wss-ai.com`;

      const deployed = await vercelDeploy({ files, projectName: newProjectName, aliasHost: newAliasHost });

      // 4. Persist promotion details and update preview_url — ONLY when the
      // alias actually bound. vercelDeploy returns { url, alias: null,
      // aliasError } on alias failure with url still truthy; persisting then
      // would freeze preview_url at a host that 404s forever.
      if (deployed.url && deployed.alias) {
        const updatedRecord = {
          ...record,
          voice_edit_promotion: {
            projectName: newProjectName,
            aliasHost: newAliasHost,
            promotedAt: new Date().toISOString(),
            promotedFrom: "siteforge",
          },
        };
        const newPreviewUrl = `https://${newAliasHost}/`;

        const persisted = await conditionalUpdate(
          "ghost_agency_prospects",
          "id",
          row.id,
          // RACE GUARD (spec #5): atomically re-check at write time that no
          // other first-edit request has already promoted this prospect. The
          // loser's PATCH matches 0 rows -> updated:false -> we fail closed
          // and the loser falls back to a normal next-edit retry, which will
          // resolve targetFromPromotion on re-read.
          { "record->>voice_edit_promotion": "is.null" },
          {
            record: updatedRecord,
            preview_url: newPreviewUrl,
          }
        );
        if (!persisted || persisted.ok !== true) {
          console.error(`Promotion DB persist failed for ${prospectId} — not treating as promoted`);
          return null;
        }
        if (persisted.updated !== true) {
          console.warn(`Promotion race lost for ${prospectId} — another request promoted first`);
          return null;
        }

        return { projectName: newProjectName, aliasHost: newAliasHost };
      } else {
        console.error(`Vercel deployment/alias failed during promotion for ${prospectId}: ${deployed.aliasError || (deployed.url ? 'alias not bound' : 'unknown error')}`);
        return null; // Promotion failed
      }
    }

    return null; // No existing target, and not eligible for promotion
  } catch (e) {
    console.error(`resolveSiteEditTarget failed for ${siteSlug}: ${e.message}`);
    // Fail closed: a broken lookup is never treated as an authorized site.
    return null;
  }
}


function targetFromPromotion(record = {}) {
  const promo = record && typeof record === "object" ? record.voice_edit_promotion : null;
  if (!promo || typeof promo !== "object") return null;
  const projectName = String(promo.projectName || "").trim();
  const aliasHost = String(promo.aliasHost || "").trim();
  return projectName && aliasHost ? { projectName, aliasHost } : null;
}

// =====================================================================
// CALLER RESOLUTION + COLLISION GUARD
// =====================================================================
// resolveSiteEditTarget() above answers "is THIS SLUG editable?". It cannot
// answer "who is calling me?" — it takes a slug, and a phone caller does not
// know their slug. Riley knows a Client-ID ("WSS-F15219"), a caller-ID phone
// number, or a spoken business name. resolveCaller() is the missing half.
//
// THE RULE THIS FILE NOW ENFORCES: an edit is dispatched ONLY against an
// identity that matched exactly ONE business. If two or more businesses match
// the caller's input, this returns status "ambiguous" with the candidate list
// and a read-back script — it NEVER picks. Editing the wrong client's live
// site is the worst failure this system can produce, and it is unrecoverable
// from the caller's point of view (they hear "done" while a stranger's site
// changes). Ambiguity is therefore a hard stop, not a ranked guess.
//
// Measured on production data (2026-07-31, 1000-row slice): 116 business-name
// prefixes are shared by 2+ distinct businesses; "California Landscape" and
// "United Roofing" each tie 4 ways under the old ranker. Both previously
// resolved silently to whichever row sorted first.

// The derived Client-ID (WSS-xxxxxx) is a sha256 of the prospect id and is
// persisted in NO column, so resolving one requires recomputing it over rows.
// A single bounded page silently loses every client past the cap: measured
// 2026-07-31 the table held 1103 rows against a 1000-row window, so the 103
// oldest clients could never be resolved by the Client-ID printed on their own
// email. Page instead, with a hard ceiling so a runaway table can still never
// turn one phone call into an unbounded scan.
const CALLER_SCAN_PAGE = 1000;
const CALLER_SCAN_MAX_ROWS = 10000;

/** Last 10 digits of anything phone-shaped. Format-agnostic by construction. */
function phoneDigits10(value) {
  return String(value == null ? "" : value).replace(/\D/g, "").slice(-10);
}

const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Derive the deploy slug from a prospect row. The slug is the Vercel project
 * name, which is NOT the prospect_id — it lives in the preview_url host, in
 * the forge job, or in a promotion record. Deriving it in code is the point:
 * previously nothing returned a slug at all, so the voice model would have had
 * to invent one from a URL it was shown.
 */
function siteSlugFromRow(row = {}) {
  const record = row && typeof row.record === "object" && row.record ? row.record : {};
  const promo = targetFromPromotion(record);
  if (promo) return promo.projectName;
  const forge = targetFromForgeJob(record);
  if (forge) return forge.projectName;
  const previewUrl = String(row.preview_url || record.preview_url || "").trim();
  return siteSlugFromPreviewUrl(previewUrl);
}

/** "https://wss-test-flint-plumbing-s5.wss-ai.com/" -> "wss-test-flint-plumbing-s5" */
function siteSlugFromPreviewUrl(previewUrl) {
  const host = stripProtocol(previewUrl).split("/")[0];
  if (!host) return "";
  const m = host.match(/^([a-z0-9-]+)\.wss-ai\.com$/i);
  return m ? m[1].toLowerCase() : "";
}

function callerFacts(row = {}) {
  const record = row && typeof row.record === "object" && row.record ? row.record : {};
  return {
    prospect_id: row.prospect_id || null,
    business_name: row.business_name || null,
    client_id: row.reference || record.reference || clientReferenceCode(row) || null,
    city: row.city || null,
    state: row.state || null,
    phone: row.phone || null,
    preview_url: row.preview_url || record.preview_url || null,
    site_slug: siteSlugFromRow(row) || null,
  };
}

/** Two rows are the "same business" only if they are the same DB row. */
/**
 * Collapse rows that are the SAME BUSINESS, not colliding clients.
 *
 * The refusal to choose between two matches protects a real case: "United
 * Roofing" ties four different companies in four states, and picking one would
 * take a caller to a stranger's site. It does NOT protect against the same
 * business appearing twice — which is exactly what the harvester produces
 * (RiverCity Plumbing arrived as two rows with two place_ids, one phone). That
 * left Riley unable to resolve a caller by phone OR by name; only the Client ID
 * worked.
 *
 * Two rows are one client when the normalized name AND the ten-digit phone
 * agree. Different businesses sharing a name have different phones, so the
 * ambiguity protection is untouched. The survivor is the row a human would
 * want: one with a built preview first, then the most recently updated.
 */
function collapseSameBusiness(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    const phone = phoneDigits10(r.phone);
    const name = normName(r.business_name || "");
    // No phone or no name means we cannot PROVE they are the same business.
    const key = phone && name ? `${name}|${phone}` : `row:${r.prospect_id || r.id || Math.random()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const best = (a, b) => {
    const aPrev = Boolean(a.preview_url || (a.record && a.record.preview_url));
    const bPrev = Boolean(b.preview_url || (b.record && b.record.preview_url));
    if (aPrev !== bPrev) return aPrev ? a : b;
    return Date.parse(b.updated_at || 0) > Date.parse(a.updated_at || 0) ? b : a;
  };
  return [...groups.values()].map((group) => group.reduce(best));
}

function distinctRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = String(r.prospect_id || r.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Walk the whole prospect table in pages, newest first, collecting EVERY row
 * `match` accepts.
 *
 * This deliberately does NOT stop at the first hit. The question being asked is
 * never "find a client" — it is "does exactly ONE client match?", and you
 * cannot answer that by stopping early. An early return would reintroduce the
 * exact silent-pick bug this module exists to prevent, just at a different
 * layer. maxRows is a runaway guard, not an optimisation.
 */
async function scanForMatches(match, { maxRows = CALLER_SCAN_MAX_ROWS } = {}) {
  const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
  const hits = [];
  for (let offset = 0; offset < maxRows; offset += CALLER_SCAN_PAGE) {
    const q = `?select=*&order=created_at.desc&offset=${offset}&limit=${CALLER_SCAN_PAGE}`;
    let page = unwrap(await select("ghost_agency_prospects", q).catch(() => []));
    if (!page.length && offset === 0) {
      // Some deployments lack created_at ordering; fall back to an unordered page.
      page = unwrap(await select("ghost_agency_prospects", `?select=*&limit=${CALLER_SCAN_PAGE}`).catch(() => []));
    }
    if (!page.length) break;
    for (const row of page) if (match(row)) hits.push(row);
    if (page.length < CALLER_SCAN_PAGE) break; // short page = end of table
  }
  return hits;
}

/**
 * resolveCaller({ prospectId, reference, phone, businessName, email, city })
 *
 * -> { status: "ok",        matched_by, ...callerFacts }
 *    { status: "ambiguous", matched_by, candidates: [...], say }
 *    { status: "not_found", unmatched: { tried, ask_for, say }, say }
 *
 * THE ORDER IS THE STRENGTH LADDER, strongest first:
 *   1. prospect_id — a primary key, unique by construction
 *   2. Client-ID   — derived or registered, uniqueness verified not assumed
 *   3. phone       — 10 normalised digits, format-agnostic
 *   4. email       — any address stored on the row (the address a report or
 *                    a proof email went to)
 *   5. business name — fuzzy, city-aware, and the only genuinely ambiguous one
 *
 * WHEN EVERYTHING FAILS, THE CALLER IS ASKED FOR THE ONE KEY NOT YET TRIED.
 * The field log (2026-08-17) shows two callers lost to a flat "could not
 * locate account" — a dead end the model had no instruction to climb out of.
 * The unmatched result now carries `ask_for` (the strongest identifier the
 * caller has NOT given yet) and a spoken sentence asking for exactly that,
 * so "I can't find you" becomes "what's the phone number on your website?"
 *
 * CONTRACT FOR CALLERS: only status === "ok" authorizes an action on a
 * client's site. "ambiguous" means READ THE LIST BACK AND ASK — the caller
 * must disambiguate with a Client-ID before anything is dispatched.
 */
async function resolveCaller({ prospectId = "", reference = "", phone = "", businessName = "", email = "", city = "" } = {}) {
  const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
  // What the caller actually handed over. When everything fails, the ask is
  // for the strongest thing NOT in this set — never a repetition of something
  // that already missed.
  const gave = {
    prospect_id: Boolean(String(prospectId || "").trim()),
    client_id: Boolean(referenceBody(reference)),
    phone: phoneDigits10(phone).length === 10,
    email: Boolean(String(email || "").trim()),
    business_name: Boolean(String(businessName || "").trim()),
  };
  const notFound = (say, askFor = null, tried = null) => ({
    status: "not_found",
    candidates: [],
    unmatched: { tried: tried || Object.keys(gave).filter((k) => gave[k]), ask_for: askFor, say },
    say,
  });
  // THE ONE QUESTION, chosen by what is still untried. Each sentence asks for
  // exactly ONE key and says why it helps — the opposite of the dead end it
  // replaces, and never a request for anything technical.
  const askSentence = () => {
    if (!gave.client_id) {
      return { ask_for: "client_id", say: "I can't find the account from that just yet — could you read me the Client ID from your email? It starts with W S S, and it pulls you straight up." };
    }
    if (!gave.phone) {
      return { ask_for: "phone", say: "I can't find the account from that just yet — what's the phone number printed on your website? That finds you straight away." };
    }
    if (!gave.email) {
      return { ask_for: "email", say: "I can't find the account from that just yet — what's the email address your report went to? I can find you by that one too." };
    }
    if (!gave.business_name) {
      return { ask_for: "business_name", say: "I can't find the account from that just yet — which business is this, as the name reads on the website?" };
    }
    return { ask_for: null, say: "I've tried everything I have and I still can't find your account, so I'm not going to guess at it. Someone on our team will pick this up and get you sorted." };
  };

  try {
    // ---- 1. prospect_id — a primary key. Unique by construction. ----
    const pid = String(prospectId || "").trim();
    if (pid) {
      const rows = distinctRows(unwrap(await select(
        "ghost_agency_prospects", `?select=*&prospect_id=eq.${encodeURIComponent(pid)}&limit=2`).catch(() => [])));
      if (rows.length === 1) return { status: "ok", matched_by: "prospect_id", ...callerFacts(rows[0]) };
      if (rows.length > 1) return ambiguous("prospect_id", rows);
    }

    // ---- 2. Client-ID. Derived (WSS-xxxxxx) or registered (bare). ----
    // Uniqueness is NOT guaranteed by the schema — it is a truncated sha256,
    // so a collision is possible in principle. Verified absent on today's data
    // (0 collisions across 1000 rows), but checked here anyway rather than
    // assumed, because the failure mode is editing a stranger's site.
    const body = referenceBody(reference);
    if (body) {
      let rows = [];
      for (const spelling of [body, `WSS-${body}`]) {
        rows = unwrap(await select("ghost_agency_prospects", `?select=*&reference=eq.${encodeURIComponent(spelling)}&limit=5`).catch(() => []));
        if (rows.length) break;
        rows = unwrap(await select("ghost_agency_prospects", `?select=*&record->>reference=eq.${encodeURIComponent(spelling)}&limit=5`).catch(() => []));
        if (rows.length) break;
      }
      if (!rows.length) {
        // The derived code is stored nowhere, so recompute it across the table.
        rows = await scanForMatches((row) => referenceMatches(reference, clientReferenceCode(row)));
      }
      rows = distinctRows(rows);
      if (rows.length === 1) return { status: "ok", matched_by: "client_id", ...callerFacts(rows[0]) };
      if (rows.length > 1) return ambiguous("client_id", rows);
    }

    // ---- 3. Phone. Format-agnostic: broad DB filter, strict digit verify. ----
    // Every phone in this table is stored as "(NNN) NNN-NNNN", so a query for
    // the raw digit run can never match. Filter on the three digit groups, then
    // confirm in JS on normalized last-10 digits so formatting is irrelevant.
    const want = phoneDigits10(phone);
    if (want.length === 10) {
      const PHONE_PAGE = 200;
      const pattern = `*${want.slice(0, 3)}*${want.slice(3, 6)}*${want.slice(6)}*`;
      const loose = unwrap(await select("ghost_agency_prospects", `?select=*&phone=ilike.${pattern}&limit=${PHONE_PAGE}`).catch(() => []));
      let rows = loose.filter((r) => phoneDigits10(r.phone) === want);
      // A result set that came back FULL may have been truncated by the limit,
      // so it cannot prove uniqueness — and neither can an empty one. Only a
      // short page is authoritative. Otherwise scan the table properly, because
      // "I found one" and "one exists" are different claims.
      if (loose.length >= PHONE_PAGE || !rows.length) {
        rows = await scanForMatches((r) => phoneDigits10(r.phone) === want);
      }
      rows = collapseSameBusiness(distinctRows(rows));
      if (rows.length === 1) return { status: "ok", matched_by: "phone", ...callerFacts(rows[0]) };
      if (rows.length > 1) return ambiguous("phone", rows);
    }

    // ---- 4. Email. Any address stored on the row — the one a report or a ----
    // ---- proof email went to. Same fail-closed shape as the phone path. ----
    const wantEmail = String(email || "").trim().toLowerCase();
    if (wantEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(wantEmail)) {
      const storedEmails = (r) => {
        const rec = r && typeof r.record === "object" && r.record ? r.record : {};
        return [r.email, r.owner_email, rec.email, rec.owner_email]
          .map((v) => String(v || "").trim().toLowerCase())
          .filter(Boolean);
      };
      let rows = [];
      for (const spelling of [wantEmail]) {
        for (const column of ["email", "owner_email"]) {
          rows = unwrap(await select("ghost_agency_prospects", `?select=*&${column}=eq.${encodeURIComponent(spelling)}&limit=5`).catch(() => []));
          if (rows.length) break;
        }
        if (rows.length) break;
      }
      // The address can also live inside record — not a queryable column on
      // every deployment, so a JS scan over the same bounded pages settles it.
      if (!rows.length) {
        rows = await scanForMatches((r) => storedEmails(r).includes(wantEmail));
      }
      rows = collapseSameBusiness(distinctRows(rows));
      if (rows.length === 1) return { status: "ok", matched_by: "email", ...callerFacts(rows[0]) };
      if (rows.length > 1) return ambiguous("email", rows);
    }

    // ---- 5. Business name. The genuinely ambiguous one — and city-aware. ----
    const spoken = String(businessName || "").trim();
    if (spoken) {
      const qn = normName(spoken);
      const qTokens = qn.split(" ").filter(Boolean);
      const first = spoken.split(/\s+/)[0];
      const NAME_PAGE = 200;
      const loose = unwrap(await select(
        "ghost_agency_prospects", `?select=*&business_name=ilike.*${encodeURIComponent(first)}*&limit=${NAME_PAGE}`).catch(() => []));
      // Same truncation rule as the phone path: a full page may be cut short,
      // and a cut-short candidate set is exactly how a 4-way tie gets mistaken
      // for a unique match. Fall back to a real scan rather than trust it.
      const nameMatches = loose.length >= NAME_PAGE
        ? await scanForMatches((r) => normName(r.business_name).includes(normName(first)))
        : loose;
      let rows = distinctRows(nameMatches);

      // Voice transcription mangles exactly the distinctive first word
      // ("Wilborn" for Wilbourn), and an ilike on the mangled word matches
      // nothing — the caller's own test call died here. When the first-word
      // net comes up empty, recast with the OTHER tokens (and a 4-char prefix
      // of the longest token, which survives most one-letter mangles). The
      // token-overlap scorer below still decides; ambiguity still reads back.
      if (!rows.length && qTokens.length > 1) {
        const nets = [...new Set(
          qTokens.filter((t) => t.length >= 4 && t !== normName(first))
            .concat([qTokens.slice().sort((a, b) => b.length - a.length)[0].slice(0, 4)])
        )].slice(0, 3);
        const rescued = [];
        for (const net of nets) {
          rescued.push(...unwrap(await select(
            "ghost_agency_prospects", `?select=*&business_name=ilike.*${encodeURIComponent(net)}*&limit=${NAME_PAGE}`).catch(() => [])));
        }
        rows = distinctRows(rescued);
      }

      // THE CITY IS A TIEBREAKER THE CALLER CAN SUPPLY BY EXISTING. "United
      // Roofing" ties four businesses in four states; the caller saying
      // "the Dallas one" (or the city coming off their record) is the one
      // disambiguator they never have to spell out. It RANKS, it never
      // overrules a name match, and a tie with no city given stays a tie.
      const qCity = normName(city);
      const score = (r) => {
        const bn = normName(r.business_name);
        if (!bn) return -1;
        if (bn === qn) return 1000;
        const bTokens = new Set(bn.split(" ").filter(Boolean));
        let overlap = 0;
        for (const t of qTokens) if (bTokens.has(t)) overlap += 1;
        let s = overlap * 10;
        if (qn && (bn.startsWith(qn) || qn.startsWith(bn))) s += 50;
        if (qn && bn.includes(qn)) s += 30;
        if (qCity && normName(r.city) === qCity) s += 200;
        return s;
      };

      const ranked = rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 10).sort((a, b) => b.s - a.s);
      if (ranked.length) {
        const top = ranked[0].s;
        const tied = collapseSameBusiness(ranked.filter((x) => x.s === top).map((x) => x.r));
        // An EXACT name match (1000) still collides if two rows carry the same
        // name, so the tie check runs at every score, not just the fuzzy ones.
        if (tied.length === 1) return { status: "ok", matched_by: qCity ? "business_name+city" : "business_name", ...callerFacts(tied[0]) };
        return ambiguous("business_name", tied);
      }
    }

    const ask = askSentence();
    return notFound(ask.say, ask.ask_for);
  } catch (error) {
    console.error(`resolveCaller failed: ${error.message}`);
    // Fail closed. A broken lookup is never an authorized identity.
    return notFound("I'm having trouble pulling up records right now. Can I take a message and have someone follow up?");
  }
}

/**
 * Build the read-back. Riley must speak the choices and take a Client-ID —
 * never resolve the tie herself.
 */
function ambiguous(matchedBy, rows) {
  const candidates = distinctRows(rows).slice(0, 5).map((r) => {
    const f = callerFacts(r);
    return {
      client_id: f.client_id,
      business_name: f.business_name,
      city: f.city,
      state: f.state,
      // prospect_id/preview_url are deliberately withheld from a multi-candidate
      // response: until the caller proves which business is theirs, none of
      // these rows is "their" record, and a preview_url is client data.
    };
  });
  const names = candidates.map((c) => c.business_name).filter(Boolean);
  const list = names.length > 1
    ? `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`
    : names[0] || "one of a few accounts";
  return {
    status: "ambiguous",
    matched_by: matchedBy,
    candidates,
    say: `I found ${candidates.length} accounts that match — ${list}. Which one is yours? If you have the Client ID from your email, that's the fastest way for me to be sure.`,
  };
}

// =====================================================================
// READ-BACK IDENTITY (confirm-before-apply)
// =====================================================================
// resolveSiteEditTarget() answers "may this slug be edited?" and returns a
// DEPLOY target — a Vercel project name and an alias host. Neither of those
// is something a caller can recognise on the phone. Riley cannot say "I'm
// about to edit projectName wss-test-flint-plumbing-s5" and expect a plumber
// to catch that it is the wrong company.
//
// describeSiteEditTarget() returns the two facts a human CAN check — the
// business name and the domain — so the edit can be read back and rejected
// by the caller BEFORE anything is written. It fails closed: if we cannot
// name the business, we cannot ask the caller to confirm it, so no edit is
// authorized. "I couldn't tell you whose site this is" must never degrade
// into "so I edited it anyway".

/** Pull a business name out of a site's own <head>. */
function businessNameFromHtml(html) {
  const pick = (re) => {
    const m = String(html || "").match(re);
    return m ? m[1].trim() : "";
  };
  const raw =
    pick(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']application-name["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    pick(/<title>([^<]+)<\/title>/i);
  if (!raw) return "";
  // "Flint Plumbing LLC | Plumbing in Austin, TX" -> "Flint Plumbing LLC"
  return raw.split(/\s+[|–—·]\s+/)[0].trim().slice(0, 120);
}

/**
 * describeSiteEditTarget(siteSlug)
 *
 * -> { site_slug, business_name, domain, client_id, city, state, source, target }
 *    null  — not editable, or not nameable (both are hard stops)
 *
 * `source` records where the business name came from, because a name read
 * back to a caller should be traceable:
 *   "prospect_row"   — the CRM row whose site this is
 *   "site_metadata"  — the site's own <head> (mirror-engine sites have no
 *                      prospect row; the deployed page is then the most
 *                      authoritative statement of whose site it is)
 */
async function describeSiteEditTarget(siteSlug) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return null;
  const target = await resolveSiteEditTarget(slug);
  if (!target) return null;
  const domain = stripProtocol(target.aliasHost || "") || `${slug}.wss-ai.com`;

  // 1. Prefer the CRM row, when one exists. Verified by re-deriving the slug
  //    from the row rather than trusting a substring match on preview_url.
  try {
    const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
    const loose = unwrap(await select(
      "ghost_agency_prospects",
      `?select=*&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`
    ).catch(() => []));
    const exact = distinctRows(loose.filter((r) => siteSlugFromRow(r) === slug));
    // More than one CRM row claiming the same live site is exactly the
    // wrong-client hazard this module exists to stop — refuse to name it.
    if (exact.length > 1) return null;
    if (exact.length === 1) {
      const f = callerFacts(exact[0]);
      if (f.business_name) {
        return {
          site_slug: slug,
          business_name: f.business_name,
          domain,
          client_id: f.client_id || null,
          city: f.city || null,
          state: f.state || null,
          source: "prospect_row",
          target,
        };
      }
    }
  } catch (error) {
    console.warn(`describeSiteEditTarget: prospect lookup failed for '${slug}': ${error.message}`);
  }

  // 2. Fall back to the site's own metadata.
  try {
    const html = (await download(slug, "index.html")).toString("utf8");
    const name = businessNameFromHtml(html);
    if (name) {
      return {
        site_slug: slug,
        business_name: name,
        domain,
        client_id: null,
        city: null,
        state: null,
        source: "site_metadata",
        target,
      };
    }
  } catch (error) {
    console.warn(`describeSiteEditTarget: archive read failed for '${slug}': ${error.message}`);
  }

  return null;
}

/**
 * The end-to-end voice path: caller identity -> verified single client ->
 * ghost-owned deploy target. Returns { status } exactly as resolveCaller,
 * plus `target` when (and only when) an edit may proceed.
 */
async function resolveSiteEditTargetForCaller(identity = {}) {
  const who = await resolveCaller(identity);
  if (who.status !== "ok") return { ...who, target: null };
  if (!who.site_slug) {
    return {
      ...who,
      status: "no_site",
      target: null,
      say: `I found your account, ${who.business_name}, but I don't have a site on file I can change yet. Let me have someone follow up.`,
    };
  }
  const target = await resolveSiteEditTarget(who.site_slug);
  if (!target) {
    return {
      ...who,
      status: "not_editable",
      target: null,
      say: `I found your account, ${who.business_name}, but that site isn't set up for live changes yet. Let me log the request and have someone follow up.`,
    };
  }
  return { ...who, status: "ok", target };
}

module.exports = {
  resolveSiteEditTarget,
  describeSiteEditTarget,
  businessNameFromHtml,
  targetFromPromotion,
  FALLBACK_SITES,
  resolveCaller,
  resolveSiteEditTargetForCaller,
  siteSlugFromRow,
  siteSlugFromPreviewUrl,
  phoneDigits10,
  // Exposed for tests: the line between "one client written twice" and "two
  // clients that collide" is the whole safety property here, so it is pinned
  // directly rather than inferred through a live table.
  __testables: { collapseSameBusiness },
};

