"use strict";

// lib/mirror-engine/routes.js — what URLs this mirror actually has.
//
// THE DEFECT THIS FILE EXISTS TO END: every deployed mirror answered HTTP 200
// to EVERY path. deploy.js falls back to a blanket `{"source":"/(.*)",
// "destination":"/"}` whenever the donor manifest declares no `spa_routes` —
// and not one of the three usable donors declares any. So:
//
//   · an unknown path served the SPA shell with a 200 (a soft 404: the crawler
//     is told the page exists, and a human sees a blank body while the router
//     decides it has nothing to render),
//   · the eight footer service links and /services all resolved to the same
//     rewrite, so "8 links, 1 page" is what the catch-all guarantees whenever
//     the client router does not take over,
//   · and nothing anywhere checked whether a link's destination EXISTS.
//
// The fix is to stop guessing. A mirror's route set is knowable from the bytes
// being shipped, in this order of authority:
//
//   1. donor manifest `spa_routes` — an explicit declaration always wins.
//   2. the COMPILED ROUTER's own table: `path:"/services"` literals in the
//      chunk that defines the routes, plus `$param` segments which become
//      prefix routes.
//   3. the links the site itself renders. A donor that links to /work is
//      promising /work; that promise is the last-resort route source.
//
// Everything NOT in that set falls through to 404.html with a genuine 404.
//
// A path that appears in a link but resolves to nothing is a DEAD LINK, and a
// link to nothing is worse than no link — pruneDeadLinks removes it (taking its
// <li> with it, so no bullet is left behind).

const HTML_RE = /\.html$/i;

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
/** Normalize an href to a comparable site path, or null if it is not one. */
function toSitePath(href) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // mailto:, tel:, https:, data:
  if (raw.startsWith("#")) return null;              // same-page anchor
  if (!raw.startsWith("/")) return null;             // relative — donors do not use them
  const [pathPart, hash = ""] = raw.split("#", 2);
  let p = pathPart.split("?")[0] || "/";
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  return { path: p, hash };
}

/** Every internal link the shipped HTML renders, with its hash targets. */
function internalLinks(files) {
  const out = new Map();
  for (const [rel, buf] of Object.entries(files)) {
    if (!HTML_RE.test(rel)) continue;
    const html = buf.toString("utf8");
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
      const link = toSitePath(m[1]);
      if (!link) continue;
      const entry = out.get(link.path) || { path: link.path, hashes: new Set(), sources: new Set(), count: 0 };
      entry.count++;
      entry.sources.add(rel);
      if (link.hash) entry.hashes.add(link.hash);
      out.set(link.path, entry);
    }
  }
  return out;
}

/** Paths served straight off the filesystem (Vercel checks files first). */
function filePaths(files) {
  const set = new Set(["/"]);
  for (const rel of Object.keys(files)) {
    if (rel === "index.html" || rel === "404.html") continue;
    set.add("/" + rel);
    if (HTML_RE.test(rel)) set.add("/" + rel.replace(HTML_RE, "")); // cleanUrls
    // Static-site generators commonly ship `/service-area/index.html` for the
    // clean URL `/service-area`. Treat the directory index as that clean path,
    // not as the fictional `/service-area/index` page. This same shape is used
    // by the concrete donor and is also what static hash validation must read.
    if (/\/index\.html$/i.test(rel)) set.add("/" + rel.replace(/\/index\.html$/i, ""));
  }
  return set;
}

/**
 * The compiled router's own table. Vite/TanStack/React-Router all emit the
 * route paths as string literals; `$param` / `:param` segments mark a dynamic
 * child, which we express as a PREFIX rewrite on its parent.
 */
function compiledRouteTable(files) {
  const exact = new Set();
  const dynamic = new Set();
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(js|mjs)$/i.test(rel)) continue;
    const src = buf.toString("utf8");
    // `${…}` is a template interpolation and never a route; `$service` IS one
    // (TanStack's dynamic segment). Excluding "$" wholesale — an earlier
    // draft did — dropped `/$service`, which is exactly the route the eight
    // footer service links need, and made all eight look dead.
    for (const m of src.matchAll(/\bpath\s*:\s*[`"']([^`"'{}]*)[`"']/g)) {
      const v = m[1];
      if (!v.startsWith("/")) continue;
      if (/[$:]/.test(v)) { dynamic.add(v); continue; }
      exact.add(v.length > 1 ? v.replace(/\/+$/, "") : "/");
    }
  }
  // A dynamic child ("/$service") names no parent on its own. The chunk that
  // implements it does: Vite writes `services._service-<hash>.js`.
  const prefixes = new Set();
  if (dynamic.size) {
    for (const rel of Object.keys(files)) {
      const m = /(?:^|\/)([a-z0-9-]+)\._[a-z]+-[A-Za-z0-9_-]+\.js$/i.exec(rel);
      if (m) prefixes.add("/" + m[1]);
    }
  }
  return { exact: [...exact], prefixes: [...prefixes], dynamic: [...dynamic] };
}

