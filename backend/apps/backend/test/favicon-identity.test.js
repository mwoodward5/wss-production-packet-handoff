"use strict";

// test/favicon-identity.test.js — the tab is identity, and it was borrowed.
//
// MEASURED 2026-08-10, live: wss-test-sears-heating-and-cooling-columbus and
// wss-test-air-creation-heating-and-cooling-llc-baton served a BYTE-IDENTICAL
// /favicon.ico (md5 9f504444, 20373 bytes) — the Lovable donor's file, copied
// through the build untouched. Two unrelated companies in different states
// flying the same flag. Same defect class as the manufacturer badge shipped as
// a client logo: ownership of the TEMPLATE is not ownership of the MARK.
//
// The load-bearing test is `two different businesses -> two different bytes`,
// and the subtle one is the PURGE: a favicon is served on a PATH the browser
// requests with no markup at all, so rewriting <link> tags while leaving the
// donor file on disk fixes nothing. Every test below measures the output tree,
// never the intent of the code.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const {
  applyFavicons, buildFavicons, initialsFrom,
  encodePng, encodeIco, normalizeSvgIcon, DONOR_ICON_RE,
} = require("../lib/mirror-engine/favicon");
const { decodePngToRgba } = require("../lib/png-decode");
const { loadDonor } = require("../lib/mirror-engine/donor");

const DONORS = path.join(__dirname, "..", "donors-clean");
const md5 = (b) => createHash("md5").update(b).digest("hex");

// Logo fixtures in the three shapes real marks come in. The shape decides
// whether an icon can be cut from the artwork at all, so the tests need all
// three — an earlier version of this file used one synthetic 2-tone bar for
// everything and hid the fact that a wordmark has no square form.
const blank = (w, h) => new Uint8Array(w * h * 4);
function paintRect(px, w, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
}
function paintDisc(px, w, cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
}

/** Square emblem, transparent margin around it — the easy case. */
function badgeLogo(outer, inner, w = 200, h = 200) {
  const px = blank(w, h);
  paintDisc(px, w, w / 2, h / 2, Math.round(w * 0.35), outer);
  paintRect(px, w, Math.round(w * 0.35), Math.round(h * 0.35), Math.round(w * 0.65), Math.round(h * 0.65), inner);
  return Buffer.from(encodePng(w, h, px));
}

/** Emblem + wordmark lockup: a wide gutter separates the symbol from the text. */
function lockupLogo(outer, inner) {
  const w = 300, h = 90, px = blank(w, h);
  paintDisc(px, w, 45, 45, 32, outer);
  paintRect(px, w, 30, 30, 60, 60, inner);
  for (let i = 0; i < 4; i++) paintRect(px, w, 110 + i * 45, 32, 110 + i * 45 + 34, 58, [30, 34, 40]);
  return Buffer.from(encodePng(w, h, px));
}

/** Pure horizontal wordmark: even letter spacing, no symbol anywhere. */
function wordmarkLogo(color = [12, 68, 154]) {
  const w = 320, h = 70, px = blank(w, h);
  for (let i = 0; i < 6; i++) paintRect(px, w, 12 + i * 52, 22, 12 + i * 52 + 40, 48, color);
  return Buffer.from(encodePng(w, h, px));
}

