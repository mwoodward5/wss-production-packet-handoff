#!/usr/bin/env node
"use strict";

// scripts/local-line-poll.cjs — poll the newest/active Line batch in the
// local-first stack. Node-only so the batch id never transits a shell.
//
//   node scripts/local-line-poll.cjs [GHOST_AGENCY_ADMIN_TOKEN]

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const token = process.argv[2]
  || (fs.existsSync(path.join(__dirname, "..", ".env.local"))
    && (fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").match(/^GHOST_AGENCY_ADMIN_TOKEN=(.*)$/m) || [])[1]);

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "localhost", port: 3000, path: p, headers: { "x-admin-token": token } }, (r) => {
      let s = "";
      r.on("data", (c) => (s += c));
      r.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

(async () => {
  const list = await get("/api/admin/line");
  const batches = list.batches || [];
  const summary = (b) => `${String(b.batchId).slice(0, 14)} ${b.status} rows=${(b.rows || []).length}`;
  const active = batches.find((x) => ["building", "running"].includes(x.status));
  const target = active || batches[0];
  if (!target) { console.log("no batches"); return; }
  const full = await get("/api/admin/line?batchId=" + encodeURIComponent(target.batchId));
  const b = full.batch || {};
  console.log(new Date().toISOString(), summary(b));
  const counts = {};
  for (const r of b.rows || []) counts[r.status || "?"] = (counts[r.status || "?"] || 0) + 1;
  console.log("row states:", JSON.stringify(counts));
  for (const r of b.rows || []) {
    console.log(" row:", String(r.businessName || r.business_name || "?").slice(0, 38), "|", r.status);
  }
  for (const s of (b.mineFunnel || []).slice(-3)) {
    console.log(" funnel:", s.stage, "in", s.entered, "out", s.survived);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
