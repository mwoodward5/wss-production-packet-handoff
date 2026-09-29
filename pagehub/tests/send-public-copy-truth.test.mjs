import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sendHandler = require("../api/send-intake-packet.js");

test("owner email and run sheets separate visitor copy from private source research", async () => {
  const old = {
    fetch: globalThis.fetch,
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    token: process.env.INTAKE_GENIE_TOKEN
  };
  process.env.RESEND_API_KEY = "mock-key";
  process.env.RESEND_FROM_EMAIL = "sender@example.com";
  process.env.INTAKE_GENIE_TOKEN = "mock-owner-token";
  let outbound;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    outbound = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ id: "mock-id" }) };
  };
  try {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const response = {
      setHeader() {}, status(code) { this.code = code; return this; },
      json(body) { finish({ code: this.code, body }); return this; },
      end() { finish({ code: this.code }); return this; }
    };
    const packet = {
      packetName: "Visitor Copy Truth",
      business: { businessName: "Air Masters" },
      brand: {}, requirements: {}, sources: {}, pagePlan: [],
      compiled: {
        compileJob: { status: "complete" },
        proofSummary: { status: "compiled_needs_review", contentFiles: 2, contentWords: 27188 },
        templateReport: { status: "compiled_needs_review", counts: { contentFiles: 2, contentWords: 27188 } },
        contentFiles: {
          "content/home.md": "Verified public copy",
          "content/source/original.md": "Private raw research"
        },
        // Legacy shape intentionally reports combined volume. Sender must not
        // present it as finished page copy.
        contentQuality: {
          totalFiles: 2, totalWords: 27188, passCount: 1, reviewCount: 1,
          files: [
            { file: "content-home.md", sourcePath: "content/home.md", kind: "generated_copy", wordCount: 932, status: "pass" },
            { file: "content-source-original.md", sourcePath: "content/source/original.md", kind: "source_archive", wordCount: 26256, status: "review" }
          ]
        }
      }
    };
    await sendHandler({
      method: "POST",
      headers: { origin: "http://localhost:18900", authorization: "Bearer mock-owner-token" },
      body: { packet }
    }, response);
    assert.equal((await done).code, 200);
    assert.equal(outbound.to.length, 1, "owner-only recipient remains unchanged");
    assert.match(outbound.text, /Visitor page copy: 1 files, 932 words/);
    assert.match(outbound.text, /1 passing, 0 review/);
    assert.match(outbound.text, /Private source archive: 1 files, 26256 words/);
    assert.doesNotMatch(outbound.text, /Generated content: 2 files, 27188 words/);
    const attachmentText = name => {
      const item = outbound.attachments.find(row => row.filename.endsWith(name));
      assert.ok(item, `${name} attached`);
      return Buffer.from(item.content, "base64").toString("utf8");
    };
    const preflight = attachmentText("00-CREDIT-SAVER-PREFLIGHT.md");
    assert.match(preflight, /Visitor copy words expected: 932/);
    assert.match(preflight, /Private source archive: 1 files, 26256 words; research only/);
    assert.doesNotMatch(preflight, /original\.md: 26256 words/);
    assert.match(attachmentText("WSS-BUILD-PROMPT.md"), /private source archive|Private source archive/i);
    assert.match(attachmentText("content-source-original.md"), /Private raw research/);
    const proof = JSON.parse(attachmentText("proof-compiler-summary.json"));
    assert.equal(proof.contentWords, 932);
    assert.equal(proof.sourceArchiveWords, 26256);
    const templateReport = JSON.parse(attachmentText("template-build-pack-report.json"));
    assert.equal(templateReport.counts.contentWords, 932);
    assert.equal(templateReport.counts.sourceArchiveWords, 26256);
  } finally {
    globalThis.fetch = old.fetch;
    for (const [name, value] of [["RESEND_API_KEY", old.key], ["RESEND_FROM_EMAIL", old.from], ["INTAKE_GENIE_TOKEN", old.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