/**
 * deriveRoutes({ files, manifest })
 *   -> { exact, prefixes, source, linked, dead, hashTargets }
 * `exact`    — paths rewritten to the SPA shell verbatim.
 * `prefixes` — paths whose CHILDREN are also the SPA shell (dynamic segments).
 * `dead`     — linked paths that resolve to no file, no route, no prefix.
 */
function deriveRoutes({ files, manifest = {} }) {
  const onDisk = filePaths(files);
  const links = internalLinks(files);
  const declared = Array.isArray(manifest.spa_routes)
    ? manifest.spa_routes.filter((r) => typeof r === "string" && r.startsWith("/"))
    : [];

  const table = compiledRouteTable(files);
  let exact = new Set();
  let prefixes = new Set();
  let source;
  if (declared.length) {
    source = "manifest";
    for (const r of declared) (r.endsWith("/*") ? prefixes.add(r.slice(0, -2)) : exact.add(r));
  } else if (table.exact.length) {
    source = "compiled_router";
    exact = new Set(table.exact);
    prefixes = new Set(table.prefixes);
  } else {
    source = "rendered_links";
  }

  // Whatever the source, a path the site LINKS to and that is not a real file
  // must be reachable — otherwise the donor's own nav 404s. Adding it here is
  // what makes "no blanket catch-all" safe.
  const dead = [];
  for (const [p, entry] of links) {
    if (onDisk.has(p)) continue;
    if (exact.has(p)) continue;
    if ([...prefixes].some((pre) => p === pre || p.startsWith(pre + "/"))) continue;
    if (source === "rendered_links") { exact.add(p); continue; }
    // A router-declared parent covers its children; anything else is dead.
    dead.push({ path: p, links: entry.count, from: [...entry.sources].slice(0, 3) });
  }

  // "/" is the shell itself; it never needs a rewrite.
  exact.delete("/");
  const hashTargets = [];
  for (const [p, entry] of links) {
    for (const h of entry.hashes) hashTargets.push({ path: p, id: h });
  }

  return {
    source,
    exact: [...exact].sort(),
    prefixes: [...prefixes].sort(),
    linked: [...links.keys()].sort(),
    dead,
    hashTargets,
    file_paths: onDisk.size,
  };
}

/**
 * Build the exact path -> file map consumed by the immutable shared-site
 * publisher.  Unlike vercel.json rewrites this map is data, not deployment
 * configuration: every public asset, every clean static URL and every SPA URL
 * the built site actually owns is named explicitly.  Prefix routes are
 * expanded only through links present in the shipped bytes, so the shared
 * router never inherits the old "every path serves index.html" soft-404 bug.
 */
function buildRouteMap({ files, routePlan } = {}) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new TypeError("route_map_files_required");
  }
  const plan = routePlan && typeof routePlan === "object" ? routePlan : deriveRoutes({ files });
  const out = Object.create(null);
  const hasFile = (rel) => Object.prototype.hasOwnProperty.call(files, rel);
  const add = (route, rel, { replace = false } = {}) => {
    if (!hasFile(rel)) throw new Error(`route_map_target_missing:${rel}`);
    if (!replace && Object.prototype.hasOwnProperty.call(out, route)) return;
    out[route] = rel;
  };

  if (!hasFile("index.html")) throw new Error("route_map_index_missing");
  add("/", "index.html");

  for (const rel of Object.keys(files).sort()) {
    // vercel.json is provider configuration, not a customer asset.  The shared
    // lane never creates it, but excluding it here also keeps an injected
    // legacy fixture from accidentally publishing it.
    if (rel === "vercel.json") continue;
    add(`/${rel}`, rel);
    if (!HTML_RE.test(rel)) continue;
    if (rel === "index.html") continue;
    if (/\/index\.html$/i.test(rel)) {
      const clean = `/${rel.replace(/\/index\.html$/i, "")}`;
      add(clean, rel);
      add(`${clean}/`, rel);
    } else {
      add(`/${rel.replace(HTML_RE, "")}`, rel);
    }
  }

  const shell = "index.html";
  const exact = new Set(Array.isArray(plan.exact) ? plan.exact : []);
  const prefixes = Array.isArray(plan.prefixes) ? plan.prefixes : [];
  for (const route of [...exact].sort()) add(route, shell);
  for (const prefix of [...prefixes].sort()) add(prefix, shell);

  // A dynamic prefix represents infinitely many possible paths.  The release
  // manifest deliberately records only the deep paths this particular site
  // links to; unknown children remain real 404s.
  for (const route of (Array.isArray(plan.linked) ? plan.linked : []).slice().sort()) {
    if (route === "/" || Object.prototype.hasOwnProperty.call(out, route)) continue;
    if (exact.has(route) || prefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))) {
      add(route, shell);
    }
  }

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Dead-link pruning
// ---------------------------------------------------------------------------
/**
 * Remove every <a href="DEAD">…</a> from the shipped HTML, taking a wrapping
 * <li> with it when the anchor is the item's only content. Hash-only repairs
 * (`/services#missing-id` -> `/services`) are handled by `stripHashes`.
 */
