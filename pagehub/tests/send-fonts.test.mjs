import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sendHandler = require("../api/send-intake-packet.js");

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  return {
    complete,
    response: {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      end() { resolve({ status: this.statusCode }); return this; }
    }
  };
}

test("send attachment brand.json preserves nested fonts when compiled brand exists", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.RESEND_FROM_EMAIL = "test@example.com";
  process.env.INTAKE_GENIE_TOKEN = "send-fonts-auth-token";

  const outbound = [];
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    outbound.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: "mock-message-id" }) };
  };

  try {
    for (const brand of [
      { fonts: { display: "", body: "", href: "" } },
      { fonts: { display: "Fraunces", body: "Inter", href: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter" } },
      { headingFont: "Playfair Display", bodyFont: "Roboto", fontHref: "https://fonts.example/legacy" }
    ]) {
      const { response, complete } = captureResponse();
      await sendHandler({
        method: "POST",
        headers: {
          origin: "https://pagehub-intake-lock-form.vercel.app",
          authorization: "Bearer send-fonts-auth-token"
        },
        body: {
          packet: {
            packetName: "Font contract fixture",
            business: { businessName: "Fixture Business" },
            brand,
            compiled: { brand: { logoSource: "assets/logo-primary.webp" } },
            requirements: {},
            sources: {},
            pagePlan: []
          }
        }
      }, response);
      const result = await complete;
      assert.equal(result.status, 200);
    }

    assert.equal(outbound.length, 3);
    const expectedFonts = [
      { display: "", body: "", href: "" },
      { display: "Fraunces", body: "Inter", href: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter" },
      { display: "Playfair Display", body: "Roboto", href: "https://fonts.example/legacy" }
    ];
    for (let index = 0; index < outbound.length; index += 1) {
      const attachment = outbound[index].attachments.find(item => /brand\.json$/i.test(item.filename));
      assert.ok(attachment, "brand.json attachment should exist");
      const brand = JSON.parse(Buffer.from(attachment.content, "base64").toString("utf8"));
      assert.deepEqual(brand.fonts, expectedFonts[index]);
      assert.equal(brand.logoSource, "assets/logo-primary.webp");
    }

    const legacyPrompt = outbound[2].attachments.find(item => /00-SINGLE-PASS-RESKIN-PACKET\.md$/i.test(item.filename));
    assert.ok(legacyPrompt, "single-pass prompt attachment should exist");
    assert.match(
      Buffer.from(legacyPrompt.content, "base64").toString("utf8"),
      /Playfair Display display; Roboto body; https:\/\/fonts\.example\/legacy/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});
