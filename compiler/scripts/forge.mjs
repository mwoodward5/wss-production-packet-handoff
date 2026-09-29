#!/usr/bin/env node
/**
 * Woodward SiteForge — prompt → packet → build → QC, one command, repeatable.
 *
 *   node scripts/forge.mjs --prompt "Site for Summit Roofing in Plano, TX. 20 years, family-owned..."
 *   node scripts/forge.mjs --from-intake intake.json          (ghost-agency intake payload)
 *   node scripts/forge.mjs --prompt "..." --footprint lm.json (merge LeadMiner/GBP evidence)
 *   Flags: --slug x  --hero <family>  --demo  --dry-run  --no-build
 *
 * Honesty contract: every fact in the packet is traceable to the prompt, the
 * footprint file, or engine enrichment. Nothing is invented. Ambiguities are
 * recorded in enrichment_sources with reduced confidence, never asserted.
 * Same prompt + same inputs => same packet => same site (deterministic seed).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERO_FAMILIES = ["cinematic-video-parallax","split-editorial-index","service-map-pins","material-lab-swatch","magazine-owner-letter","atlas-grid-reveal"];
const STATES = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA",
  colorado:"CO", connecticut:"CT", delaware:"DE", florida:"FL", georgia:"GA",
  hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA", kansas:"KS",
  kentucky:"KY", louisiana:"LA", maine:"ME", maryland:"MD", massachusetts:"MA",
  michigan:"MI", minnesota:"MN", mississippi:"MS", missouri:"MO", montana:"MT",
  nebraska:"NE", nevada:"NV", "new hampshire":"NH", "new jersey":"NJ",
  "new mexico":"NM", "new york":"NY", "north carolina":"NC", "north dakota":"ND",
  ohio:"OH", oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI",
  "south carolina":"SC", "south dakota":"SD", tennessee:"TN", texas:"TX",
  utah:"UT", vermont:"VT", virginia:"VA", washington:"WA", "west virginia":"WV",
  wisconsin:"WI", wyoming:"WY",
};
const TRADES = [
  [/roof/i,"roofing"],[/landscap|lawn|yard/i,"landscaping"],[/electric/i,"electrical"],
  [/plumb/i,"plumbing"],[/hvac|heating|air condition|\bac repair/i,"hvac"],[/pool/i,"pool service"],
  [/tree (care|service|removal)|arborist/i,"tree care"],[/paint/i,"painting"],[/concrete|paving|asphalt/i,"concrete"],
  [/fence|fencing/i,"fencing"],[/clean/i,"cleaning"],[/garage door/i,"garage door"],[/pest/i,"pest control"],
  [/solar/i,"solar"],[/remodel|renovat|general contract/i,"general contracting"],[/excavat/i,"excavation"],
];

const sha = (s) => createHash("sha256").update(s).digest("hex");
const kebab = (s) => String(s).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
const STATE_CODES = new Set(Object.values(STATES));

function normalizedState(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATES[raw.toLowerCase()] || "";
}

function cleanCity(value, state = "") {
  const tokens = String(value || "").split(",").map((token) => token.trim()).filter(Boolean);
  const unique = tokens.filter((token, index) =>
    tokens.findIndex((candidate) => candidate.toLowerCase() === token.toLowerCase()) === index);
  const withoutState = unique.filter((token) => normalizedState(token) !== state);
  const city = withoutState.join(", ").replace(/\s+/g, " ").trim();
  if (!city || /^[A-Z]{2}$/i.test(city) || city.toUpperCase() === state) return "";
  return city;
}

function locationFromAddress(value) {
  const address = String(value || "").trim();
  if (!address) return { city: "", state: "" };
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const stateMatch = parts[index].match(/\b([A-Z]{2})\b/i);
    const state = normalizedState(stateMatch?.[1]);
    if (!state) continue;
    const city = cleanCity(parts[index - 1], state);
    if (city) return { city, state };
  }
  const compact = address.match(/\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Ct|Court)\.?\s+([A-Za-z][A-Za-z .'-]{2,40}?)\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  const state = normalizedState(compact?.[2]);
  return { city: cleanCity(compact?.[1], state), state };
}

function normalizeLocationFacts(facts) {
  const addressLocation = locationFromAddress(facts.address);
  const state = normalizedState(facts.state) || addressLocation.state;
  const city = cleanCity(facts.city, state) || (addressLocation.state === state ? addressLocation.city : "");
  return { ...facts, city, state };
}

function normalizedLatLng(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.lon ?? value?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function footprintLatLng(footprint) {
  const candidates = [
    footprint?.business?.latlng,
    footprint?.business?.coordinates,
    footprint?.location?.latlng,
    footprint?.location?.coordinates,
    footprint?.geometry?.location,
    footprint?.truth_packet?.latlng,
    footprint?.truth_packet?.coordinates,
    footprint?.truth_packet,
    footprint?.latlng,
    footprint?.coordinates,
    footprint,
  ];
  for (const candidate of candidates) {
    const normalized = normalizedLatLng(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function validBrandColors(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values
    .map((color) => typeof color === "string" ? color.trim() : String(color?.hex || "").trim())
    .filter((color) => /^#[\da-f]{6}$/i.test(color))
    .map((color) => color.toUpperCase()))].slice(0, 8);
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const flagOnly = ["demo","dry-run","no-build","deploy","json"].includes(k);
      a[k] = flagOnly ? true : (argv[i+1] && !argv[i+1].startsWith("--") ? argv[++i] : true);
    } else a._.push(t);
  }
  return a;
}

function extract(prompt) {
  const facts = {}; const src = {};
  const put = (k, value, confidence, note) => { if (value != null && value !== "") { facts[k] = value; src[k] = { source: "prompt", confidence, value: String(value), ...(note ? { note } : {}) }; } };

  // business name: "for <Name> in" > "called <Name>" > short leading quote
  const forIn = prompt.match(/\bfor\s+([A-Z][\w&'.-]*(?:\s+[A-Z0-9][\w&'.-]*){0,5})\s+(?:in|of|at|serving)\b/);
  const called = prompt.match(/\b(?:called|named)\s+([A-Z][\w&'.-]*(?:\s+[A-Z0-9][\w&'.-]*){0,5})/);
  const quoted = prompt.match(/["“']([^"”']{3,40})["”']/);
  const quotedName = quoted && prompt.indexOf(quoted[0]) < 80 ? quoted[1] : "";
  const nameUsedQuote = !forIn && !called && Boolean(quotedName);
  put("name", (forIn?.[1] || called?.[1] || quotedName || "").trim(), forIn || called ? 0.9 : 0.75);

  // location: "in City, ST" / "in City, StateName"
  const loc = prompt.match(/\bin\s+([A-Z][A-Za-z .'-]{2,30}?),\s*(?:([A-Z]{2})\b|([A-Z][a-z]+(?: [A-Z][a-z]+)?))/);
  if (loc) { put("city", loc[1].trim(), 0.9); put("state", loc[2] || STATES[(loc[3]||"").toLowerCase()] || "", loc[2] ? 0.95 : 0.85); }

  // trade
  for (const [re, cat] of TRADES) if (re.test(prompt)) { put("category", cat, 0.9); break; }

  put("phone", (prompt.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/) || [])[1], 0.95);
  put("email", (prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/) || [])[1], 0.95);
  put("website", (prompt.match(/(https?:\/\/[^\s"'<>]+)/) || [])[1], 0.95);
  put("years", (prompt.match(/(\d{1,2})\+?\s*years?/i) || [])[1], 0.85);
  const owner = prompt.match(/\b(?:owner|founder|run by|i'?m|my name is)\s+(?:is\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i);
  put("owner_name", owner?.[1], 0.8);

  // tone
  const tone = /luxur|premium|high[- ]end|upscale/i.test(prompt) ? "refined, assured"
    : /family|friendly|neighborly|hometown/i.test(prompt) ? "warm, family-run, plainspoken"
    : /no[- ]nonsense|straight|blue[- ]collar|hardworking/i.test(prompt) ? "direct, hardworking, honest"
    : "warm, plainspoken, professional";
  facts.tone = tone; src.tone = { source: "prompt", confidence: 0.7, value: tone, note: "inferred from prompt wording" };

  // verbatim first-person snippets only (never fabricated)
  const allQuotes = (prompt.match(/[“"]([^"”]{15,160})[”"]/g) || []).map(s => s.replace(/[“”"]/g, ""));
  const snippets = (nameUsedQuote ? allQuotes.slice(1) : allQuotes).slice(0, 3);
  if (snippets.length) { facts.snippets = snippets; src.snippets = { source: "prompt", confidence: 0.9, value: snippets.join(" | ") }; }

  // services list: "services: a, b, c" or "offering a, b and c"
  const svc = prompt.match(/\b(?:services?|offering|specializ\w+ in)[:\s]+([^.;\n]{10,160})/i);
  if (svc) { facts.services = svc[1].split(/,| and /).map(s => s.trim()).filter(s => s && s.length < 40).slice(0, 8); src.services = { source: "prompt", confidence: 0.85, value: svc[1] }; }

  return { facts, src };
}

function fromIntake(file) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const facts = {
    name: d.businessName, category: (d.industry || "").toLowerCase() || undefined,
    city: d.city, state: d.state, phone: d.phone || undefined, email: d.ownerEmail || undefined,
    website: d.currentWebsite || undefined,
    address: d.address || undefined,
    latlng: normalizedLatLng(d.latlng || d.coordinates) || undefined,
    place_id: d.place_id || d.placeId || d.google_place_id || undefined,
    brand_colors: validBrandColors(d.brand?.colors || d.brandColors || d.branding?.colors),
    services: d.services ? String(d.services).split(/,/).map(s => s.trim()).filter(Boolean) : undefined,
    tone: "warm, plainspoken, professional",
  };
  const src = {};
  for (const [k, v] of Object.entries(facts)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const sourceKey = k === "place_id" ? "map_id" : k === "brand_colors" ? "colors" : k;
    const sourceValue = ["latlng", "brand_colors"].includes(k) ? v : Array.isArray(v) ? v.join(", ") : String(v);
    src[sourceKey] = { source: "intake_form", confidence: 0.95, value: sourceValue };
  }
  return { facts, src, intake: d };
}

function buildPacket({ facts, src }, opts) {
  facts = normalizeLocationFacts(facts);
  const missing = ["name","category","city","state"].filter(k => !facts[k]);
  if (missing.length) throw new Error(`Cannot forge packet — missing required business facts: ${missing.join(", ")}. Add them to the prompt (e.g. 'for Summit Roofing in Plano, TX').`);

  const slug = opts.slug || `wss-${kebab(facts.category)}-${kebab(facts.name)}`;
  const seed = sha(slug).slice(0, 12); // deterministic: same slug => same layout DNA
  const hero = opts.hero && HERO_FAMILIES.includes(opts.hero) ? opts.hero : HERO_FAMILIES[parseInt(sha(slug).slice(0, 8), 16) % HERO_FAMILIES.length];

  const enrichment = {};
  for (const [k, v] of Object.entries(src)) enrichment[k] = v;

  const packet = {
    slug,
    prompt: opts.prompt || `Forged from intake for ${facts.name}`,
    forge: { version: "1.0.0", generated_at: new Date().toISOString(), deterministic_seed: seed, demo: Boolean(opts.demo) },
    business: {
      name: facts.name, category: facts.category, city: facts.city, state: facts.state,
      ...(facts.phone ? { phone: facts.phone } : {}),
      ...(facts.email ? { email: facts.email } : {}),
      ...(facts.website ? { current_website: facts.website } : {}),
      ...(facts.address ? { address: facts.address } : {}),
      ...(facts.latlng ? { latlng: facts.latlng } : {}),
      ...(facts.place_id ? { place_id: facts.place_id } : {}),
      source_platform: "other",
    },
    build_type: opts["build-type"] || "multi-page",
    hero_family: hero,
    layout_seed: seed,
    toggles: {
      firecrawl: Boolean(facts.website && process.env.FIRECRAWL_API_KEY),
      gbp: Boolean(facts.gbp_url), local_serp: false,
      video_prompt: /video|cinematic/i.test(opts.prompt || ""),
      map: true, ai_chat: /chat|assistant/i.test(opts.prompt || ""), payment_cta: /payment|checkout|book(ing)? online/i.test(opts.prompt || ""),
    },
    enrichment_sources: enrichment,
    voice_persona: {
      owner_name: facts.owner_name || `${facts.name} team`,
      tone: facts.tone,
      ...(facts.snippets ? { first_person_snippets: facts.snippets } : {}),
    },
    ...(facts.services ? { services: facts.services } : {}),
    ...(facts.place_id ? { gbp: { pid: facts.place_id } } : {}),
    ...(facts.brand_colors?.length ? {
      brand: { colors: facts.brand_colors },
      source: { brandColors: facts.brand_colors },
    } : {}),
  };
  return packet;
}

function validate(packet) {
  const schema = JSON.parse(readFileSync(path.join(ROOT, "generator-queue-v5.schema.json"), "utf8"));
  const errs = [];
  for (const k of schema.required || []) if (packet[k] == null) errs.push(`missing root field: ${k}`);
  for (const k of schema.properties?.business?.required || []) if (packet.business?.[k] == null) errs.push(`missing business.${k}`);
  const heroEnum = schema.properties?.hero_family?.enum;
  if (heroEnum && !heroEnum.includes(packet.hero_family)) errs.push(`hero_family not in enum`);
  for (const k of schema.properties?.voice_persona?.required || []) if (packet.voice_persona?.[k] == null) errs.push(`missing voice_persona.${k}`);
  if (errs.length) throw new Error("Packet failed schema validation:\n  - " + errs.join("\n  - "));
}

function injectDemoGuards(siteDir) {
  // demo builds must never masquerade as a real business site
  for (const f of readdirSync(siteDir, { recursive: true })) {
    const fp = path.join(siteDir, String(f));
    if (!fp.endsWith(".html")) continue;
    let html = readFileSync(fp, "utf8");
    if (!/name="robots"/.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="robots" content="noindex, nofollow" />`);
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n  <!-- SiteForge demo build — not a live business site -->`);
    writeFileSync(fp, html);
  }
}

// ---------- main ----------
const args = parseArgs(process.argv);
try {
  let parsed;
  if (args["from-intake"]) parsed = fromIntake(args["from-intake"]);
  else if (args.prompt) parsed = extract(args.prompt);
  else { console.error("Usage: forge --prompt \"...\" | --from-intake intake.json  [--footprint f.json] [--slug s] [--hero fam] [--demo] [--dry-run] [--no-build]"); process.exit(2); }

  if (args.footprint) { // merge LeadMiner/GBP evidence file (footprint wins on conflicts, higher provenance)
    const fp = JSON.parse(readFileSync(args.footprint, "utf8"));
    const fields = {
      name: [fp.business?.name, fp.business_name, fp.truth_packet?.business_name, fp.name],
      category: [fp.business?.category, fp.vertical, fp.industry, fp.truth_packet?.vertical, fp.category],
      city: [fp.business?.city, fp.location?.city, fp.truth_packet?.city, fp.city],
      state: [fp.business?.state, fp.location?.state, fp.truth_packet?.state, fp.state],
      phone: [fp.business?.phone, fp.phone_e164, fp.truth_packet?.phone_e164, fp.phone],
      address: [fp.business?.address, fp.location?.address, fp.street_address, fp.truth_packet?.street_address, fp.address],
      website: [fp.business?.current_website, fp.website_url, fp.truth_packet?.website_url, fp.current_website],
      gbp_url: [fp.business?.gbp_url, fp.truth_packet?.gbp_url, fp.gbp_url],
    };
    for (const [fk, candidates] of Object.entries(fields)) {
      const v = firstValue(...candidates);
      if (v) { parsed.facts[fk] = v; parsed.src[fk] = { source: "footprint", confidence: 0.98, value: String(v) }; }
    }
    const latlng = footprintLatLng(fp);
    const placeId = firstValue(
      fp.business?.place_id,
      fp.business?.placeId,
      fp.business?.google_place_id,
      fp.location?.place_id,
      fp.location?.placeId,
      fp.place_id,
      fp.placeId,
      fp.google_place_id,
      fp.truth_packet?.google_place_id,
      fp.gbp?.place_id,
      fp.gbp?.pid,
    );
    const brandColors = validBrandColors(
      fp.brand?.colors ||
      fp.branding?.colors ||
      fp.source?.brandColors ||
      fp.brandColors ||
      fp.colors,
    );
    if (latlng) {
      parsed.facts.latlng = latlng;
      parsed.src.latlng = { source: "footprint", confidence: 0.98, value: latlng };
    }
    if (placeId) {
      parsed.facts.place_id = String(placeId);
      parsed.src.map_id = { source: "footprint", confidence: 0.98, value: String(placeId) };
    }
    if (brandColors.length) {
      parsed.facts.brand_colors = brandColors;
      parsed.src.colors = { source: "footprint", confidence: 0.98, value: brandColors };
    }
    if (fp.source) parsed.footprintSource = fp.source;
  }

  const packet = buildPacket(parsed, args);
  if (parsed.footprintSource) packet.source = parsed.footprintSource;
  validate(packet);

  mkdirSync(path.join(ROOT, "packets"), { recursive: true });
  const packetPath = path.join(ROOT, "packets", `${packet.slug}.json`);
  writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
  console.log(`✔ packet forged: packets/${packet.slug}.json  (hero: ${packet.hero_family}, seed: ${packet.layout_seed})`);
  const lowConf = Object.entries(packet.enrichment_sources).filter(([, v]) => v.confidence < 0.8).map(([k]) => k);
  if (lowConf.length) console.log(`  low-confidence facts (review): ${lowConf.join(", ")}`);

  if (args["dry-run"] || args["no-build"]) { if (args.json) console.log(JSON.stringify(packet, null, 2)); process.exit(0); }

  const r = spawnSync("node", ["factory/pipeline/run.mjs", "--packet", packetPath], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", env: { ...process.env, ...(args.deploy ? {} : { VERCEL_DEPLOY_HOOK_URL: "" }) } });
  process.stdout.write(r.stdout || "");
  const qcLine = (r.stdout || "").split("\n").find(l => l.includes('"stage":"qc"') && l.includes('"phase":"done"'));
  const grade = qcLine ? JSON.parse(qcLine.replace(/^data: /, "")).payload.grade : "unknown";

  const siteDir = path.join(ROOT, "generated-sites", packet.slug);
  if (args.demo && existsSync(siteDir)) { injectDemoGuards(siteDir); console.log("✔ demo guards injected (noindex)"); }

  console.log(`\n=== FORGE RESULT ===\nsite: generated-sites/${packet.slug}\nQC grade: ${grade}`);
  process.exit(r.status === 0 && grade === "A" ? 0 : 1);
} catch (e) {
  console.error("✖ forge failed:", e.message);
  process.exit(1);
}
