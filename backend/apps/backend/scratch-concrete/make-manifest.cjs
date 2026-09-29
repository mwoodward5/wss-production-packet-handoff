"use strict";
/**
 * scratch-concrete/make-manifest.cjs — write the STAGED donor's BOILERPLATE.json.
 *
 * Derived from donors-clean/concrete-elconstruction/BOILERPLATE.json so that
 * every hand-authored field that is still true (identity atoms, truthLaw,
 * photo_slots_detail, leadCapture, componentsPreserved, contentIslandNotes)
 * carries over verbatim. Only the fields the client-SPA recompile actually
 * changes are overwritten, and photo_slots is REGENERATED from the built tree
 * (the manifest's own caution: Vite content-hashes those names).
 *
 * READ-ONLY on the live library. Writes only inside scratch-concrete/.
 */
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const SRC = path.join(BACKEND, "donors-clean", "concrete-elconstruction", "BOILERPLATE.json");
const STAGE = path.join(__dirname, "donor-staging", "concrete-elconstruction-spa");

const base = JSON.parse(fs.readFileSync(SRC, "utf8"));

// ---- photo_slots regenerated from the STAGED tree -------------------------
const present = (rel) => fs.existsSync(path.join(STAGE, rel));
const photoSlots = base.photo_slots.filter(present);
const missing = base.photo_slots.filter((p) => !present(p));
if (missing.length) throw new Error(`staged tree is missing declared photo slots: ${missing.join(", ")}`);

const jsChunks = fs.readdirSync(path.join(STAGE, "assets")).filter((f) => f.endsWith(".js"));
const cssChunks = fs.readdirSync(path.join(STAGE, "assets")).filter((f) => f.endsWith(".css"));

const SPA_ROUTES = [
  "/about",
  "/contact",
  "/service-area",
  "/commercial-concrete",
  "/foundations-excavation",
  "/flatwork-driveways",
  "/concrete-demolition",
  "/commercial-renovation",
  "/home-renovation",
  "/flooring-services",
];

