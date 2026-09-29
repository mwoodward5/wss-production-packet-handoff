"use strict";

// lib/site-edit-replay.js — RE-APPLY the customer's own changes to a freshly
// composed site tree, so a rebuild is donor + content + THEN the edit log.
//
// =====================================================================
// THE ONE RULE
// =====================================================================
// A replayed op uses THE SAME apply function the original edit used. They are
// imported from lib/site-change-plan.js rather than reimplemented, because two
// implementations of "insert this fragment after that heading" is two chances
// to disagree, and the disagreement would show up as a customer's site quietly
// differing from the one they approved. There is exactly one applyInsertHtml
// in this codebase and this file calls it.
//
// =====================================================================
// AN EDIT THAT NO LONGER FITS IS REPORTED, NEVER GUESSED AT
// =====================================================================
// The tree being rebuilt is not the tree that was edited. A donor can change,
// a heading can be reworded by the content stage, a compiled bundle is rebuilt
// under a new content hash. So an anchor can be missing, a literal can be
// gone, a file can no longer exist.
//
// There is an obvious temptation here and it is the wrong answer: find the
// "closest" heading, fuzzy-match the literal, put the fragment somewhere
// sensible. That is guessing where a customer's words go on a customer's
// site. Every op that cannot be applied EXACTLY is returned in `unreplayable`
// with the reason, and the caller decides what to do about it — in the mirror
// engine's case, refuse to republish rather than ship a site missing changes
// the customer paid for and believes are live.
//
// Nothing in this file is best-effort and nothing is silent. The three
// outcomes are: applied exactly, reported as unreplayable, or the whole call
// throws. There is no fourth.
//
// =====================================================================
// ORDER IS PART OF THE MEANING
// =====================================================================
// Edits compose. "Make the headline orange" then "actually make it red" are
// two style_overrides whose final effect depends entirely on which <style>
// block comes last in <head>. So entries are applied oldest-first, exactly as
// the customer made them, and each one keeps its ORIGINAL job id in the marker
// it writes — `<!-- wss-edit <jobId> -->`. That marker is what the undo path
// looks for and what the live-page probe greps, so a replayed edit stays
// identifiable as the same edit rather than becoming a new anonymous one.

const {
  applyStyleOverride,
  applyInsertHtml,
  applyReplaceText,
  applyCopyReplace,
  applySectionReorder,
  installTrackingTag,
  validateTrackingTag,
  rewriteAssetReferences,
  applyHeroLadderSwap,
  heroLadderSources,
  applyLegalStrip,
  readLegalStripLinks,
  insertSubPageNavLink,
} = require("./site-change-plan");
const { insertSitemapEntry } = require("./seo-page-edit");

/** Compiled output: read for replace_copy, never otherwise written here. */
const BUNDLE_EXT = /^assets\/.+\.(js|css)$/i;
const HTML_EXT = /\.html?$/i;

const asText = (buf) => (Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf == null ? "" : buf));

/** A short, non-throwing reason string for the report. */
function reasonOf(error) {
  return String((error && error.message) || error || "unknown").slice(0, 200);
}

/**
 * replayEdits({ files, entries, readArchived })
 *   -> { files, applied, unreplayable, changedFiles, restoredFiles }
 *
 * `files`   rel -> Buffer, the freshly composed tree. MUTATED IN PLACE and
 *           also returned, matching how every other stage in the engine works.
 * `entries` from lib/site-edit-log.js: [{ jobId, at, seq, instruction, op }],
 *           oldest first, already filtered to replayable-and-not-revoked.
 * `readArchived(rel)` -> Promise<Buffer|null>, only called for ops that
 *           restore a file the edit CREATED (a generated privacy page, a photo
 *           the customer sent in). Optional: without it those ops report
 *           `no_archive_reader` instead of being skipped quietly.
 */
