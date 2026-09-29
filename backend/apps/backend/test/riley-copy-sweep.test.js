"use strict";
// RILEY COPY GUARD — the banned-claim sweep for lib/ and scripts/.
//
// PRs #605/#610 fixed the main surfaces, and the 2026-09-02 sweep fixed the
// last remnants (email-templates.js, supervised-held-drafts.js, console-page.js,
// organic-email.js, mirror-lead.js, the proof-email scripts). This test locks
// the whole tree so the retired claims cannot quietly return in a new file:
//
//   1. "change my video"                — Riley edits WEBSITES. The video
//                                         example named a request the executor
//                                         cannot perform.
//   2. "call or text" / "text or call"  — Riley's line is a VAPI VOICE number
//                                         with no SMS provisioning; a text
//                                         goes nowhere (the same narrowing
//                                         outreach-email-v3.js records).
//   3. "she / her" near "Riley"         — Riley is HE/HIM. Wrong pronouns
//                                         shipped in five files before this
//                                         guard existed.
//
// COMMENT POLICY: historical narration in comments may quote the dead copy
// ("was 'call or text'"), so pure comment lines (//, /*, *) and HTML comments
// inside template literals are skipped. Only rendered copy is guarded.
//
// ALLOWED-COPY EXCLUSIONS (deliberate, each with a reason):
//   * lib/riley-email-shell.js — the ALLOWED copy source this sweep mirrors;
//     the shell renders per-client lines that may carry SMS.
//   * lib/email.js, lib/line-email-assets.js, lib/line-delivery.js,
//     lib/line-runner.js, lib/line-queue.js, lib/preview-visuals.js,
//     lib/mirror-engine/** — other owners' lanes; the sweep must not edit
//     them, and they carry no banned copy today.
//   * lib/outreach-email-v2.js, lib/outreach-email-v3.js — declared clean by
//     the same instruction; v2's remaining "Call or text me:" names the
//     SENDER's own phone, not Riley's voice line.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");

const BANNED_CHANNEL = /change my video|call or text|text or call/i;
const PRONOUN = /\b(?:she|her|hers)\b/i;
const RILEY = /riley/i;
const PRONOUN_WINDOW = 5; // lines on either side that count as "near Riley"

// Files the guard never flags (see header for why each is exempt).
const EXEMPT_FILES = new Set([
  "lib/riley-email-shell.js",
  "lib/email.js",
  "lib/line-email-assets.js",
  "lib/line-delivery.js",
  "lib/line-runner.js",
  "lib/line-queue.js",
  "lib/preview-visuals.js",
  "lib/outreach-email-v2.js",
  "lib/outreach-email-v3.js",
]);

const SCAN_DIRS = ["lib", "scripts"];
const SCAN_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

/** Recursively list files to scan, as backend-root-relative posix paths. */
function listScanFiles() {
  const files = [];
  const walk = (relDir) => {
    const abs = path.join(backendRoot, relDir);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === "lib/mirror-engine") continue; // exempt lane (see header)
        walk(rel);
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        if (!EXEMPT_FILES.has(rel)) files.push(rel);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return files.sort();
}

/** Blank out comments so historical narration cannot trip the guard. */
function stripComments(source) {
  return source
    // HTML comments inside template literals, blanked line-preserving.
    .replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")
        ? ""
        : line;
    })
    .join("\n");
}

/** Every banned-pattern hit in already-stripped lines: "N: text" strings. */
function findHits(lines) {
  const hits = [];
  lines.forEach((line, i) => {
    if (BANNED_CHANNEL.test(line)) {
      hits.push(`${i + 1}: banned video/SMS claim — ${line.trim().slice(0, 120)}`);
    }
    if (PRONOUN.test(line)) {
      const near = lines.slice(Math.max(0, i - PRONOUN_WINDOW), i + PRONOUN_WINDOW + 1);
      if (near.some(RILEY.test, RILEY)) {
        hits.push(`${i + 1}: "she/her" within ${PRONOUN_WINDOW} lines of Riley (Riley is he/him) — ${line.trim().slice(0, 120)}`);
      }
    }
  });
  return hits;
}

function violationsIn(relPath) {
  const source = stripComments(fs.readFileSync(path.join(backendRoot, relPath), "utf8"));
  return findHits(source.split("\n")).map((hit) => `${relPath}:${hit}`);
}

test("lib/ and scripts/ carry no retired Riley claims (video swaps, SMS promises, wrong pronouns)", () => {
  const files = listScanFiles();
  assert.ok(files.length > 50, `the sweep should scan the real tree, found ${files.length} files`);
  assert.ok(files.includes("lib/email-templates.js"), "the consent-first template must stay in scan scope");
  assert.ok(files.includes("scripts/send-flint-proof-email.cjs"), "the proof-email scripts must stay in scan scope");
  assert.ok(!files.includes("lib/riley-email-shell.js"), "the allowed-copy shell is deliberately exempt");

  const hits = files.flatMap(violationsIn);
  assert.deepEqual(
    hits,
    [],
    `retired Riley copy resurfaced:\n  ${hits.join("\n  ")}`,
  );
});

test("the guard detects every banned pattern when reinserted into copy", () => {
  // Prove the detector works — a guard that can never fail is decoration.
  const probe = stripComments([
    'const a = "you can call or text anytime";',            // 1 — flag
    'const b = "text or call to change your site";',        // 2 — flag
    'const c = \'You say "change my video" and it happens\';', // 3 — flag
    '// historical note: this used to say "call or text"',  // 4 — comment, no flag
    "Meet Riley — she works for you and her edits land live;", // 5 — pronoun near Riley, flag
    "const filler = 1;",                                    // 6
    "const filler = 2;",                                    // 7
    "const filler = 3;",                                    // 8
    "const filler = 4;",                                    // 9
    "const filler = 5;",                                    // 10
    "const filler = 6;",                                    // 11
    "The owner said she would reply tomorrow.",             // 12 — pronoun, Riley is 7 lines back: no flag
  ].join("\n")).split("\n");
  assert.deepEqual(
    findHits(probe).map((hit) => hit.split(":")[0]),
    ["1", "2", "3", "5"],
    "exactly the copy lines must be flagged, never the comment or the distant pronoun",
  );
});
