"use strict";
// Stamp preview_url onto the rows for hosts built directly this session.
// The dispatch layer normally does this; buildMirrorForProspect alone does
// not, and the mailable scanner (correctly) refuses to verify a host it
// cannot match to a stored identity.
require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(q, init) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, {
    ...(init || {}),
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
      Prefer: "return=representation", ...((init || {}).headers || {}),
    },
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

const BY_NAME = [
  ["Benchmark Concrete", "https://wss-test-benchmark-concrete-columbus.wss-ai.com/"],
  ["Espinoza Concrete llc", "https://wss-test-espinoza-concrete-llc-alvarado.wss-ai.com/"],
  ["Azure Med Spa", "https://wss-test-azure-med-spa-frisco.wss-ai.com/"],
  ["Davis Roofing Solutions", "https://wss-test-davis-roofing-solutions-fort-worth.wss-ai.com/"],
  ["Landscape Connection", "https://wss-test-landscape-connection-inc-clovis.wss-ai.com/"],
  ["Cox Concrete", "https://wss-test-cox-concrete-and-excavation-chattanooga.wss-ai.com/"],
  ["Hernandez Iron Works", "https://wss-test-hernandez-iron-works-san-antonio.wss-ai.com/"],
];

(async () => {
  for (const [name, url] of BY_NAME) {
    const safe = encodeURIComponent(`%${name}%`);
    const q = await rest(`ghost_agency_prospects?select=id,business_name,preview_url&business_name=ilike.${safe}&limit=2`);
    const row = Array.isArray(q.body) ? q.body[0] : null;
    if (!row) { console.log(`no row: ${name}`); continue; }
    const res = await rest(`ghost_agency_prospects?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ preview_url: url }),
    });
    console.log(`${name}: ${row.preview_url || "(none)"} -> ${url} [${res.status}]`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
