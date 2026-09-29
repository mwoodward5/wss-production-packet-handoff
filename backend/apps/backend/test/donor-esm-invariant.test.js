"use strict";

// DONOR ESM INVARIANT — the guard for a real production outage class.
//
// Vercel's function builder TRANSPILES any ESM-looking `.js` it traces into a
// serverless bundle. When a donor's chunks ship as plain `.js`, the deployed
// mirror gets a CommonJS rewrite of a module it never asked for and dies at
// SERVE time with "exports is not defined" — a white page behind a build that
// passed every gate, because nothing in the build ever reads those bytes back.
//
// lib/mirror-engine/donor.js:loadDonorFiles sidesteps it by storing ESM chunks
// under a `.js.raw` suffix (the builder treats `.raw` as data) and restoring
// the real name at load time. Four donors — concrete-elconstruction,
// tattoo-aurelia, medspa-luma, salon-lacquer-studio — are stored that way; the
// other seven ship one self-contained bundle with no ESM syntax at all, so
// they need no suffix.
//
// NOTHING enforced that. A re-import of any donor could drop plain ESM `.js`
// into donors-clean and every check in this system would stay green until a
// prospect opened a dead page. This test is that enforcement: it reads the
// bytes on disk, not a manifest claim.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");

// The syntax Vercel's builder reacts to. Donor chunks are minified, so real
// statements are separated by `;` or `}` rather than newlines; `import.meta`
// and dynamic `import(` are ESM-only regardless of position.
const ESM_SYNTAX = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;

function jsChunksIn(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      // `.js.raw` ends in `.raw`, so test it first.
      const stored = entry.name.endsWith(".js.raw")
        ? "raw"
        : entry.name.endsWith(".js")
          ? "plain"
          : null;
      if (!stored) continue;
      out.push({
        stored,
        rel: path.relative(DONOR_ROOT, full).split(path.sep).join("/"),
        full,
      });
    }
  };
  walk(dir);
  return out;
}

function donorDirs() {
  return fs.readdirSync(DONOR_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test("every donor in donors-clean ships at least one javascript chunk", () => {
  const donors = donorDirs();
  assert.ok(donors.length > 0, "donors-clean is empty — the scan below would pass vacuously");
  for (const donor of donors) {
    const chunks = jsChunksIn(path.join(DONOR_ROOT, donor));
    assert.ok(
      chunks.length > 0,
      `${donor} has no .js or .js.raw chunk; a donor that renders nothing cannot be mirrored`,
    );
  }
});

test("a donor chunk containing ESM syntax is stored as .js.raw", () => {
  const violations = [];
  let scanned = 0;
  let rawStored = 0;
  for (const donor of donorDirs()) {
    for (const chunk of jsChunksIn(path.join(DONOR_ROOT, donor))) {
      scanned += 1;
      if (chunk.stored === "raw") rawStored += 1;
      const source = fs.readFileSync(chunk.full, "utf8");
      if (!ESM_SYNTAX.test(source)) continue;
      if (chunk.stored === "raw") continue;
      const match = source.match(ESM_SYNTAX);
      violations.push(`${chunk.rel} (matched ${JSON.stringify(String(match[0]).trim())})`);
    }
  }
  assert.ok(scanned > 0, "no donor javascript was scanned at all");
  assert.ok(rawStored > 0, "no .js.raw chunk found — the storage convention has disappeared");
  assert.deepEqual(
    violations,
    [],
    `ESM donor chunks stored as plain .js will be transpiled by Vercel's function builder and `
    + `serve "exports is not defined". Rename each to <name>.js.raw (donor.js restores the real `
    + `name at load): ${violations.join(", ")}`,
  );
});

test("the ESM detector is live — .js.raw chunks are stored that way for a reason", () => {
  // Without this, a broken regex above would turn the invariant into a
  // no-op that reports success forever. At least one chunk on disk must
  // actually trip the detector.
  let esmDetected = 0;
  for (const donor of donorDirs()) {
    for (const chunk of jsChunksIn(path.join(DONOR_ROOT, donor))) {
      if (ESM_SYNTAX.test(fs.readFileSync(chunk.full, "utf8"))) esmDetected += 1;
    }
  }
  assert.ok(
    esmDetected > 0,
    "ESM_SYNTAX matched nothing anywhere in donors-clean; the invariant test above proves nothing",
  );
});

test("loadDonorFiles restores the real .js name for every stored .js.raw chunk", () => {
  // The suffix is only safe because the loader undoes it. If that ever stops
  // being true, the deployed mirror requests /assets/index-*.js and gets a 404
  // — which is the same white page by another route.
  const { loadDonorFiles } = require("../lib/mirror-engine/donor");
  for (const donor of donorDirs()) {
    const stored = jsChunksIn(path.join(DONOR_ROOT, donor)).filter((chunk) => chunk.stored === "raw");
    if (!stored.length) continue;
    const files = loadDonorFiles(path.join(DONOR_ROOT, donor));
    for (const chunk of stored) {
      const restored = chunk.rel.slice(donor.length + 1, -4);
      assert.ok(
        Object.hasOwn(files, restored),
        `${donor}: ${chunk.rel} did not load back as ${restored}`,
      );
      assert.ok(
        !Object.hasOwn(files, `${restored}.raw`),
        `${donor}: ${restored}.raw shipped under its storage name`,
      );
    }
  }
});
