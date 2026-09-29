// Lane02 (intake-content) 2026-09-09 — packet fidelity: content bound to the
// certified source packet must survive into the visible page, and the
// business-truth stage must not silently empty a real service menu.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { design } from "../../factory/pipeline/04-design.mjs";
import { build } from "../../factory/pipeline/05-build-v8.mjs";
import { enforceBusinessTruth } from "../lib/business-truth.mjs";

function fidelityPacket() {
  // Mirrors the enrichment shape prepareTryOnPacket() produces from a
  // content-rich source intake (copy lines, founded year, attributed review).
  const firstPerson = "We have served the Bradenton area from our shop on Main Street since 2021, and our crew treats every home like our own.";
  return {
    slug: "probe-practical-plumbing",
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: { name: "Practical Plumbing", category: "plumbing", city: "Bradenton", state: "FL", phone: "(941) 281-5001" },
    services: ["Water Heater Installation", "Drain Cleaning", "Leak Detection"],
    media: { catalog: [] },
    enrichment_sources: {
      phone: { source: "source-intake", confidence: 0.9, value: "(941) 281-5001" },
      copy: { source: "source-intake", confidence: 0.8, value: "Practical Plumbing fixes leaks fast.\n" + firstPerson + "\nCall for same-day service." },
      years: { source: "site", confidence: 0.8, value: 5, founded: 2021 },
      reviews_attributed: {
        source: "site", confidence: 0.8,
        value: [{ author: "Dana M.", text: "They fixed our burst pipe the same afternoon we called, and the price matched the estimate exactly.", rating: null, source: "site" }],
      },
    },
  };
}

test("packet-bound content survives into the visible page", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "lane02-fidelity-"));
  try {
    const packet = fidelityPacket();
    // Same stage order as the preview flow: enrichment already merged, then
    // design (voice snippets), then the renderer build.
    design(packet);
    await build(packet, { outDir, capture: false });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8").toLowerCase();
    // Services render sentence-cased; compare case-insensitively.
    for (const service of packet.services) {
      assert.ok(html.includes(service.toLowerCase()), `service visible: ${service}`);
    }
    assert.ok(html.includes("treats every home like our own"), "first-person source copy visible");
    assert.ok(html.includes("5+"), "founded-year badge visible");
    assert.ok(html.includes("burst pipe"), "attributed testimonial text visible");
    assert.ok(html.includes("dana m."), "testimonial attribution visible");
    assert.ok(html.includes("(941) 281-5001") || html.includes("9412815001"), "official phone visible");
    const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
    assert.equal(publicPacket.services.length, 3);
    assert.equal(publicPacket.enrichment_sources.reviews_attributed.value[0].author, "Dana M.");
    assert.equal(publicPacket.enrichment_sources.years.value, 5);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("an allowlist-missed service stated on the certified source page survives business truth", () => {
  // 2026-09-09 lane02 finding: the four SERVICE_ALLOW verticals dropped real,
  // copy-evidenced services ("Siding Repair" at a roofing company) and could
  // empty the whole packet — the visible page then shipped with no services.
  const sourceFacts = {
    name: "Summit Roofing",
    category: "roofing",
    city: "Marietta",
    state: "GA",
    services: ["Siding Repair", "Skylight Installation"],
    copy: "Summit Roofing also handles siding repair and skylight installation for Marietta homes.",
  };
  const truth = enforceBusinessTruth({
    business: { name: sourceFacts.name, category: sourceFacts.category, city: sourceFacts.city, state: sourceFacts.state },
    services: sourceFacts.services,
    enrichment_sources: { copy: { source: "source-intake", confidence: 0.8, value: sourceFacts.copy } },
  }, { sourceFacts });
  assert.deepEqual(truth.services, ["Siding Repair", "Skylight Installation"]);
});

test("a donor service absent from source copy stays rejected even when evidence rows echo it", () => {
  // The recovery pass must key on source copy only. source_evidence rows
  // generated from the claimed services list echo that list back; a
  // self-referential recovery would re-admit contaminated packets.
  const sourceFacts = {
    name: "Peach Tree Landscapes",
    category: "landscaping",
    city: "Marietta",
    state: "GA",
    services: ["Lawn Care", "Chain Link Fencing"],
    copy: "Our landscaping crew handles lawn care, irrigation, and planting for Marietta yards.",
  };
  const truth = enforceBusinessTruth({
    business: { name: sourceFacts.name, category: sourceFacts.category, city: sourceFacts.city, state: sourceFacts.state },
    services: sourceFacts.services,
    source_evidence: [{ field: "services", value: ["Lawn Care", "Chain Link Fencing"], source_type: "source", verified: true }],
    enrichment_sources: { copy: { source: "source-intake", confidence: 0.8, value: sourceFacts.copy } },
  }, { sourceFacts });
  assert.deepEqual(truth.services, ["Lawn Care"]);
});
