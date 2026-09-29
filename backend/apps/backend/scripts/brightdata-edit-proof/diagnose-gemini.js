"use strict";
// scripts/brightdata-edit-proof/diagnose-gemini.js
//
// The Anthropic key in .fable-proof.env is invalid, so site-editor.js's
// applyInstructionWithClaude() catches authentication_error and falls back to
// editWithGemini(). GEMINI IS THEREFORE THE EDITOR THAT ACTUALLY RAN.
//
// This replays that exact call (same model, same maxOutputTokens, same prompt)
// and reports finishReason + usageMetadata — the fields editWithGemini()
// discards before throwing "editor returned no files".

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("./env");
loadEnv();

const { listAll, download } = require("../../lib/site-editor");

const SLUG = "wss-test-flint-plumbing-s5";
const OUT_DIR = path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");
const TEXT_EXT = /\.(html?|css|js|json|svg|txt|xml)$/i;

async function main() {
  // 0. Prove the Anthropic fallback trigger is real, not assumed.
  const probe = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
  });
  const probeJson = await probe.json();
  console.log("--- 0. Anthropic key probe (explains the fallback) ---");
  console.log("  http", probe.status, "error.type =", probeJson?.error?.type);
  console.log("  -> site-editor.js line 115 routes this to editWithGemini()\n");

  const rels = await listAll(SLUG);
  const editable = [];
  for (const rel of rels) {
    const buf = await download(SLUG, rel);
    if (TEXT_EXT.test(rel) && buf.length < 200_000 && !rel.startsWith("assets/")) {
      editable.push({ rel, text: buf.toString("utf8") });
    }
  }
  const fileBlocks = editable.map(({ rel, text }) => `<file path="${rel}">\n${text}\n</file>`).join("\n\n");
  const instruction = require(path.join(OUT_DIR, "run-edit-result.json")).instruction;
  const prompt = `You are a precise website editor. Apply this customer request to the site files below:\n\nREQUEST: ${instruction}\n\nRules:\n- Change ONLY what the request requires. Do not restyle, reformat, or "improve" anything else.\n- The site is a compiled SPA; page content lives in JS bundles you cannot see. Achieve visual changes (sizes, colors, spacing) by adding a clearly-commented <style> override block in index.html targeting the right selectors. New pages should be standalone HTML files.\n- Never invent business facts, reviews, credentials, or contact info.\n- If the request requires a new page, create it matching the site's existing style, and link it from the nav if one exists.\n- Return EVERY file you changed or created, in full, wrapped exactly as <file path="...">...</file>. Return nothing else. If the request cannot be done safely, return <error>reason</error>.\n\n${fileBlocks}`;

  console.log("--- 1. Replaying editWithGemini() exactly ---");
  console.log("  model=gemini-2.5-flash  maxOutputTokens=16000");
  console.log(`  index.html is ${editable.find((f) => f.rel === "index.html").text.length} bytes; returning it IN FULL costs ~15900 output tokens\n`);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16000 } }),
  });
  const json = await res.json();
  if (!res.ok) { console.error("GEMINI API ERROR:", JSON.stringify(json).slice(0, 500)); process.exit(1); }

  const cand = (json.candidates || [])[0] || {};
  const text = ((cand.content?.parts) || []).map((p) => p.text || "").join("");
  fs.writeFileSync(path.join(OUT_DIR, "gemini-raw-output.txt"), text);

  console.log("--- 2. THE FIELDS editWithGemini() DISCARDS ---");
  console.log("  finishReason  :", cand.finishReason);
  console.log("  usageMetadata :", JSON.stringify(json.usageMetadata));
  console.log("  parts returned:", (cand.content?.parts || []).length);

  console.log("\n--- 3. what parseEditorOutput() sees ---");
  console.log("  output chars           :", text.length);
  console.log('  count of \'<file path="\':', (text.match(/<file path="/g) || []).length);
  console.log("  count of '</file>'      :", (text.match(/<\/file>/g) || []).length);
  console.log("  has <error> block       :", /<error>/.test(text));
  const re = /<file path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  const matched = []; let m;
  while ((m = re.exec(text))) matched.push(m[1]);
  console.log("  regex-COMPLETE files    :", matched.length, JSON.stringify(matched));
  console.log("\n  first 160 chars:", JSON.stringify(text.slice(0, 160)));
  console.log("  last  160 chars:", JSON.stringify(text.slice(-160)));

  const thoughts = json.usageMetadata?.thoughtsTokenCount || 0;
  const outTok = json.usageMetadata?.candidatesTokenCount || 0;
  console.log("\n--- 4. VERDICT ---");
  console.log(`  thinking tokens burned : ${thoughts}`);
  console.log(`  answer tokens produced : ${outTok}`);
  console.log(`  budget                 : 16000`);
  if (cand.finishReason === "MAX_TOKENS" && matched.length === 0) {
    console.log("\n  CONFIRMED ROOT CAUSE: the response hit the 16000-token ceiling before");
    console.log("  emitting a closing </file>. parseEditorOutput()'s regex REQUIRES that");
    console.log("  closing tag, so it matches 0 files and throws 'editor returned no");
    console.log("  files'. index.html alone needs ~15.9k output tokens under the");
    console.log("  return-every-file-IN-FULL contract — the budget cannot fit it.");
  } else {
    console.log(`\n  finishReason=${cand.finishReason}, complete files=${matched.length} — inspect gemini-raw-output.txt`);
  }
  console.log(`\nwrote ${path.join(OUT_DIR, "gemini-raw-output.txt")}`);
}

main().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
