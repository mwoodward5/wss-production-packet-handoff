"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { auditPacket, firstParagraph } = require("./packet-audit.cjs");

const hex = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const DESC = "We pour, patch, and resurface driveways — fast.";
function packet(overrides = {}) {
  return {
    facts: {
      category: "concrete",
      services: [{ name: "Concrete Repair", description: DESC, file: "content/services/concrete-repair.md" }],
    },
    files: {
      "content/home.md": "# Home\n",
      "content/about.md": "# About\n",
      "content/services/concrete-repair.md": `${DESC}\n\nAdditional sourced detail.`,
    },
    ...overrides,
  };
}
const codes = (r) => r.issues.map((i) => i.code);
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

test("exact UTF-8 first-paragraph binding passes and reports hashes without claiming provenance", () => {
  const p = deepFreeze(packet());
  const before = JSON.stringify(p);
  const r = auditPacket(p);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.services[0].status, "bound");
  assert.equal(r.services[0].fileSha256, hex(p.files["content/services/concrete-repair.md"]));
  assert.equal(r.files["content/home.md"].sha256, hex("# Home\n"));
  assert.equal(r.files["content/services/concrete-repair.md"].utf8Bytes,
    Buffer.byteLength(p.files["content/services/concrete-repair.md"], "utf8"));
  assert.equal(r.home.present, true);
  assert.equal(r.about.present, true);
  assert.equal(r.provenance.sourceAuthenticity, "unverified");
  assert.equal(r.productionApproval, "not_assessed");
  assert.equal(JSON.stringify(p), before, "input unchanged");
});

test("single-paragraph file binds; one terminal newline is not part of the paragraph", () => {
  assert.equal(firstParagraph("A.\n"), "A.");
  assert.equal(firstParagraph("A.\r\n"), "A.");
  assert.equal(firstParagraph("A.\n\n\nB"), "A.");
  const p = packet();
  p.files["content/services/concrete-repair.md"] = `${DESC}\n`;
  assert.equal(auditPacket(p).ok, true);
});

test("changed punctuation, whitespace, or Unicode form is a mismatch, never normalized", () => {
  const variants = [
    DESC.replace("—", "-"),
    DESC.replace("driveways", "driveways "),
    DESC.replace(".", "!"),
    ` ${DESC}`,
    DESC.normalize("NFD").replace("We", "W\u0065\u0301"),
  ];
  for (const text of variants) {
    const p = packet();
    p.files["content/services/concrete-repair.md"] = `${text}\n\nMore.`;
    const r = auditPacket(p);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.ok(codes(r).includes("service_description_mismatch"));
    assert.equal(r.services[0].firstParagraphMatches, false);
  }
});

test("CRLF inside the paragraph does not match an LF description", () => {
  const desc = "Line one\nline two";
  const p = packet();
  p.facts.services[0].description = desc;
  p.files["content/services/concrete-repair.md"] = "Line one\r\nline two\r\n\r\nMore.";
  assert.ok(codes(auditPacket(p)).includes("service_description_mismatch"));
  p.facts.services[0].description = "Line one\r\nline two";
  assert.equal(auditPacket(p).ok, true, "exact CRLF bytes on both sides do bind");
});

test("duplicate and case-colliding service paths are reported", () => {
  const p = packet();
  p.facts.services.push({ name: "Patching", description: DESC, file: "content/services/concrete-repair.md" });
  p.facts.services.push({ name: "Other", description: DESC, file: "content/services/Concrete-Repair.md" });
  p.files["content/services/Concrete-Repair.md"] = DESC;
  const r = auditPacket(p);
  assert.ok(codes(r).includes("duplicate_service_path"));
  assert.ok(codes(r).includes("service_path_case_collision"));
  assert.equal(r.services[1].status, "invalid");
});

