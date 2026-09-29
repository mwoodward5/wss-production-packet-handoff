"use strict";
// scripts/universal-edit-proof/plan-only.js — ask the planner for a PLAN and
// print it. Touches nothing: no upload, no deploy. This is the step that shows
// whether the intent->plan half works before any byte of a live site moves.
//
//   node scripts/universal-edit-proof/plan-only.js "<instruction>"

const path = require("node:path");
require(path.join(__dirname, "..", "brightdata-edit-proof", "env.js")).loadEnv();

const { listAll, download } = require("../../lib/site-editor");
const { parseSiteFacts } = require("../../lib/seo-page-edit");
const plan = require("../../lib/site-change-plan");

const SLUG = process.env.PROOF_SLUG || "wss-test-flint-plumbing-s5";
const TEXT_EXT = /\.(html?|css|js|json|svg|txt|xml)$/i;

(async () => {
  const instruction = process.argv[2] || "Show our Google rating at the top of the reviews section.";
  const rels = await listAll(SLUG);
  const fileTexts = {};
  for (const rel of rels) {
    if (!TEXT_EXT.test(rel) || rel.startsWith("assets/")) continue;
    fileTexts[rel] = (await download(SLUG, rel)).toString("utf8");
  }
  const facts = parseSiteFacts({ llms: fileTexts["llms.txt"], index: fileTexts["index.html"] });
  const rating = (fileTexts["llms.txt"] || "").match(/^-\s*Rating:\s*(.+)$/im);
  facts.rating = rating ? rating[1].trim() : "";
  const anchors = plan.buildAnchorCatalog(fileTexts);
  const prompt = `${plan.PLAN_CONTRACT}\n\n${plan.buildPlannerContext({ facts, rels: Object.keys(fileTexts), anchors })}\n\nCUSTOMER REQUEST: ${instruction}`;

  console.log(`prompt chars: ${prompt.length}  (the old path sent ~80,000 and asked for whole files back)`);
  const raw = await plan.__planner(prompt);
  console.log(`raw response chars: ${raw.length}`);
  console.log("--- RAW ---");
  console.log(raw.slice(0, 4000));
  console.log("--- PARSED ---");
  console.log(JSON.stringify(plan.parsePlan(raw), null, 2));
})().catch((e) => { console.error("PLAN FAILED:", e.message); process.exit(1); });
