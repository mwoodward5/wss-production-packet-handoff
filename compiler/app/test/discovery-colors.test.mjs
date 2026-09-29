import assert from "node:assert/strict";
import test from "node:test";

import { discoveryColorList } from "../lib/discovery.mjs";

test("discoveryColorList flattens semantic and nested branding colors", () => {
  const brandingColors = {
    primary: "#abc",
    secondary: ["#AABBCC", "#123456", "rgb(1, 2, 3)"],
    accent: {
      preferred: "#dE7800",
      duplicate: "#123456",
      alpha: "#12345678",
    },
    background: "#fff",
    invalid: "navy",
  };
  const original = structuredClone(brandingColors);

  const colors = discoveryColorList(brandingColors);

  assert.deepEqual(colors, ["#AABBCC", "#123456", "#DE7800", "#FFFFFF"]);
  assert.deepEqual(colors.slice(0, 3), ["#AABBCC", "#123456", "#DE7800"]);
  assert.deepEqual(brandingColors, original);
});

test("discoveryColorList canonicalizes array inputs and drops duplicates and invalid values", () => {
  assert.deepEqual(
    discoveryColorList([
      "#0a4",
      "#00AA44",
      { hex: "#445566" },
      [" #de7800 ", "#DE7800", null, 42],
      "transparent",
      "#1234",
      "#12345678",
    ]),
    ["#00AA44", "#445566", "#DE7800"],
  );
  assert.deepEqual(discoveryColorList(null), []);
});
