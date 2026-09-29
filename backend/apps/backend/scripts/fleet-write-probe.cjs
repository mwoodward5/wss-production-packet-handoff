// One-shot diagnostic: run the REAL store.recordEvent against production env.
// Prints only the result object — never the credentials.
const path = require("path");
const fs = require("fs");
{
  const envPath = path.join(__dirname, "..", ".....env.prod.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const store = require("../lib/store");

(async () => {
  const t0 = Date.now();
  const result = await store.recordEvent("probe.events_write", {
    probe: true,
    at: new Date().toISOString(),
    note: "fleet-write diagnostic 2026-09-01",
  });
  const safe = JSON.parse(JSON.stringify(result, (k, v) => (k === "row" ? { id: v && v.id, type: v && v.type } : v)));
  console.log(JSON.stringify({ elapsedMs: Date.now() - t0, result: safe }, null, 1));
  process.exit(safe && safe.mode === "live_write" ? 0 : 1);
})().catch((e) => { console.error("PROBE_THREW", String((e && e.message) || e).slice(0, 300)); process.exit(2); });
