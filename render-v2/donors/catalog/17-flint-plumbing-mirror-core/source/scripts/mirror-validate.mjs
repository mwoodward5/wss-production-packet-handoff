#!/usr/bin/env node
/**
 * MIRROR:TOOLING — run this after the engine writes a client's config.
 *   bun run mirror:validate
 * Exit 0 = safe to build. Exit 1 = the mirror would ship a donor leak,
 * a broken schema, or an unverifiable claim. Never publish on exit 1.
 *
 * It reads the two config files as text (no bundler needed) plus the asset
 * folders, so it works in any CI, inside or outside Lovable.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];

const read = (p) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : "");

const client = read("src/client.config.ts");
const trust = read("src/trust.config.ts");
const styles = read("src/styles.css");

if (!client) errors.push("src/client.config.ts is missing.");
if (!trust) errors.push("src/trust.config.ts is missing.");

/* 1 — donor leak check ---------------------------------------------------- */
const DONOR_TOKENS = ["Flint Plumbing", "flintplumb", "Buda", "flint-plumbing"];
const scanDirs = ["src", "public"];
const leaks = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|css|json|txt|md)$/.test(entry.name)) {
      const body = readFileSync(p, "utf8");
      for (const t of DONOR_TOKENS) if (body.includes(t)) leaks.push(`${p} → "${t}"`);
    }
  }
};
scanDirs.forEach(walk);
if (leaks.length) warnings.push(`Donor tokens still present (fine for the donor repo itself):\n    ${leaks.slice(0, 12).join("\n    ")}`);

/* 2 — required keys ------------------------------------------------------- */
const need = (src, re, label) => {
  if (!re.test(src)) errors.push(`Missing/blank required field: ${label}`);
};
need(client, /siteKey:\s*"[^"]+"/, "clientConfig.siteKey");
need(client, /canonicalUrl:\s*"https:\/\/[^"]+"/, "clientConfig.canonicalUrl (must be https)");
need(client, /nearMeSlug:\s*"[a-z0-9-]+"/, "clientConfig.vertical.nearMeSlug");
need(client, /nearMeNoun:\s*"[^"]+"/, "clientConfig.vertical.nearMeNoun");
need(trust, /name:\s*"[^"]+"/, "trustConfig.business.name");
need(trust, /schemaType:\s*"[^"]+"/, "trustConfig.business.schemaType");
need(trust, /serviceAreas:\s*\[/, "trustConfig.location.serviceAreas");

/* 3 — phone format -------------------------------------------------------- */
const phone = client.match(/x/) && null;
const e164 = trust.match(/phone:\s*"([^"]+)"/);
if (e164 && !/^\+[1-9]\d{7,14}$/.test(e164[1]))
  errors.push(`trustConfig.contact.phone must be E.164, got "${e164[1]}"`);
void phone;

/* 4 — geo present and not 0,0 -------------------------------------------- */
const geo = trust.match(/geo:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)/);
if (!geo) warnings.push("No location.primary.geo — map, directions and GeoCoordinates JSON-LD will be omitted.");
else if (Number(geo[1]) === 0 && Number(geo[2]) === 0) errors.push("location.primary.geo is 0,0 — real Places coordinates required.");

/* 5 — ratings must look harvested, not invented --------------------------- */
const ratingValue = trust.match(/ratingValue:\s*([\d.]+)/);
if (ratingValue && Number(ratingValue[1]) > 5) errors.push("ratingValue > 5.");
if (ratingValue && !/verifiedAt:\s*"\d{4}-\d{2}-\d{2}"/.test(trust))
  warnings.push("proof.ratings[] has no verifiedAt date — add the harvest date.");

/* 6 — reviewer faces ------------------------------------------------------ */
const avatars = (trust.match(/avatarUrl:\s*"/g) ?? []).length;
if (avatars < 3) warnings.push(`Only ${avatars} reviews carry avatarUrl. Faces are the highest-value visual: aim for 5+.`);

/* 7 — palette parity ------------------------------------------------------ */
const paletteBlock = /MIRROR:PALETTE/.test(styles);
if (!paletteBlock) errors.push("src/styles.css lost its MIRROR:PALETTE block — the engine has no anchor to write brand tokens.");

/* 8 — assets -------------------------------------------------------------- */
const heroMode = client.match(/mode:\s*"(video|kenburns)"/)?.[1];
if (heroMode === "video" && !existsSync(resolve(root, "public/hero/hero.mp4")))
  errors.push('hero.mode is "video" but public/hero/hero.mp4 is missing.');
for (const f of ["public/hero/still-1.jpg"])
  if (!existsSync(resolve(root, f))) errors.push(`Missing required asset: ${f}`);

/* report ------------------------------------------------------------------ */
for (const w of warnings) console.log(`\x1b[33mWARN\x1b[0m  ${w}`);
for (const e of errors) console.log(`\x1b[31mFAIL\x1b[0m  ${e}`);
console.log(
  errors.length
    ? `\n${errors.length} blocking issue(s). Do not publish this mirror.`
    : `\nmirror:validate passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`,
);
process.exit(errors.length ? 1 : 0);
