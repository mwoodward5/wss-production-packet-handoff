"use strict";
// Which industry strings does the REAL donor resolver accept? Asked of the
// resolver itself, not of a map I wrote from memory.
require("./brightdata-edit-proof/env").loadEnv();
const { resolveBuildableDonor } = require("../lib/lead-miner");
const CANDIDATES = [
  "hvac", "plumbing", "roofing", "fencing", "landscaping", "concrete",
  "electrical", "electrician", "tattoo", "salon", "nail salon", "hair salon",
  "medspa", "med spa", "medical spa", "auto detailing", "tree service",
  "general contractor", "dental", "handyman & remodeling", "landscaping & hardscaping",
];
for (const c of CANDIDATES) {
  const r = resolveBuildableDonor(c);
  console.log(`${c.padEnd(28)} ${r.ok ? `OK  donor=${r.donor} vertical=${r.vertical} via=${r.via}` : `NO  ${r.reason}`}`);
}