async function replayEdits({ files, entries = [], readArchived = null } = {}) {
  if (!files || typeof files !== "object") throw new Error("replayEdits: files required");
  const applied = [];
  const unreplayable = [];
  const changed = new Set();
  const restored = [];

  const fail = (entry, reason) => {
    unreplayable.push({
      seq: entry.seq,
      jobId: entry.jobId,
      at: entry.at,
      op: String((entry.op && entry.op.op) || ""),
      instruction: String(entry.instruction || "").replace(/\s+/g, " ").slice(0, 160),
      reason,
    });
  };

  for (const entry of entries) {
    const op = (entry && entry.op) || {};
    const kind = String(op.op || "");
    const jobId = String(entry.jobId || "");

    try {
      if (kind === "style_override") {
        const rel = String(op.file || "index.html");
        if (!files[rel]) { fail(entry, `file_missing:${rel}`); continue; }
        const html = asText(files[rel]);
        if (!html.includes("</head>")) { fail(entry, `no_head:${rel}`); continue; }
        // ALREADY THERE? A build that re-ran over a tree which somehow kept the
        // block must not stack a second copy of the same rule.
        if (html.includes(`data-wss-edit="${jobId}"`)) {
          applied.push({ seq: entry.seq, jobId, op: kind, file: rel, note: "already_present" });
          continue;
        }
        files[rel] = Buffer.from(
          applyStyleOverride(html, { css: op.css, why: op.why || "customer request", jobId }),
          "utf8",
        );
        changed.add(rel);
        applied.push({ seq: entry.seq, jobId, op: kind, file: rel, bytes: String(op.css).length });
      } else if (kind === "insert_html") {
        const rel = String(op.file || "index.html");
        if (!files[rel]) { fail(entry, `file_missing:${rel}`); continue; }
        const html = asText(files[rel]);
        if (html.includes(`<!-- wss-edit ${jobId} -->`)) {
          applied.push({ seq: entry.seq, jobId, op: kind, file: rel, note: "already_present" });
          continue;
        }
        const anchor = String(op.anchorExact || "");
        const hits = html.split(anchor).length - 1;
        // The anchor is the customer's own heading. Zero means the rebuild no
        // longer has the thing they attached their words to; more than one
        // means we would be choosing. Both are reported, neither is resolved.
        if (hits === 0) { fail(entry, "anchor_not_found"); continue; }
        if (hits > 1) { fail(entry, `anchor_ambiguous:${hits}`); continue; }
        files[rel] = Buffer.from(
          applyInsertHtml(html, {
            exact: anchor,
            position: op.position === "before" ? "before" : "after",
            fragment: String(op.fragment || ""),
            jobId,
          }),
          "utf8",
        );
        changed.add(rel);
        applied.push({ seq: entry.seq, jobId, op: kind, file: rel, anchorLabel: op.anchorLabel || null });
      } else if (kind === "replace_text") {
        const rel = String(op.file || "");
        if (!files[rel]) { fail(entry, `file_missing:${rel}`); continue; }
        const text = asText(files[rel]);
        // Already applied is indistinguishable from "the new wording is what
        // the fresh build says" — either way the customer's words are on the
        // page, which is the only question that matters.
        if (!text.includes(op.find) && text.includes(op.replace)) {
          applied.push({ seq: entry.seq, jobId, op: kind, file: rel, note: "already_present" });
          continue;
        }
        const hits = text.split(op.find).length - 1;
        if (hits === 0) { fail(entry, "find_text_not_found"); continue; }
        if (hits > 1) { fail(entry, `find_text_ambiguous:${hits}`); continue; }
        files[rel] = Buffer.from(applyReplaceText(text, { find: op.find, replace: op.replace }), "utf8");
        changed.add(rel);
        applied.push({ seq: entry.seq, jobId, op: kind, file: rel });
      } else if (kind === "replace_copy") {
        // The bundle is rebuilt under a NEW content-hashed filename, so the
        // recorded path is meaningless and the literal is the identity. Search
        // every compiled file for it; exactly one owner or nothing happens.
        const literal = String(op.literal || "");
        const needle = `"${literal}"`;
        const owners = Object.keys(files).filter((rel) => BUNDLE_EXT.test(rel) && asText(files[rel]).includes(needle));
        if (!owners.length) {
          const already = Object.keys(files).some(
            (rel) => BUNDLE_EXT.test(rel) && asText(files[rel]).includes(`"${op.replacement}"`),
          );
          if (already) {
            applied.push({ seq: entry.seq, jobId, op: kind, note: "already_present" });
            continue;
          }
          fail(entry, "copy_literal_not_found");
          continue;
        }
        if (owners.length > 1) { fail(entry, `copy_literal_in_${owners.length}_bundles`); continue; }
        const rel = owners[0];
        files[rel] = Buffer.from(
          applyCopyReplace(asText(files[rel]), { literal, replacement: String(op.replacement) }),
          "utf8",
        );
        changed.add(rel);
        applied.push({ seq: entry.seq, jobId, op: kind, file: rel, to: String(op.replacement).slice(0, 80) });
      } else if (kind === "tracking_tag") {
        // Re-validated, not trusted: the id goes back through the same gate it
        // passed on the way in, so a row that was tampered with in the store
        // cannot put arbitrary text into a <script> on a customer's site.
        const tag = validateTrackingTag({ vendor: op.vendor, id: op.id });
        const pages = Object.keys(files).filter((rel) => HTML_EXT.test(rel)).sort();
        const installedOn = [];
        for (const rel of pages) {
          const out = installTrackingTag(asText(files[rel]), tag);
          if (!out.changed) continue;
          files[rel] = Buffer.from(out.html, "utf8");
          changed.add(rel);
          installedOn.push(rel);
        }
        if (!installedOn.length) {
          // Every page already carries it — the state the customer asked for.
          applied.push({ seq: entry.seq, jobId, op: kind, vendor: tag.key, id: tag.id, note: "already_present" });
          continue;
        }
        applied.push({ seq: entry.seq, jobId, op: kind, vendor: tag.key, id: tag.id, files: installedOn });
      } else if (kind === "restore_files") {
        // Pages and pictures the edit CREATED. They are not in the donor and
        // the content stage will never regenerate them, so the only honest
        // source is the bytes we deployed for this customer last time, which
        // are still in their own archive.
        if (typeof readArchived !== "function") { fail(entry, "no_archive_reader"); continue; }
        const wanted = (Array.isArray(op.files) ? op.files : []).filter((f) => typeof f === "string" && f);
        const missing = [];
        const got = {};
        for (const rel of wanted) {
          if (files[rel]) continue; // the fresh build already ships this path
          const buf = await readArchived(rel);
          if (!Buffer.isBuffer(buf) || !buf.length) { missing.push(rel); continue; }
          got[rel] = buf;
        }
        if (missing.length) { fail(entry, `archived_file_missing:${missing.join(",")}`); continue; }
        for (const [rel, buf] of Object.entries(got)) {
          files[rel] = buf;
          changed.add(rel);
          restored.push(rel);
        }
        applied.push({ seq: entry.seq, jobId, op: kind, files: wanted, restored: Object.keys(got) });
      } else if (kind === "swap_image") {
        // TWO HALVES OR NEITHER. The customer's picture has to come back into
        // the tree AND every reference has to follow it; doing one without the
        // other leaves the page showing the picture they replaced.
        if (typeof readArchived !== "function") { fail(entry, "no_archive_reader"); continue; }
        const toRel = String(op.to || "").replace(/^\//, "");
        if (!files[toRel]) {
          const buf = await readArchived(toRel);
          if (!Buffer.isBuffer(buf) || !buf.length) { fail(entry, `archived_file_missing:${toRel}`); continue; }
          files[toRel] = buf;
          restored.push(toRel);
        }
        const texts = {};
        for (const [rel, buf] of Object.entries(files)) {
          if (HTML_EXT.test(rel) || BUNDLE_EXT.test(rel) || /\.(css|json|txt|xml|svg)$/i.test(rel)) {
            texts[rel] = asText(buf);
          }
        }
        const hits = rewriteAssetReferences(texts, String(op.from), String(op.to));
        if (!hits.length) {
          const already = Object.values(texts).some((t) => t.includes(String(op.to)));
          if (already) {
            applied.push({ seq: entry.seq, jobId, op: kind, note: "already_present" });
            continue;
          }
          // The picture they replaced is not in this build at all, so there is
          // nothing to repoint. Reported, not resolved by putting it somewhere.
          fail(entry, `no_reference_to_repoint:${op.from}`);
          continue;
        }
        for (const hit of hits) {
          files[hit.file] = Buffer.from(texts[hit.file], "utf8");
          changed.add(hit.file);
        }
        changed.add(toRel);
        applied.push({ seq: entry.seq, jobId, op: kind, from: op.from, to: op.to, references: hits.length });
      } else if (kind === "set_hero_video") {
        // THE GENERATED HERO CLIP COMES BACK, AND THE LADDER FOLLOWS IT. The
        // rebuild recomputes every ladder from the donor manifest (engine.js
        // finalizeHeroArtifact) BEFORE this runs, so the replay has exactly
        // one job: put the customer's clip bytes back into the tree, then
        // re-apply the SAME ladder swap the live edit applied — same function
        // (applyHeroLadderSwap), same retired rung, same content-addressed
        // clip. A ladder that no longer names the retired rung is a build
        // that changed shape underneath the customer; that is reported, never
        // guessed around.
        if (typeof readArchived !== "function") { fail(entry, "no_archive_reader"); continue; }
        const toRel = String(op.to || "").replace(/^\//, "");
        if (!files[toRel]) {
          const buf = await readArchived(toRel);
          if (!Buffer.isBuffer(buf) || !buf.length) { fail(entry, `archived_file_missing:${toRel}`); continue; }
          files[toRel] = buf;
          restored.push(toRel);
        }
        const from = String(op.from || "");
        // BARE PATH, exactly as the live edit wrote it: the donors store rungs
        // without a leading slash and the walker adds one.
        const to = toRel;
        let ladderHits = 0;
        const texts = {};
        for (const [rel, buf] of Object.entries(files)) {
          if (HTML_EXT.test(rel) || BUNDLE_EXT.test(rel)) texts[rel] = asText(buf);
        }
        for (const rel of Object.keys(texts).filter((rel) => HTML_EXT.test(rel) && heroLadderSources(texts[rel]))) {
          const swapped = applyHeroLadderSwap(texts[rel], { from, to });
          if (!swapped.changed) continue;
          texts[rel] = swapped.html;
          ladderHits += swapped.changed;
        }
        // Every OTHER reference to the retired rung (a bundle literal) follows
        // the same boundary-tested rewrite the live edit used.
        const stragglerHits = from ? rewriteAssetReferences(texts, from, toRel) : [];
        if (!ladderHits && !stragglerHits.length) {
          // The new clip may already BE the top rung — a rebuild replayed on
          // top of itself — which is the state the customer asked for.
          const already = Object.keys(texts).some(
            (rel) => HTML_EXT.test(rel) && (heroLadderSources(texts[rel]) || [])[0] === toRel,
          );
          if (already) {
            applied.push({ seq: entry.seq, jobId, op: kind, note: "already_present", to: toRel });
            continue;
          }
          fail(entry, from ? `no_reference_to_repoint:${from}` : "no_hero_ladder_to_attach");
          continue;
        }
        for (const rel of Object.keys(texts)) {
          if (asText(files[rel]) === texts[rel]) continue;
          files[rel] = Buffer.from(texts[rel], "utf8");
          changed.add(rel);
        }
        // The clip bytes themselves count as part of this edit whether they
        // were restored or already rode in with the fresh tree.
        changed.add(toRel);
        applied.push({
          seq: entry.seq, jobId, op: kind, from: from || null, to: toRel,
          ladders: ladderHits, references: stragglerHits.length,
        });
      } else if (kind === "legal_page") {
        // A restored page nobody can reach is not a page. The bytes come back
        // from the customer's archive, then the footer link and the sitemap
        // entry are re-added — all three, or the edit is reported as lost.
        if (typeof readArchived !== "function") { fail(entry, "no_archive_reader"); continue; }
        const rel = String(op.file || "");
        const route = String(op.route || "");
        const label = String(op.label || "Privacy");
        if (!files["index.html"]) { fail(entry, "file_missing:index.html"); continue; }
        if (!files[rel]) {
          const buf = await readArchived(rel);
          if (!Buffer.isBuffer(buf) || !buf.length) { fail(entry, `archived_file_missing:${rel}`); continue; }
          files[rel] = buf;
          changed.add(rel);
          restored.push(rel);
        }
        let indexHtml = asText(files["index.html"]);
        if (!indexHtml.includes(`href="${route}"`)) {
          const links = readLegalStripLinks(indexHtml);
          if (!links.some((l) => l.route === route)) links.push({ route, label });
          indexHtml = applyLegalStrip(indexHtml, { links, jobId });
          if (!indexHtml.includes(`href="${route}"`)) { fail(entry, "could_not_link_from_home_page"); continue; }
          files["index.html"] = Buffer.from(indexHtml, "utf8");
          changed.add("index.html");
        }
        // EVERY PAGE THE LINK WAS ON, not just the home page. The original
        // edit also drops a nav link on about.html; replaying only index.html
        // meant a rebuild silently removed it from About — the customer's site
        // edited by us, without them asking and without anyone saying so.
        // Older records carry no linkedFrom, so those keep the old behaviour
        // rather than guessing at pages that may never have had the link.
        const alsoLinked = (Array.isArray(op.linkedFrom) ? op.linkedFrom : [])
          .filter((rel) => typeof rel === "string" && rel && rel !== "index.html");
        const relinked = [];
        for (const rel of alsoLinked) {
          if (!files[rel]) continue; // the fresh build does not have this page
          const html = asText(files[rel]);
          if (html.includes(`href="${route}"`)) { relinked.push(rel); continue; }
          const out = insertSubPageNavLink(html, { route, label });
          if (!out.changed) continue;
          files[rel] = Buffer.from(out.html, "utf8");
          changed.add(rel);
          relinked.push(rel);
        }

        let inSitemap = null;
        if (files["sitemap.xml"]) {
          const origin = (indexHtml.match(/<link[^>]+rel=["']canonical["'][^>]+href=["'](https?:\/\/[^/"']+)/i) || [])[1] || "";
          const loc = `${origin}${route}`;
          const map = insertSitemapEntry(asText(files["sitemap.xml"]), { loc, priority: "0.3", changefreq: "yearly" });
          inSitemap = map.present;
          if (map.changed) {
            files["sitemap.xml"] = Buffer.from(map.xml, "utf8");
            changed.add("sitemap.xml");
          }
        }
        applied.push({ seq: entry.seq, jobId, op: kind, file: rel, route, inSitemap, relinked });
      } else if (kind === "reorder_section") {
        // A SECTION MOVE replays by the same law every op does: the SAME apply
        // function, exact anchors, never a guess. The heading element run is
        // the identity (anchorExact discipline); a rebuild that no longer
        // carries it exactly once reports the edit rather than re-placing a
        // section by fuzzy match — "where the customer's sections sit" is not
        // ours to approximate.
        const rel = String(op.file || "index.html");
        if (!files[rel]) { fail(entry, `file_missing:${rel}`); continue; }
        const html = asText(files[rel]);
        if (html.includes(`<!-- wss-edit ${jobId} -->`)) {
          applied.push({ seq: entry.seq, jobId, op: kind, file: rel, note: "already_present" });
          continue;
        }
        const position = ["before", "after", "top", "bottom"].includes(op.position) ? op.position : "";
        if (!position) { fail(entry, `reorder_position_invalid:${op.position}`); continue; }
        // "Already in place" throws a spoken refusal on the live lane; on a
        // replay it is simply true, and the customer's order stands.
        try {
          files[rel] = Buffer.from(
            applySectionReorder(html, {
              headingExact: String(op.headingExact || ""),
              position,
              referenceExact: op.referenceExact ? String(op.referenceExact) : null,
              jobId,
            }),
            "utf8",
          );
        } catch (error) {
          if (error && error.alreadyInPlace) {
            applied.push({ seq: entry.seq, jobId, op: kind, file: rel, note: "already_in_place" });
            continue;
          }
          throw error;
        }
        changed.add(rel);
        applied.push({
          seq: entry.seq, jobId, op: kind, file: rel,
          moved: op.heading || null, reference: op.reference || null, position,
        });
      } else {
        fail(entry, `op_not_replayable:${kind || "unknown"}`);
      }
    } catch (error) {
      // An apply function that threw is an edit that did not go on. It is
      // reported with what it said, never swallowed.
      fail(entry, reasonOf(error));
    }
  }

  return {
    files,
    applied,
    unreplayable,
    changedFiles: [...changed].sort(),
    restoredFiles: restored,
  };
}

module.exports = { replayEdits };
