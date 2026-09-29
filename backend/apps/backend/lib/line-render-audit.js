"use strict";

// Production render-audit wrapper.
//
// It keeps the Mirror Engine's exact routes/prose contract, but fixes two
// independent production bottlenecks without shrinking coverage:
//
// 1) LARGE MULTIPAGE DONORS. verify.renderAudit intentionally walks up to 14
//    routes, but it does so serially in one browser. A fencing donor with the
//    full 14-route set repeatedly hit the Line's 260s mirror deadline even
//    though uploads took <7s and browsers launched in ~3s. The production Line
//    partitions that same 14-route proof into small concurrent audits and then
//    recomputes the global collision/hash/prose/content verdict from their
//    evidence. No route is omitted; cross-chunk route collisions are recomputed.
//
// 2) TWO MEASURED FALSE NEGATIVES. Only when every remaining failure is one of
//    these named cases do we open a fresh browser and prove it again:
//      - injected authority sections exist but React has not revealed them yet;
//      - connector-ended text is actually an H1-H6 heading (for example
//        "WHAT WE STAND FOR" or "BEST FOR"), not a broken sentence.
//    Every other render problem remains a hard failure.

const verify = require("./mirror-engine/verify");
const { launchChromium } = require("./serverless-chromium");

const HIDDEN_PREFIX = "injected_content_present_but_not_visible:";
const PROSE_PREFIX = "broken_prose:";
const SECOND_LOOK_MS = 4_500;
// Deliberately NOT reduced. Smaller chunks shorten one row's audit only when
// browsers are plentiful; they also raise the BROWSER COUNT per audit (13
// routes: 3 chunks at 5/chunk, but 5 chunks at 3/chunk). The remote pool is now
// deliberately small to stop the render starvation that kept any site from
// finishing, so more-but-shorter chunks would queue against that pool and cost
// more wall time, not less. Fewer, fuller browsers is the right trade here.
const PARALLEL_AUDIT_THRESHOLD = 6;
const PARALLEL_AUDIT_CHUNK = 5;
const MAX_AUDIT_PATHS = 14; // mirror-engine/verify.js MAX_PATHS; keep coverage identical.

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueBy(items, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function wantedPaths(options = {}) {
  return [...new Set(["/"].concat(Array.isArray(options.paths) ? options.paths : []))]
    .slice(0, MAX_AUDIT_PATHS);
}

function chunkPaths(paths, size = PARALLEL_AUDIT_CHUNK) {
  const rest = paths.filter((p) => p !== "/");
  const chunks = [];
  for (let i = 0; i < rest.length; i += size) chunks.push(rest.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

function recomputeProblems(pages, prose, missingHash, expectInjectedOn, carry = []) {
  const problems = [...carry];
  const badStatus = pages.filter((p) => Number(p.status) !== 200).map((p) => ({ path: p.path, status: p.status }));
  const emptyBodies = pages.filter((p) => Number(p.status) === 200 && (Number(p.chars) || 0) < 40).map((p) => p.path);

  const groups = new Map();
  for (const pg of pages) {
    if (!pg.text_hash || Number(pg.chars) < 40) continue;
    const list = groups.get(pg.text_hash) || [];
    if (!list.includes(pg.path)) list.push(pg.path);
    groups.set(pg.text_hash, list);
  }
  const collisions = [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => list.sort());

  if (badStatus.length) problems.push(`non_200_paths:${badStatus.map((b) => `${b.path}=${b.status}`).join(",")}`);
  if (emptyBodies.length) problems.push(`empty_rendered_body:${emptyBodies.join(",")}`);
  if (collisions.length) problems.push(`route_collisions:${collisions.map((c) => c.join("=")).join(" | ")}`);
  if (missingHash.length) problems.push(`missing_hash_targets:${missingHash.map((m) => `${m.path}#${m.id}`).join(",")}`);
  if (prose.length) {
    problems.push(`broken_prose:${prose.map((entry) => {
      const first = (entry.artifacts || [])[0] || {};
      return `${entry.path}:${first.rule}${first.excerpt ? ` :: "${String(first.excerpt).slice(0, 120)}"` : ""}`;
    }).join(",")}`);
  }

  const entityPages = pages.filter((p) => (p.entity_residue || []).length);
  if (entityPages.length) {
    problems.push(`entity_residue_in_rendered_text:${entityPages
      .map((p) => `${p.path}=${p.entity_residue.join(" ")}`)
      .join(" | ")}`);
  }

  const contentLost = (expectInjectedOn || [])
    .map((path) => pages.find((page) => page.path === path))
    .filter((page) => page && Number(page.status) === 200 && !Number(page.injected_sections))
    .map((page) => page.path);
  if (contentLost.length) {
    const hidden = contentLost.filter((path) => {
      const page = pages.find((candidate) => candidate.path === path);
      return page && Number(page.injected_sections_in_markup) > 0;
    });
    problems.push(hidden.length
      ? `${HIDDEN_PREFIX}${hidden.join(",")}`
      : `injected_content_not_in_rendered_dom:${contentLost.join(",")}`);
  }

  return { problems, collisions };
}

function mergeAuditResults(results, options = {}) {
  const unavailable = (results || []).find((result) => result && result.status === "unavailable");
  if (unavailable) return unavailable;

  const pages = uniqueBy(
    (results || []).flatMap((result) => Array.isArray(result && result.pages) ? result.pages : []),
    (page) => String(page && page.path || ""),
  );
  const prose = uniqueBy(
    (results || []).flatMap((result) => Array.isArray(result && result.prose) ? result.prose : []),
    (entry) => `${entry && entry.path}:${JSON.stringify(entry && entry.artifacts || [])}`,
  );
  const missingHash = uniqueBy(
    (results || []).flatMap((result) => Array.isArray(result && result.missing_hash_targets) ? result.missing_hash_targets : []),
    (entry) => `${entry && entry.path}#${entry && entry.id}`,
  );

  const recomputedPrefixes = [
    "non_200_paths:",
    "empty_rendered_body:",
    "route_collisions:",
    "missing_hash_targets:",
    PROSE_PREFIX,
    "entity_residue_in_rendered_text:",
    HIDDEN_PREFIX,
    "injected_content_not_in_rendered_dom:",
  ];
  const carry = uniqueBy(
    (results || []).flatMap((result) => Array.isArray(result && result.problems) ? result.problems : [])
      .map(String)
      .filter((problem) => !recomputedPrefixes.some((prefix) => problem.startsWith(prefix))),
    (problem) => problem,
  );

  const recomputed = recomputeProblems(pages, prose, missingHash, options.expectInjectedOn || [], carry);
  return {
    status: recomputed.problems.length ? "failed" : "passed",
    problems: recomputed.problems,
    pages,
    collisions: recomputed.collisions,
    missing_hash_targets: missingHash.slice(0, 20),
    prose: prose.slice(0, 8),
    paths_rendered: pages.length,
    parallel_audit: {
      status: "completed",
      chunks: results.length,
      path_limit: MAX_AUDIT_PATHS,
      chunk_size: PARALLEL_AUDIT_CHUNK,
    },
  };
}

async function parallelAudit(baseUrl, options = {}, baseAudit = verify.renderAudit) {
  const paths = wantedPaths(options);
  if (paths.length <= PARALLEL_AUDIT_THRESHOLD) return baseAudit(baseUrl, options);
  const chunks = chunkPaths(paths);
  const hashTargets = Array.isArray(options.hashTargets) ? options.hashTargets : [];
  const expected = Array.isArray(options.expectInjectedOn) ? options.expectInjectedOn : [];

  const results = await Promise.all(chunks.map((chunk) => {
    const allowed = new Set(["/", ...chunk]);
    return baseAudit(baseUrl, {
      ...options,
      paths: chunk,
      hashTargets: hashTargets.filter((target) => target && allowed.has(String(target.path || "/"))),
      expectInjectedOn: expected.filter((path) => allowed.has(path)),
    });
  }));
  return mergeAuditResults(results, { ...options, paths });
}

function recoverableProblems(result = {}) {
  const problems = Array.isArray(result.problems) ? result.problems.map(String) : [];
  if (!problems.length) return null;
  if (problems.some((p) => !p.startsWith(HIDDEN_PREFIX) && !p.startsWith(PROSE_PREFIX))) return null;

  const hidden = new Set();
  for (const p of problems.filter((v) => v.startsWith(HIDDEN_PREFIX))) {
    for (const path of p.slice(HIDDEN_PREFIX.length).split(",").map((v) => v.trim()).filter(Boolean)) hidden.add(path);
  }

  const headingArtifacts = [];
  const separatorArtifacts = [];
  for (const entry of Array.isArray(result.prose) ? result.prose : []) {
    for (const artifact of Array.isArray(entry && entry.artifacts) ? entry.artifacts : []) {
      const rule = String(artifact && artifact.rule);
      if (rule !== "line_ends_with_connector" && rule !== "line_starts_with_separator") return null;
      const excerpt = String(artifact && artifact.excerpt || "").trim();
      if (!excerpt) return null;
      const structured = { path: String(entry.path || "/"), excerpt };
      if (rule === "line_ends_with_connector") headingArtifacts.push(structured);
      else separatorArtifacts.push(structured);
    }
  }
  // A prose problem with no structured artifact is not safe to reinterpret.
  if (problems.some((p) => p.startsWith(PROSE_PREFIX))
    && !headingArtifacts.length && !separatorArtifacts.length) return null;
  return { problems, hidden, headingArtifacts, separatorArtifacts };
}

async function secondLook(baseUrl, plan, options = {}) {
  const launch = options.launch || launchChromium;
  const browser = await launch();
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const paths = [...new Set([
    ...plan.hidden,
    ...plan.headingArtifacts.map((a) => a.path),
    ...plan.separatorArtifacts.map((a) => a.path),
  ])];
  const evidence = {};
  try {
    const page = await browser.newPage();
    for (const path of paths) {
      const response = await page.goto(base + path, { waitUntil: "networkidle", timeout: 30_000 });
      if (!response || response.status() !== 200) return { ok: false, reason: `second_look_http_${response ? response.status() : 0}:${path}` };

      const needsContent = plan.hidden.has(path);
      const deadline = Date.now() + SECOND_LOOK_MS;
      let snapshot = null;
      do {
        snapshot = await page.evaluate(() => {
          const visible = (node) => {
            if (!node) return false;
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > .01 && rect.width > 1 && rect.height > 1;
          };
          const textOf = (node) => (node && (node.innerText || node.textContent) || "")
            .replace(/\s+/g, " ").trim();
          const shortLabel = (node) => {
            if (!visible(node) || node.childElementCount > 0) return false;
            const text = textOf(node);
            if (!text || text.length > 80) return false;
            const tag = String(node.tagName || "").toLowerCase();
            const role = String(node.getAttribute("role") || "").toLowerCase();
            if (["th", "dt", "label", "legend"].includes(tag)
              || ["columnheader", "rowheader"].includes(role)) return true;
            const parent = node.parentElement;
            if (!parent) return false;
            const parentDisplay = getComputedStyle(parent).display;
            const peers = [...parent.children].filter(visible)
              .map(textOf).filter((value) => value && value.length <= 80);
            return getComputedStyle(node).textTransform === "uppercase"
              && ["grid", "inline-grid", "table-row"].includes(parentDisplay)
              && peers.length >= 2;
          };
          const precedingSiblingText = (node) => {
            let prior = node && node.previousSibling;
            while (prior) {
              const text = prior.nodeType === Node.TEXT_NODE
                ? String(prior.textContent || "").replace(/\s+/g, " ").trim()
                : (prior.nodeType === Node.ELEMENT_NODE && visible(prior) ? textOf(prior) : "");
              if (text) return text;
              prior = prior.previousSibling;
            }
            return "";
          };
          const all = [...document.querySelectorAll("body *")];
          return {
            visibleInjected: [...document.querySelectorAll("section.wss-c")].filter(visible).length,
            injectedMarkup: document.querySelectorAll("section.wss-c").length,
            headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible)
              .map(textOf)
              .filter(Boolean),
            shortLabels: all.filter(shortLabel).map(textOf),
            listItems: [...document.querySelectorAll("li")].filter(visible).map((node) => ({
              rendered: textOf(node),
              content: String(node.textContent || "").replace(/\s+/g, " ").trim(),
            })),
            separatorContinuations: all.filter(visible).map((node) => ({
              text: textOf(node),
              preceding: precedingSiblingText(node),
            })).filter((entry) => /^[·•|,;:]/.test(entry.text) && entry.preceding),
          };
        });
        if (!needsContent || snapshot.visibleInjected > 0) break;
        if (Date.now() < deadline) await page.waitForTimeout(180);
      } while (Date.now() < deadline);

      if (needsContent && (!snapshot || snapshot.visibleInjected < 1)) {
        return { ok: false, reason: `second_look_content_still_hidden:${path}`, snapshot };
      }
      const connectorArtifacts = plan.headingArtifacts.filter((a) => a.path === path);
      const labels = [
        ...(snapshot && snapshot.headings || []),
        ...(snapshot && snapshot.shortLabels || []),
      ].map(norm).filter(Boolean);
      for (const artifact of connectorArtifacts) {
        const excerpt = norm(artifact.excerpt);
        // proseArtifacts stores the final 45 characters around a trailing
        // connector, so a long heading proves the excerpt at its END.
        if (!labels.some((label) => label === excerpt || label.endsWith(excerpt))) {
          return { ok: false, reason: `second_look_prose_not_heading_or_label:${path}:${artifact.excerpt.slice(0, 80)}`, snapshot };
        }
      }

      const stripSeparator = (value) => String(value || "").replace(/^[·•|,;:]\s*/, "");
      const listItems = Array.isArray(snapshot && snapshot.listItems) ? snapshot.listItems : [];
      const continuations = Array.isArray(snapshot && snapshot.separatorContinuations)
        ? snapshot.separatorContinuations : [];
      for (const artifact of plan.separatorArtifacts.filter((a) => a.path === path)) {
        const excerpt = norm(artifact.excerpt);
        const excerptBody = norm(stripSeparator(artifact.excerpt));
        // A leading-separator artifact stores the first 45 characters. Match
        // that exact captured prefix, but only inside one of the proven DOM
        // contexts above; an arbitrary text line never earns this recovery.
        const inList = listItems.some((item) => {
          const rendered = norm(item && item.rendered);
          const content = norm(item && item.content);
          return rendered === excerpt || rendered.startsWith(excerpt)
            || (excerptBody && (content === excerptBody || content.startsWith(excerptBody)));
        });
        const afterSibling = continuations.some((item) => {
          const text = norm(item && item.text);
          return Boolean(norm(item && item.preceding))
            && (text === excerpt || text.startsWith(excerpt));
        });
        if (!inList && !afterSibling) {
          return { ok: false, reason: `second_look_prose_separator_unproven:${path}:${artifact.excerpt.slice(0, 80)}`, snapshot };
        }
      }
      evidence[path] = snapshot;
    }
    return { ok: true, evidence };
  } finally {
    await browser.close().catch(() => {});
  }
}

function repairedResult(result, plan, recovery) {
  const remaining = (result.problems || []).filter((p) => {
    const value = String(p);
    return !value.startsWith(HIDDEN_PREFIX) && !value.startsWith(PROSE_PREFIX);
  });
  const pages = (result.pages || []).map((page) => {
    const snap = recovery.evidence && recovery.evidence[page.path];
    return snap && plan.hidden.has(page.path)
      ? { ...page, injected_sections: Math.max(Number(page.injected_sections) || 0, Number(snap.visibleInjected) || 0) }
      : page;
  });
  return {
    ...result,
    status: remaining.length ? "failed" : "passed",
    problems: remaining,
    pages,
    recovered_problems: plan.problems,
    second_look: { status: "passed", wait_ms: SECOND_LOOK_MS, evidence: recovery.evidence },
  };
}

async function renderAuditWithRecovery(baseUrl, options = {}) {
  const baseAudit = options.baseAudit || verify.renderAudit;
  const auditOptions = { ...options };
  delete auditOptions.baseAudit;
  delete auditOptions.launch;
  const result = await parallelAudit(baseUrl, auditOptions, baseAudit);
  if (!result || result.status !== "failed") return result;
  const plan = recoverableProblems(result);
  if (!plan) return result;
  try {
    const recovery = await secondLook(baseUrl, plan, options);
    return recovery.ok ? repairedResult(result, plan, recovery) : { ...result, second_look: recovery };
  } catch (error) {
    return {
      ...result,
      second_look: { status: "failed", reason: String(error && error.message || error).slice(0, 240) },
    };
  }
}

module.exports = {
  HIDDEN_PREFIX,
  PROSE_PREFIX,
  SECOND_LOOK_MS,
  PARALLEL_AUDIT_THRESHOLD,
  PARALLEL_AUDIT_CHUNK,
  MAX_AUDIT_PATHS,
  norm,
  wantedPaths,
  chunkPaths,
  recomputeProblems,
  mergeAuditResults,
  parallelAudit,
  recoverableProblems,
  secondLook,
  repairedResult,
  renderAuditWithRecovery,
};