const out = {
  ...base,
  name: "concrete-elconstruction-spa",
  vertical: "concrete",
  label: "EL Construction design, client-SPA recompile — concrete & general contracting, deep multi-page, video hero",

  staging_only: true,
  staging_note:
    "STAGED, NOT INSTALLED. This tree lives under apps/backend/scratch-concrete/donor-staging/ and is invisible to lib/mirror-engine/donor.js, lib/donor-verticals.js and lib/buildable-verticals.js, all of which read donors-clean/ (or MIRROR_DONOR_ROOT). Installing it is a deliberate move of this directory into donors-clean plus the canonical pointer flip in data/donor-verticals.json — see scratch-concrete/RUNBOOK.md.",

  source:
    "Client-SPA recompile of the SAME owner-approved EL Construction design already shipping as concrete-elconstruction. Built 2026-08-19 from the source-tokenized port tree at C:/ports/el_construction_1 (src/ copied verbatim, zero content edits) using the recipe proven by C:/ports/_builds/plumbing-verbatim -> donors-clean/plumbing-clean: plain Vite + @vitejs/plugin-react + @tailwindcss/vite, no @lovable.dev/vite-tanstack-config, no tanstackStart, no nitro, no Cloudflare plugin.",

  stack:
    "compiled Vite 7 + React 19 (TanStack Router running CLIENT-SIDE, Tailwind CSS v4) — ONE self-contained bundle, Fraunces/Inter via Google Fonts; static hosting, no request-time build, no SSR/SSG half",

  howItWasMadeStatic: undefined,
  howItWasMadeSpa: {
    problem:
      "The SSG variant of this donor is the only tree in donors-clean that ships (a) a serialized TanStack Start hydration payload ($_TSR stream barrier, per-route timestamps) that React must re-match at boot, and (b) twenty cross-importing ESM chunks. Both are the shapes that produced the fleet's two worst serve-time failures: React hydration errors on a page that passed every build gate, and \"exports is not defined\" when Vercel's function builder CommonJS-transpiles traced ESM. The .js.raw sidecar convention (lib/mirror-engine/donor.js loadDonorFiles) works around (b); nothing works around (a) except not shipping a hydration payload.",
    solution:
      "Recompile the identical src/ as a client SPA. The route tree and createFileRoute calls are router-CORE, so all twelve routes keep working; only the root route changes shape (no shellComponent/head()/HeadContent/Scripts) and the WSS shell index.html owns <head> instead. Result: nothing to hydrate (empty #root, client render), and ONE chunk with zero ESM syntax, so the sidecar convention is not needed at all.",
    changedFiles: [
      "src/routes/__root.tsx — shellComponent + head() + HeadContent/Scripts removed; the design frame (SiteHeader / Outlet / SiteFooter / StickyCallBar / spacer) is byte-identical",
      "src/main.tsx — added (createRoot + RouterProvider + styles.css), the plumbing-verbatim entry",
      "index.html — the WSS shell: the <head> of the SHIPPED SSG donor lifted verbatim, minus its modulepreload links and its own stylesheet link (Vite injects the new ones). Same tokens, same NEED blocks, same three ld+json blocks, same hero-video-ladder island and runtime.",
      "vite.config.ts — plain Vite; rollupOptions.output.inlineDynamicImports for a single chunk",
    ],
    unchanged:
      "src/components, src/routes/*.tsx (all twelve), src/lib (schema, site, lead, track, wssc content bridge), src/hooks, src/styles.css and src/assets are copied verbatim from the port tree. No copy, no claim, no photo and no token was edited.",
    deployRoot: "dist",
  },

  spa_routes: SPA_ROUTES,
  spa_routes_note:
    "TRUE SPA ROUTES — every one of these has NO file behind it in this tree (the dist is one index.html), which is exactly the precondition deploy.js deepLinkCheck() asserts: it probes spa_routes[0] and requires the response to be byte-identical to index.html. The SSG variant had to declare spa_routes EMPTY because Vercel checks the filesystem before rewrites and /service-area served its own 34,808-byte prerendered page against the 71,193-byte shell, failing deployed_verification. This tree ships NO vercel.json, so deploy.js withSpaRewrite() injects {cleanUrls:true, rewrites:[each route -> \"/\"]}.",

  routes: ["/", ...SPA_ROUTES],
  routeNotes: [
    "Twelve client-side routes from the design's own TanStack route tree. /service-area renders its area chips from the content island at boot ({#city} anchors, slugified) — no positional area-N slugs, no donor city in any URL.",
    "sitemap.xml (shipped from public/) lists exactly these routes and robots.txt stays neutral. Every listed route resolves through the injected SPA rewrite.",
    "TRADE-OFF vs the SSG variant, recorded honestly: per-route <head> is no longer prerendered. The shell's title/description/og/ld+json are the same tokenized bytes on every route, and the route-level head() blocks in src/routes/*.tsx are inert in this build. This is the identical trade donors-clean/plumbing-clean already ships under.",
  ],

  assets_built: { js: jsChunks, css: cssChunks },
  esm_invariant:
    "NOT APPLICABLE BY CONSTRUCTION. The single bundle contains no ESM syntax (no top-level import/export, no import.meta, no dynamic import()), verified against the exact regex in test/donor-esm-invariant.test.js, so it ships as a plain .js and there is nothing for Vercel's builder to transpile. The SSG variant needs twenty .js.raw sidecars to survive the same builder.",

  photo_slots: photoSlots,
  photo_slots_verified:
    "2026-08-19 — regenerated from the staged client-SPA build. All 17 entries present. Vite emitted content-hashed names IDENTICAL to the SSG build (same source bytes, same hashing), so the slot array is unchanged from the shipping donor.",

  verification: {
    build: "node node_modules/vite/bin/vite.js build — 1918 modules transformed, 1 js chunk (532,766 B), 1 css chunk, 0 errors",
    esm: "the ESM_SYNTAX regex from test/donor-esm-invariant.test.js returns false on the bundle — plain .js is safe here",
    // GOTCHA: never write a literal double-brace token name into a manifest.
    // hydrate.js runs unknownTokensIn() over EVERY donor file including
    // BOILERPLATE.json — before MANIFEST_FILES drops it from the output — so
    // an invented token name here fails the whole build with unmapped_token.
    bare_tokens: "acorn full-AST scan of the bundle: 0 bare token Identifier nodes (242 literal double-brace token occurrences, all inside string literals; 29 NEED markers)",
    identity: "gate-a-scan identityScan() over the hydrated tree using this manifest's own atoms — see scratch-concrete/prove-staged-donor.cjs",
    render: "Playwright chromium over all 12 routes of the hydrated tree served locally with the engine's own SPA rewrite semantics — see scratch-concrete/prove-staged-donor.cjs",
  },

  registered_on: "2026-08-19",
  installed_at: "apps/backend/scratch-concrete/donor-staging/concrete-elconstruction-spa (STAGED — not in donors-clean)",
};

delete out.howItWasMadeStatic;
delete out.gate_4a;
out.gate_4a_note =
  "The SSG variant's recorded GATE 4A PASS is NOT inherited — it was run against a different compiled tree. Its known_limitation still applies to the design either way: this manifest lists every Phoenix-metro city and \"Arizona\" as donor geography, so gate 4A cannot pass for an Arizona prospect until donor geography can be told from client geography.";

fs.writeFileSync(path.join(STAGE, "BOILERPLATE.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote", path.join(STAGE, "BOILERPLATE.json"));
console.log("photo_slots:", photoSlots.length, "| js:", jsChunks.join(","), "| css:", cssChunks.join(","));
