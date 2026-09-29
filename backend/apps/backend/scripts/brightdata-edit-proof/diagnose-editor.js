"use strict";
// scripts/brightdata-edit-proof/diagnose-editor.js
//
// "editor returned no files" is the symptom. This finds the cause by making
// the SAME Anthropic call lib/site-editor.js makes (same model, same
// max_tokens, same prompt, same file set) and reporting the fields
// site-editor.js throws away: stop_reason and token usage.

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("./env");
loadEnv();

const { listAll, download } = require("../../lib/site-editor");

const SLUG = "wss-test-flint-plumbing-s5";
const OUT_DIR = path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");
const TEXT_EXT = /\.(html?|css|js|json|svg|txt|xml)$/i;

async function main() {
  // Rebuild the EXACT editable set runSiteEdit() builds.
  const rels = await listAll(SLUG);
  const editable = [];
  for (const rel of rels) {
    const buf = await download(SLUG, rel);
    if (TEXT_EXT.test(rel) && buf.length < 200_000 && !rel.startsWith("assets/")) {
      editable.push({ rel, text: buf.toString("utf8") });
    }
  }

  console.log("--- editable set handed to the model (same filter as runSiteEdit) ---");
  let total = 0;
  for (const f of editable) { total += f.text.length; console.log(`  ${f.rel.padEnd(14)} ${String(f.text.length).padStart(7)} bytes`); }
  console.log(`  ${"TOTAL".padEnd(14)} ${String(total).padStart(7)} bytes  (~${Math.round(total / 3.7)} tokens)`);
  console.log(`\n  site-editor.js max_tokens budget: 16000`);
  console.log(`  index.html alone would need ~${Math.round(editable.find((f) => f.rel === "index.html").text.length / 3.7)} output tokens to return IN FULL\n`);

  const fileBlocks = editable.map(({ rel, text }) => `<file path="${rel}">\n${text}\n</file>`).join("\n\n");
  const instruction = require(path.join(OUT_DIR, "run-edit-result.json")).instruction;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: `You are a precise website editor. Apply this customer request to the site files below:\n\nREQUEST: ${instruction}\n\nRules:\n- Change ONLY what the request requires. Do not restyle, reformat, or "improve" anything else.\n- The site is a compiled SPA; page content lives in JS bundles you cannot see. Achieve visual changes (sizes, colors, spacing) by adding a clearly-commented <style> override block in index.html targeting the right selectors. New pages should be standalone HTML files.\n- Never invent business facts, reviews, credentials, or contact info.\n- If the request requires a new page, create it matching the site's existing style, and link it from the nav if one exists.\n- Return EVERY file you changed or created, in full, wrapped exactly as <file path="...">...</file>. Return nothing else. If the request cannot be done safely, return <error>reason</error>.\n\n${fileBlocks}` }],
    }),
  });
  const json = await res.json();
  if (!res.ok) { console.error("API ERROR:", JSON.stringify(json).slice(0, 400)); process.exit(1); }

  const text = (json.content || []).map((c) => c.text || "").join("");
  fs.writeFileSync(path.join(OUT_DIR, "editor-raw-output.txt"), text);

  console.log("--- THE FIELDS site-editor.js DISCARDS ---");
  console.log("  stop_reason :", json.stop_reason);
  console.log("  usage       :", JSON.stringify(json.usage));
  console.log("\n--- what parseEditorOutput() sees ---");
  console.log("  output chars        :", text.length);
  console.log('  count of "<file path=":', (text.match(/<file path="/g) || []).length);
  console.log('  count of "</file>"   :', (text.match(/<\/file>/g) || []).length);
  console.log("  has <error> block    :", /<error>/.test(text));
  const re = /<file path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  const matched = [];
  let m; while ((m = re.exec(text))) matched.push(m[1]);
  console.log("  regex-complete files :", matched.length, JSON.stringify(matched));
  console.log("\n  first 200 chars:", JSON.stringify(text.slice(0, 200)));
  console.log("  last  200 chars:", JSON.stringify(text.slice(-200)));

  console.log("\n--- VERDICT ---");
  if (json.stop_reason === "max_tokens" && matched.length === 0) {
    console.log("  CONFIRMED: the model was CUT OFF at the 16000-token ceiling before it");
    console.log("  could emit the closing </file>. parseEditorOutput()'s regex requires");
    console.log("  that closing tag, so it matches zero files and throws");
    console.log('  "editor returned no files". The edit can never succeed on a file this');
    console.log("  large under a full-file-rewrite contract.");
  } else {
    console.log("  stop_reason=" + json.stop_reason + ", matched=" + matched.length + " — see raw output.");
  }
  console.log(`\nwrote ${path.join(OUT_DIR, "editor-raw-output.txt")}`);
}

main().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