function pruneDeadLinks(files, deadPaths) {
  const targets = new Set(deadPaths.map(String));
  if (!targets.size) return { files, removed: 0 };
  const out = { ...files };
  let removed = 0;
  for (const [rel, buf] of Object.entries(files)) {
    if (!HTML_RE.test(rel)) continue;
    let html = buf.toString("utf8");
    for (const target of targets) {
      for (;;) {
        const re = new RegExp(`<a\\b[^>]*\\bhref="${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#?][^"]*)?"[^>]*>`, "i");
        const open = re.exec(html);
        if (!open) break;
        const closeAt = html.indexOf("</a>", open.index);
        if (closeAt === -1) break;
        let start = open.index;
        let end = closeAt + 4;
        // If the anchor is the whole list item, the bullet goes too.
        const liStart = html.lastIndexOf("<li", start);
        const liEnd = html.indexOf("</li>", end);
        if (liStart !== -1 && liEnd !== -1) {
          const liOpenEnd = html.indexOf(">", liStart);
          const before = html.slice(liOpenEnd + 1, start).trim();
          const after = html.slice(end, liEnd).trim();
          if (!before && !after) { start = liStart; end = liEnd + 5; }
        }
        html = html.slice(0, start) + html.slice(end);
        removed++;
      }
    }
    out[rel] = Buffer.from(html, "utf8");
  }
  return { files: out, removed };
}

/** Resolve a clean route to the static HTML file that serves it, if one exists. */
function staticHtmlForPath(files, value) {
  let p = String(value || "/").split(/[?#]/, 1)[0] || "/";
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  if (p === "/") return files["index.html"] || null;
  const bare = p.replace(/^\//, "");
  const candidates = [
    `${bare}.html`,           // /about -> about.html
    `${bare}/index.html`,     // /service-area -> service-area/index.html
    bare,                     // explicit extensionless file, rare but valid
  ];
  for (const rel of candidates) if (files[rel]) return files[rel];
  return null;
}

/**
 * Fragments we can adjudicate WITHOUT a browser: the destination is a real
 * shipped HTML file, so its ids are in the bytes. An SPA route's ids only
 * exist after the router renders (roofing-riseabove writes `id={slug}` on each
 * service article at runtime), and those are left to the rendered audit — a
 * static "id not found" there would be a false positive that deleted a working
 * anchor.
 */
function staticMissingHashes(files, hashTargets) {
  const missing = [];
  for (const { path: p, id } of hashTargets) {
    if (!id) continue;
    const buf = staticHtmlForPath(files, p);
    if (!buf) continue; // SPA route — not decidable from bytes
    const html = buf.toString("utf8");
    const re = new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    if (!re.test(html)) missing.push({ path: p, id });
  }
  return missing;
}

/**
 * Drop the #fragment from links whose target id does not exist on the page they
 * point at. The link still works — it just stops promising a jump that will not
 * happen. `missing` is [{path, id}].
 */
function stripHashes(files, missing) {
  if (!missing.length) return { files, stripped: 0 };
  const out = { ...files };
  let stripped = 0;
  for (const [rel, buf] of Object.entries(files)) {
    if (!HTML_RE.test(rel)) continue;
    let html = buf.toString("utf8");
    for (const { path: p, id } of missing) {
      const needle = `href="${p}#${id}"`;
      if (!html.includes(needle)) continue;
      const parts = html.split(needle);
      stripped += parts.length - 1;
      html = parts.join(`href="${p}"`);
    }
    out[rel] = Buffer.from(html, "utf8");
  }
  return { files: out, stripped };
}

module.exports = {
  toSitePath,
  internalLinks,
  filePaths,
  compiledRouteTable,
  deriveRoutes,
  buildRouteMap,
  pruneDeadLinks,
  stripHashes,
  staticHtmlForPath,
  staticMissingHashes,
};