const htmlPage = (extra = "") =>
  Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${extra}<title>t</title></head><body><p>x</p></body></html>`, "utf8");

/* ------------------------------------------------------- the shipped defect */

test("the donor favicon that shipped live is gone, and two businesses differ", () => {
  // hvac-premier is one of the two donors carrying md5 9f504444.
  const donorTree = loadDonor(path.join(DONORS, "hvac-premier")).files;
  assert.equal(
    md5(donorTree["favicon.ico"]).slice(0, 8), "9f504444",
    "donor fixture drifted — this test is anchored to the file that actually shipped",
  );

  const built = {};
  for (const [name, accent] of [
    ["Sears Heating and Cooling", "#0f2742"],
    ["Air Creation Heating and Cooling LLC", "#b3541e"],
  ]) {
    const files = loadDonor(path.join(DONORS, "hvac-premier")).files;
    const out = applyFavicons({ files, logo: null, businessName: name, accent });
    assert.ok(out.report.clean, `${name}: ${JSON.stringify(out.report.residual_donor_icons)}`);

    // PURGE, not merely unlink: the donor bytes must not exist anywhere.
    for (const [rel, buf] of Object.entries(files)) {
      assert.notEqual(md5(buf).slice(0, 8), "9f504444", `donor favicon survived at ${rel}`);
    }
    // And /favicon.ico must still answer — with OUR bytes, since the browser
    // requests that path whether or not any markup points at it.
    assert.ok(files["favicon.ico"], "no /favicon.ico to serve the default request");
    built[name] = md5(files["favicon.ico"]);
  }

  const hashes = Object.values(built);
  assert.equal(new Set(hashes).size, hashes.length,
    `two businesses produced the same favicon bytes: ${JSON.stringify(built)}`);
});

test("two different client logos produce two different icons on the same donor", () => {
  // Same business name and same donor on purpose: if the icon followed either
  // of those instead of the logo, these would collide.
  const seen = [];
  for (const [a, b] of [[[12, 68, 154], [197, 63, 52]], [[20, 140, 90], [240, 200, 40]]]) {
    const files = loadDonor(path.join(DONORS, "roofing-falcon-clean")).files;
    applyFavicons({
      files, logo: { bytes: badgeLogo(a, b), ext: "png" },
      businessName: "Same Name Roofing", accent: "#c53f34",
    });
    seen.push(md5(files["favicon.ico"]));
  }
  assert.notEqual(seen[0], seen[1], "the icon does not follow the client's logo");
});

test("every donor is purged and re-iconed, on every page", () => {
  const donors = fs.readdirSync(DONORS)
    .filter((d) => fs.existsSync(path.join(DONORS, d, "index.html")));
  assert.ok(donors.length >= 10, "donor library missing");

  for (const donor of donors) {
    const files = loadDonor(path.join(DONORS, donor)).files;
    const out = applyFavicons({
      files, logo: null, businessName: "Ramon Roofing", accent: "#c53f34",
    });
    assert.ok(out.report.clean, `${donor}: residual ${JSON.stringify(out.report)}`);

    // No root-level icon file we did not author.
    const ours = new Set(out.report.emitted);
    for (const rel of Object.keys(files)) {
      if (rel.includes("/")) continue;
      if (DONOR_ICON_RE.test(rel)) assert.ok(ours.has(rel), `${donor}: stray icon ${rel}`);
    }
    // Every HTML page points at our icon — 404 and authority pages included.
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.html?$/i.test(rel)) continue;
      const text = buf.toString("utf8");
      assert.match(text, /href="\/favicon\.ico"/, `${donor}: ${rel} lost its icon`);
      assert.doesNotMatch(text, /rel="alternate icon"/i, `${donor}: ${rel} kept the donor alternate`);
    }
  }
});

test("a donor manifest cannot resurrect the borrowed mark on a home screen", () => {
  const files = loadDonor(path.join(DONORS, "medspa-luma")).files;
  const before = JSON.parse(files["site.webmanifest"].toString("utf8"));
  assert.ok(before.icons.some((i) => i.src === "/favicon.svg"), "fixture drifted");

  applyFavicons({ files, logo: null, businessName: "Luma Aesthetics", accent: "#217283" });
  const after = JSON.parse(files["site.webmanifest"].toString("utf8"));
  assert.deepEqual(after.icons.map((i) => i.src), ["/icon-192.png", "/icon-512.png"]);
  assert.equal(after.name, before.name, "manifest rewrite must not disturb other fields");
});

/* --------------------------------------------------------------- truth law */

test("no verified logo and no usable name ships NO icon, never a donor one", () => {
  for (const name of ["", "   ", "LLC & Co"]) {
    const out = buildFavicons({ logo: null, businessName: name, accent: "#c53f34" });
    assert.equal(Object.keys(out.files).length, 0, `invented a mark for ${JSON.stringify(name)}`);
    assert.equal(out.report.source, "none");
  }

  // And the seam still strips the donor's, leaving the path genuinely empty
  // rather than serving someone else's mark.
  const files = loadDonor(path.join(DONORS, "hvac-premier")).files;
  const out = applyFavicons({ files, logo: null, businessName: "", accent: null });
  assert.equal(files["favicon.ico"], undefined, "kept a borrowed icon rather than none");
  assert.ok(out.report.clean);
});

test("an undecodable logo falls to a monogram and SAYS so", () => {
  // JPEG/WebP have no pure-JS decoder in the serverless runtime. The rule is to
  // report the fallback, never to pretend the mark was used.
  const out = buildFavicons({
    logo: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), ext: "jpg" },
    businessName: "Cooper Perry", accent: "#c53f34",
  });
  assert.equal(out.report.raster_source, "monogram");
  assert.equal(out.report.initials, "CP");
  assert.ok(out.files["favicon.ico"]);
});

/* ------------------------------------------------------------- the artefacts */

test("the .ico is a real multi-size icon a browser can parse", () => {
  const files = { "index.html": htmlPage() };
  applyFavicons({ files, logo: null, businessName: "Ramon Roofing", accent: "#c53f34" });
  const ico = files["favicon.ico"];

  assert.equal(ico.readUInt16LE(0), 0, "reserved");
  assert.equal(ico.readUInt16LE(2), 1, "type must be icon");
  const count = ico.readUInt16LE(4);
  assert.equal(count, 3);

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const b = 6 + i * 16;
    const len = ico.readUInt32LE(b + 8);
    const off = ico.readUInt32LE(b + 12);
    assert.ok(off + len <= ico.length, "entry runs past the end of the file");
    const decoded = decodePngToRgba(Buffer.from(ico.subarray(off, off + len)));
    assert.ok(decoded, `entry ${i} is not a decodable image`);
    assert.equal(decoded.width, ico[b] || 256, "declared width disagrees with the payload");
    assert.equal(decoded.height, ico[b + 1] || 256);
    sizes.push(decoded.width);
  }
  assert.deepEqual(sizes, [16, 32, 48]);
});

/** Ink extent + dominant colours of a rendered icon. */
function inspect(pngBytes) {
  const img = decodePngToRgba(pngBytes);
  const counts = new Map();
  const rows = new Set(), cols = new Set();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 200) continue;
      rows.add(y); cols.add(x);
      const k = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return {
    img, rows: rows.size, cols: cols.size,
    top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
  };
}

test("a square emblem keeps the client's colours and FILLS the tile", () => {
  const out = buildFavicons({
    logo: { bytes: badgeLogo([12, 68, 154], [197, 63, 52]), ext: "png" },
    businessName: "Ramon Roofing", accent: "#c53f34",
  });
  assert.equal(out.report.source, "client_logo");
  assert.equal(out.report.logo_fit, "trimmed");

  const { img, rows, cols, top } = inspect(out.files["icon-512.png"]);
  assert.ok(top.includes("12,68,154"), `logo blue missing, got ${top}`);
  assert.ok(top.includes("197,63,52"), `logo red missing, got ${top}`);
  // The whole point of trimming: the mark occupies the tile rather than
  // sitting in it as a sliver. A letterboxed 4:1 bar fails this.
  assert.ok(rows > img.height * 0.8, `mark too short: ${rows}/${img.height}`);
  assert.ok(cols > img.width * 0.8, `mark too narrow: ${cols}/${img.width}`);
});

test("a symbol+wordmark lockup is cropped to the symbol, not letterboxed whole", () => {
  const out = buildFavicons({
    logo: { bytes: lockupLogo([12, 68, 154], [197, 63, 52]), ext: "png" },
    businessName: "Ramon Roofing", accent: "#c53f34",
  });
  assert.equal(out.report.source, "client_logo");
  assert.equal(out.report.logo_fit, "symbol_cropped");

  const { img, rows, cols, top } = inspect(out.files["icon-512.png"]);
  assert.ok(rows > img.height * 0.8, `symbol not filling the tile: ${rows}/${img.height}`);
  assert.ok(cols > img.width * 0.8);
  // The wordmark's dark grey must NOT be in the icon — only the emblem.
  assert.ok(!top.includes("30,34,40"), `wordmark text leaked into the icon: ${top}`);
  assert.ok(top.includes("12,68,154"), `emblem colour missing: ${top}`);
});

test("a pure wordmark has no square form and falls to the monogram, saying so", () => {
  // The trap: a wordmark is full of gaps, so "split at the first wide-enough
  // gap" crops to the first LETTER and ships a fragment as the client's mark.
  // Even letter spacing must read as "no symbol here".
  const out = buildFavicons({
    logo: { bytes: wordmarkLogo(), ext: "png" },
    businessName: "Wilbourn & McCabe Plumbing", accent: "#0f2742",
  });
  assert.equal(out.report.logo_fit, "no_square_form");
  assert.equal(out.report.raster_source, "monogram");
  assert.equal(out.report.initials, "WM");
  assert.ok(out.files["favicon.ico"], "left the tab with no icon at all");
});

test("the apple touch icon is opaque — iOS renders transparency as black", () => {
  const out = buildFavicons({
    logo: { bytes: badgeLogo([12, 68, 154], [197, 63, 52]), ext: "png" },
    businessName: "Ramon Roofing", accent: "#c53f34",
  });
  // Both raster paths flatten — the monogram tile drops its rounded corners
  // here rather than baking black ones into the iOS home screen.
  const monogram = buildFavicons({ logo: null, businessName: "Cooper Perry", accent: "#c53f34" });
  for (const [label, built] of [["logo", out], ["monogram", monogram]]) {
    const apple = decodePngToRgba(built.files["apple-touch-icon.png"]);
    assert.equal(apple.width, 180, label);
    for (let i = 0; i < apple.width * apple.height; i++) {
      assert.equal(apple.data[i * 4 + 3], 255, `${label}: transparent pixel in the touch icon`);
    }
  }
});

test("an undecodable format is named, not silently blamed on the logo's shape", () => {
  const out = buildFavicons({
    logo: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), ext: "webp" },
    businessName: "Cooper Perry", accent: "#c53f34",
  });
  assert.match(out.report.logo_fit, /format_not_decodable_here\(webp\)/);
  assert.equal(out.report.raster_source, "monogram");
});

test("an SVG mark is served as the client's own bytes", () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#094463"/></svg>',
    "utf8",
  );
  const out = buildFavicons({ logo: { bytes: svg, ext: "svg" }, businessName: "River City", accent: "#094463" });
  assert.equal(out.report.source, "client_logo_svg");
  assert.ok(out.files["favicon.svg"].equals(svg), "the client's vector mark was altered");

  // Only edit: supply a viewBox, without which a browser cannot letterbox it.
  const noBox = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect/></svg>', "utf8");
  assert.match(normalizeSvgIcon(noBox).toString("utf8"), /viewBox="0 0 200 60"/);
});

/* ------------------------------------------------------------- the markup */

test("donor icon markup is stripped in every form, ours declared once", () => {
  const files = {
    "index.html": htmlPage(
      '<link rel="icon" type="image/x-icon" href="/favicon.ico">'
      + '<link rel="alternate icon" href="/favicon.ico" />'
      + '<link rel=icon href="/favicon.svg">'
      + '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
      + '<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#000">'
      + '<link rel="manifest" href="/site.webmanifest">',
    ),
    "404.html": htmlPage('<link rel="shortcut icon" href="/favicon.ico">'),
    "favicon.ico": Buffer.from("donor-ico-bytes"),
    "favicon.svg": Buffer.from("<svg/>"),
    "safari-pinned-tab.svg": Buffer.from("<svg/>"),
    "apple-touch-icon.png": Buffer.from("donor-apple"),
  };
  const out = applyFavicons({ files, logo: null, businessName: "Ramon Roofing", accent: "#c53f34" });

  assert.ok(out.report.clean);
  assert.deepEqual(
    out.report.donor_icons_removed.sort(),
    ["apple-touch-icon.png", "favicon.ico", "favicon.svg", "safari-pinned-tab.svg"],
  );
  assert.notEqual(files["favicon.ico"].toString("utf8"), "donor-ico-bytes");
  assert.equal(files["safari-pinned-tab.svg"], undefined, "mask icon left behind");

  for (const page of ["index.html", "404.html"]) {
    const html = files[page].toString("utf8");
    assert.equal((html.match(/href="\/favicon\.ico"/g) || []).length, 1, `${page}: duplicate icon links`);
    assert.doesNotMatch(html, /safari-pinned-tab/, `${page}: mask-icon link survived`);
    assert.doesNotMatch(html, /alternate icon/i, `${page}: alternate icon survived`);
    assert.match(html, /<\/head>/, `${page}: head was broken`);
  }
  // The manifest link is NOT an icon link and must survive — the manifest's
  // contents are corrected instead.
  assert.match(files["index.html"].toString("utf8"), /rel="manifest"/);
});

test("UI imagery under assets/ is never mistaken for a favicon", () => {
  const files = {
    "index.html": htmlPage(),
    "favicon.ico": Buffer.from("donor"),
    "assets/icon-192.png": Buffer.from("a real UI sprite the app references"),
    "assets/favicon-illustration.png": Buffer.from("donor art, but not an icon path"),
  };
  applyFavicons({ files, logo: null, businessName: "Ramon Roofing", accent: "#c53f34" });
  assert.ok(files["assets/icon-192.png"], "deleted app imagery while fixing the tab");
  assert.ok(files["assets/favicon-illustration.png"]);
});

test("initials come from the name, with legal filler dropped", () => {
  assert.equal(initialsFrom("Sears Heating and Cooling"), "SH");
  assert.equal(initialsFrom("Air Creation Heating and Cooling LLC"), "AC");
  assert.equal(initialsFrom("Wilbourn & McCabe Plumbing"), "WM");
  assert.equal(initialsFrom("Monolith"), "M");
  assert.equal(initialsFrom("LLC Inc Co"), "");
});

test("encodeIco reports sizes and offsets that match its payloads", () => {
  const png16 = encodePng(16, 16, new Uint8Array(16 * 16 * 4).fill(255));
  const ico = encodeIco([{ size: 16, png: png16 }]);
  assert.equal(ico.readUInt32LE(6 + 8), png16.length);
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 16);
  assert.ok(ico.subarray(6 + 16).equals(png16));
});
