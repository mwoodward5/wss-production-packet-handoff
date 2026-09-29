"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyBrandToCss } = require("../lib/capture-brand");

test("brand recolor never rewrites CSS comments or consumes the declaration after them", () => {
  const input = `/* Docs only: a donor stores its accent like --accent: H S% L%.\n   This sentence has no CSS meaning and must remain byte-for-byte unchanged. */\n:root {\n  --accent: 146 38% 31%;\n  --accent-glow: 146 44% 42%;\n}\n.hero { color: hsl(146 38% 31%); }`;
  const comment = input.slice(0, input.indexOf(":root"));
  const out = applyBrandToCss(input, { accent: "#055539" });
  assert.ok(out.changed >= 2);
  assert.equal(out.css.slice(0, out.css.indexOf(":root")), comment);
  assert.match(out.css, /:root\s*\{[\s\S]*--accent:\s*159\s+89%\s+18%;/);
  assert.match(out.css, /--accent-glow:\s*159\s+89%\s+14%;/);
});