test("missing files, non-string files, empty descriptions and malformed shapes fail closed", () => {
  const p = packet();
  p.facts.services = [
    { name: "Missing", description: "x", file: "content/services/missing.md" },
    { name: "NotString", description: "x", file: "content/services/n.md" },
    { name: "Empty", description: "   ", file: "content/services/concrete-repair.md" },
    { name: "", description: "x", file: "content/services/concrete-repair.md" },
    "Concrete Repair",
    null,
  ];
  p.files["content/services/n.md"] = { text: "x" };
  const c = codes(auditPacket(p));
  for (const code of ["service_file_missing", "service_file_not_string", "file_not_string",
    "service_description_empty", "service_name_missing", "service_malformed"]) {
    assert.ok(c.includes(code), code);
  }
  assert.ok(codes(auditPacket(null)).includes("packet_malformed"));
  assert.ok(codes(auditPacket({ facts: [], files: "x" })).includes("facts_malformed"));
  assert.ok(codes(auditPacket({ facts: { category: "c", services: {} }, files: {} })).includes("services_not_array"));
});

test("unsafe service paths are refused", () => {
  for (const [file, reason] of [
    ["../content/services/x.md", "traversal_or_empty_segment"],
    ["content/services/../home.md", "traversal_or_empty_segment"],
    ["/content/services/x.md", "absolute_path"],
    ["C:/content/services/x.md", "absolute_path"],
    ["content\\services\\x.md", "backslash_separator"],
    ["content/home.md", "outside_service_dir"],
    ["content/services/x.html", "not_markdown"],
    ["https://evil.example/content/services/x.md", "absolute_path"],
  ]) {
    const p = packet();
    p.facts.services[0].file = file;
    p.files[file] = DESC;
    const issue = auditPacket(p).issues.find((i) => i.code === "service_path_unsafe");
    assert.equal(issue?.detail.reason, reason, file);
  }
});

test("absent home/about and absent channels are reported as absent, not as empty facts", () => {
  const p = packet();
  delete p.files["content/home.md"];
  delete p.files["content/about.md"];
  const r = auditPacket(p);
  assert.equal(r.home.present, false);
  assert.equal(r.about.present, false);
  for (const ch of ["reviews", "faqs", "hours", "areas"]) {
    assert.equal(r.channels.byChannel[ch].state, "not_declared");
    assert.equal(r.channels.byChannel[ch].itemCount, null);
  }
});

test("channel envelope: available, unavailable, and inconsistent declarations stay distinct", () => {
  const r = auditPacket(packet({ channels: {
    reviews: { status: "available", items: [{ text: "Great" }] },
    faqs: { status: "unavailable" },
    hours: { status: "unavailable", items: [{ day: "Mon" }] },
    areas: { status: "available", items: [] },
  } }));
  assert.deepEqual(r.channels.byChannel.reviews, { state: "available", itemCount: 1, itemsVerified: false });
  assert.equal(r.channels.byChannel.faqs.state, "unavailable");
  assert.equal(r.channels.byChannel.hours.state, "inconsistent");
  assert.equal(r.channels.byChannel.areas.state, "inconsistent");
  assert.ok(codes(r).includes("channel_unavailable_with_items"));
  assert.ok(codes(r).includes("channel_available_without_items"));

  const missingItems = auditPacket(packet({ channels: { reviews: { status: "available" } } }));
  assert.equal(missingItems.channels.byChannel.reviews.state, "inconsistent");
  const bogus = auditPacket(packet({ channels: { faqs: { status: "maybe" }, extra: {} } }));
  assert.equal(bogus.channels.byChannel.faqs.state, "malformed");
  assert.deepEqual(bogus.channels.unrecognized, ["extra"]);
  assert.ok(codes(auditPacket(packet({ channels: [] }))).includes("channels_malformed"));
});

test("unreferenced service files are listed but not treated as services", () => {
  const p = packet();
  p.files["content/services/orphan.md"] = "Orphan.";
  const r = auditPacket(p);
  assert.deepEqual(r.unreferencedServiceFiles, ["content/services/orphan.md"]);
  assert.equal(r.services.length, 1);
});
