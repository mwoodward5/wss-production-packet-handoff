"use strict";
// scripts/fleet-photo-coverage.js — how many of the photographs a live mirror
// SERVES are the client's own, measured from the bytes on the wire.
//
// WHY BYTES AND NOT URLS. The engine does not hotlink a client photograph; it
// OVERWRITES the donor's own image file at the donor's declared photo_slot
// (lib/mirror-engine/engine.js, the photo_slots block). The served URL is
// therefore identical whether the picture is the client's or the donor's stock,
// and any probe that counts image URLs — or trusts a build report — cannot tell
// the two apart. What CAN tell them apart is the file itself: we ship the donor
// in this repo, so the donor's byte-for-byte original is on disk.
//
//   sha256(served slot) === sha256(donors-clean/<donor>/<slot>)   -> donor stock
//   sha256 differs                                                -> the client's own
//   404                                                           -> slot not served
//
// That comparison is independent of the build, of the store, and of the photo
// bank. It agrees with none of them by construction, which is the point: it can
// catch the engine reporting "placed" for a picture no visitor will ever see.
//
//   node scripts/fleet-photo-coverage.js --out artifacts/photo-coverage-before.json
//   node scripts/fleet-photo-coverage.js --hosts a.wss-ai.com,b.wss-ai.com
//   node scripts/fleet-photo-coverage.js --limit 20
//
// A host whose donor declares NO photo slots is reported as such, by name. It
// is not a harvest failure and must never be counted as one: no photograph of
// theirs can reach that site until the donor declares somewhere to put it.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const DONOR_DIR = path.join(ROOT, "donors-clean");

const arg = (name, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] || "true") : fallback;
};
const LIMIT = Number(arg("limit", "0")) || 0;
const ONLY = arg("hosts", "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = arg("out", "artifacts/photo-coverage.json");
const CONCURRENCY = Number(arg("concurrency", "6")) || 6;
const TIMEOUT_MS = Number(arg("timeout", "20000")) || 20000;

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** Every clean donor, its declared photo slots, and the sha of each on disk. */
function loadDonors() {
  const donors = [];
  for (const name of fs.readdirSync(DONOR_DIR)) {
    const manifestPath = path.join(DONOR_DIR, name, "BOILERPLATE.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { continue; }
    const slots = [];
    for (const rel of manifest.photo_slots || []) {
      const onDisk = path.join(DONOR_DIR, name, rel);
      slots.push({
        rel,
        sha: fs.existsSync(onDisk) ? sha(fs.readFileSync(onDisk)) : "",
        bytes: fs.existsSync(onDisk) ? fs.statSync(onDisk).size : 0,
      });
    }
    donors.push({ name, vertical: manifest.vertical || "", slots });
  }
  return donors;
}

async function get(url, { method = "GET" } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, signal: ctl.signal, redirect: "follow" });
    if (method === "HEAD" || !res.ok) return { status: res.status, buf: null };
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    return { status: 0, error: String(e.message || e).slice(0, 80), buf: null };
  } finally { clearTimeout(timer); }
}

/**
 * Which donor is this host built from? Asked by fetching one declared slot per
 * donor: the slot names are content-hashed by the donor's own bundler, so a
 * 200 on `assets/hero-technician-BWt1565e.jpg` identifies hvac-premier and
 * nothing else. A host that answers for no donor is reported as unknown rather
 * than guessed at.
 */
async function identifyDonor(host, donors) {
  for (const d of donors) {
    if (!d.slots.length) continue;
    const r = await get(`https://${host}/${d.slots[0].rel}`, { method: "HEAD" });
    if (r.status === 200) return d;
  }
  return null;
}

async function probeHost(host, donors) {
  const home = await get(`https://${host}/`);
  if (home.status !== 200) {
    return { host, live: false, status: home.status, error: home.error || "", donor: "", slots: 0, client_photos: 0, donor_stock: 0, missing: 0 };
  }
  const donor = await identifyDonor(host, donors);
  if (!donor) {
    return { host, live: true, donor: "", donor_unknown: true, slots: 0, client_photos: 0, donor_stock: 0, missing: 0, note: "no clean donor's photo slots answer on this host" };
  }
  if (!donor.slots.length) {
    return { host, live: true, donor: donor.name, slots: 0, client_photos: 0, donor_stock: 0, missing: 0, note: `donor ${donor.name} declares no photo slots — no photograph of theirs can reach this site` };
  }
  let client = 0; let stock = 0; let missing = 0;
  const detail = [];
  for (const slot of donor.slots) {
    const r = await get(`https://${host}/${slot.rel}`);
    if (r.status !== 200 || !r.buf) { missing++; detail.push({ slot: slot.rel, verdict: "not_served", status: r.status }); continue; }
    const served = sha(r.buf);
    if (slot.sha && served === slot.sha) { stock++; detail.push({ slot: slot.rel, verdict: "donor_stock" }); } else { client++; detail.push({ slot: slot.rel, verdict: "client_own", bytes: r.buf.length, sha: served.slice(0, 12) }); }
  }
  return {
    host, live: true, donor: donor.name, vertical: donor.vertical,
    slots: donor.slots.length, client_photos: client, donor_stock: stock, missing, detail,
  };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

(async () => {
  const donors = loadDonors();
  process.stderr.write(`donors ${donors.length}; slots ${donors.reduce((a, d) => a + d.slots.length, 0)}\n`);

  let hosts = ONLY;
  if (!hosts.length) {
    const backfill = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "photo-bank-backfill.json"), "utf8"));
    hosts = backfill.results.map((r) => r.host);
  }
  if (LIMIT) hosts = hosts.slice(0, LIMIT);

  const results = await mapLimit(hosts, CONCURRENCY, async (h, i) => {
    const r = await probeHost(h, donors);
    process.stderr.write(
      `${String(i + 1).padStart(4)}/${hosts.length} ${h.padEnd(60)} ${(r.donor || (r.live ? "unknown-donor" : "OFFLINE")).padEnd(24)} `
      + `client=${r.client_photos}/${r.slots}${r.missing ? ` missing=${r.missing}` : ""}\n`,
    );
    return r;
  });

  const liveRows = results.filter((r) => r.live);
  const summary = {
    hosts: results.length,
    live: liveRows.length,
    offline: results.length - liveRows.length,
    with_client_photography: liveRows.filter((r) => r.client_photos > 0).length,
    zero_client_photography: liveRows.filter((r) => r.client_photos === 0).length,
    donor_declares_no_slots: liveRows.filter((r) => r.slots === 0 && r.donor).length,
    donor_unknown: liveRows.filter((r) => r.donor_unknown).length,
    total_client_photos: liveRows.reduce((a, r) => a + r.client_photos, 0),
    total_donor_stock: liveRows.reduce((a, r) => a + r.donor_stock, 0),
    mean_client_photos: (liveRows.reduce((a, r) => a + r.client_photos, 0) / (liveRows.length || 1)).toFixed(2),
  };
  const out = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ measured_at: new Date().toISOString(), summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
