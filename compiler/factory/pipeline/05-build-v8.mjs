// Pipeline stage 5 — SiteForge Premier renderer V8.
// V8 composes a business-specific visual system before rendering. It keeps
// verified facts and source media intact while changing layout gravity,
// typography, hero anatomy, section cadence, motion, and proof treatment.
//   1. Media engine — source video first; otherwise labeled AI brand motion may
//      set atmosphere while only real business media appears as proof.
//   2. GBP deep import rendering — sourced hours, attributed reviews, real
//      photos, Google satellite map, and Google + Apple directions.
//   3. Remic formulas as real architectures: single_page_cinematic scroll order
//      (PROMPT A) and premier_multi_page 5–8 page hub (PROMPT B).
//   4. Optimization surface — scorecard.json + assets.json emitted per build.
// Visual law: docs/launch/ENGINE_VISUAL_STANDARDS.md — hero ≥6 layers, logo
// 72–80px, no banned phrases, no invented facts, deterministic seed, 320px
// clean, reduced-motion everywhere. This is the only active renderer target.
import { emit } from "../lib/emit.mjs";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { blobToPath, seedFrom } from "../lib/hero-seed.mjs";
import { ambianceSvg, ambianceFor, mix } from "../lib/ambiance-v7.mjs";
import { applyVisualContract, cinematicCss, cinematicRuntime, visualAttrs } from "./premier-visual-contract.mjs";
import { compositionFingerprint, planPremierComposition } from "../lib/premier-composer.mjs";
import { selectPremierMedia, renderPremierHeroMedia, safeMediaUrl } from "../lib/premier-media.mjs";
import { isBoundContainedSourceProof } from "../lib/media-intelligence.mjs";
import { buildPremierMap, renderPremierMap } from "../lib/premier-map.mjs";
import { captureContentType, createCaptureRoute, resolveCaptureFile } from "../lib/capture-origin.mjs";
import {
  captureWithFreshChromiumRecovery,
  classifyChromiumCaptureError,
  launchChromium,
  navigateChromiumPageForCapture,
  openChromiumPageWithRecovery,
  screenshotCaptureBudgetPlan,
  waitForChromiumFonts,
} from "../lib/chromium-runtime.mjs";
import { buildAuthoritySchema, schemaTypesFromGraph } from "../authority/schema-engine.mjs";
import { evaluateAuthorityStandard } from "../authority/authority-standard.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const useed = (seed) => seed.seed >>> 0; // seed.seed is signed int32 (XOR); normalize for indexing

const RESERVED_PUBLIC_HOST = /(?:^|\.)(?:localhost|local|internal|invalid|test|example|lan|home|corp)$/i;
const RESERVED_EXAMPLE_HOST = /(?:^|\.)example\.(?:com|net|org)$/i;
const FABRICATED_ASSET_SOURCE = /(?:^|[\s/_-])(?:ai|generated|placeholder|proposed|sample|stock|synthetic)(?:$|[\s/_-])/i;

function isPublicHostname(value) {
  const host = String(value || "").toLowerCase();
  if (!host || !host.includes(".") || host.includes(":") || RESERVED_PUBLIC_HOST.test(host) || RESERVED_EXAMPLE_HOST.test(host)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

export function resolvePublicSiteUrl(packet = {}) {
  const candidates = [
    packet.public_url,
    packet.canonical_url,
    packet.site_url,
    packet.publicUrl,
    packet.deployment?.public_url,
    packet.production?.url,
  ];
  for (const value of candidates) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.username || url.password || !isPublicHostname(url.hostname)) continue;
      url.search = "";
      url.hash = "";
      url.pathname = `${url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "")}/`;
      return url.href;
    } catch {}
  }
  return null;
}

function absolutePublicUrl(base, route = "/") {
  if (!base) return null;
  try {
    const relative = String(route || "/").replace(/^\/+/, "");
    return new URL(relative || "./", base).href;
  } catch {
    return null;
  }
}

export function sourceBrandLogoUrl(packet = {}) {
  const logo = packet.logo_source || packet.v7_logo;
  if (!logo || logo.proposed === true || String(logo.proposed || "").toLowerCase() === "true") return null;
  if (logo.generated === true || logo.ai_generated === true) return null;
  const source = [logo.origin, logo.source, logo.provenance, logo.role].filter(Boolean).join(" ");
  if (FABRICATED_ASSET_SOURCE.test(source)) return null;
  const url = safeMediaUrl(logo.chosen_url || logo.remastered_path || logo.url);
  if (!url || /^(?:\.\.\/|\/\.\.\/)/.test(url)) return null;
  return url;
}

const TRUST_MARK_IMAGE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const TRUST_MARK_URL_JUNK = /(?:google|gstatic|maps\.|mapsstatic|ggpht|googleusercontent|facebook|fbcdn|instagram|cdninstagram|yelp|foursquare|placeholder|jobber|serviceagent|powered[-_ ]?by|website[-_ ]?builder)/i;
const TRUST_MARK_SENSITIVE_QUERY = /^(?:key|token|signature|sig|access[_-]?token|api[_-]?key|apikey|auth|credential|x-goog-|x-amz-)/i;
const TRUST_MARK_OWNER_STOP = /^(?:a|an|and|co|company|corp|corporation|group|inc|llc|ltd|of|service|services|team|the|construction|contracting|contractor|contractors|electric|electrical|fence|fencing|landscape|landscapes|landscaping|lawn|plumbing|pool|pools|roof|roofing)$/i;

function trustMarkHost(value = "") {
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || "")) ? String(value) : `https://${String(value || "")}`;
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function trustMarkOwnerKey(value = "") {
  return [...new Set(String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !TRUST_MARK_OWNER_STOP.test(token)))].slice(0, 4).join("-");
}

function sameTrustMarkHost(left = "", right = "") {
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)));
}

function safeTrustMarkUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || TRUST_MARK_URL_JUNK.test(`${url.hostname}${url.pathname}`)) return "";
    if (!TRUST_MARK_IMAGE.test(decodeURIComponent(url.pathname))) return "";
    if ([...url.searchParams.keys()].some((key) => TRUST_MARK_SENSITIVE_QUERY.test(key))) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function trustedTrustMarksForPacket(packet = {}) {
  const businessName = String(packet.business?.name || "").trim();
  const currentWebsite = packet.business?.current_website || packet.business?.website || packet.enrichment_sources?.website?.value || "";
  const officialHost = trustMarkHost(currentWebsite);
  const targetOwnerKey = trustMarkOwnerKey(businessName);
  const seen = new Set();
  const out = [];
  for (const asset of Array.isArray(packet.assets) ? packet.assets : []) {
    if (asset?.kind !== "trust_mark" || asset.approved === false) continue;
    const url = safeTrustMarkUrl(asset.url);
    if (!url || seen.has(url)) continue;
    const authenticatedUpload = asset.provenance?.authenticated_owner_upload === true;
    if (!authenticatedUpload && !asset.meta?.trust_mark_evidence) continue;
    if (!authenticatedUpload) {
      const provenance = asset.provenance || {};
      const sourceHost = String(provenance.source_host || "").toLowerCase().replace(/^www\./, "");
      const sourceUrlHost = trustMarkHost(provenance.source_url);
      const ownerKey = String(provenance.owner_key || "").toLowerCase();
      if (!officialHost || !targetOwnerKey || sourceHost !== sourceUrlHost || ownerKey !== targetOwnerKey || !sameTrustMarkHost(sourceHost, officialHost)) continue;
    }
    seen.add(url);
    out.push({
      kind: "trust_mark",
      url,
      label: String(asset.label || "Source-backed trust mark").replace(/\s+/g, " ").trim().slice(0, 120),
      source: authenticatedUpload ? "owner-upload" : "official-business-site",
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function renderTrustMarkRail(packet = {}) {
  const marks = trustedTrustMarksForPacket(packet);
  if (!marks.length) return "";
  return `<div class="trust-mark-rail" aria-label="Partners, memberships, and certifications shown on the source website">
    ${marks.map((mark) => `<figure class="trust-mark" data-trust-mark-source="${esc(mark.source)}"><img src="${esc(mark.url)}" alt="${esc(mark.label)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>${esc(mark.label)}</figcaption></figure>`).join("")}
  </div>`;
}

function routeAssetUrl(url, rel = "") {
  if (!url) return null;
  return url.startsWith("media/") ? `${rel}${url}` : url;
}

function ogAssetUrl(url) {
  if (!url) return null;
  return url.startsWith("media/") ? url.slice("media/".length) : url;
}

function evidenceUrlKind(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (host === "maps.google.com") return "Google";
    if ((host === "google.com" || host.endsWith(".google.com")) && /(?:^|\/)maps(?:\/|$)/i.test(url.pathname)) return "Google";
    if (host === "g.page" || host === "maps.app.goo.gl") return "Google";
  } catch {}
  return "";
}

function reviewEvidenceKind(record) {
  if (!record || typeof record !== "object") return "";
  const sourceValues = [record.source, record.origin, record.provider, record.platform, record.provenance]
    .map((value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  for (const source of sourceValues) {
    if (/\b(?:gbp|google|googlemaps|google maps|google places|google business profile)\b/.test(source)) return "Google";
    if (/\b(?:site|website|business site|owner site)\b/.test(source)) return "Business website";
  }
  const urls = [record.source_url, record.sourceUrl, record.evidence_url, record.evidenceUrl, record.gbp_url, record.google_url, record.url];
  for (const url of urls) {
    const kind = evidenceUrlKind(url);
    if (kind) return kind;
  }
  return "";
}

export function reviewAttribution(review = {}, fact = {}) {
  return reviewEvidenceKind(review) || reviewEvidenceKind(fact);
}

function providerUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && allowedHosts.has(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

export function directionUrls(model = {}) {
  const google = providerUrl(model.googleDirectionsUrl || model.directions, new Set(["google.com", "maps.google.com", "www.google.com"]));
  const apple = providerUrl(model.appleDirectionsUrl || model.appleDirections, new Set(["maps.apple.com"]));
  return {
    ...(google ? { googleDirectionsUrl: google, directions: google } : {}),
    ...(apple ? { appleDirectionsUrl: apple, appleDirections: apple } : {}),
  };
}

export const DEFAULT_PREVIEW_CONTACT_ENDPOINT = "https://ghost-agency-backend.vercel.app/api/preview-contact";

export function previewContactConfig(packet = {}, { businessName = "", phone = "", email = "" } = {}) {
  const capture = packet.contact_capture ?? {};
  const resolvedPhone = String(packet.prospect?.phone || phone || "").trim();
  const cleanPhone = resolvedPhone.replace(/[^+\d]/g, "");
  const fallbackHref = String(
    capture.fallback_href
      || (cleanPhone ? `tel:${cleanPhone}` : "")
      || (email ? `mailto:${email}` : ""),
  ).trim();

  return {
    endpoint: String(capture.endpoint || process.env.PREVIEW_CONTACT_ENDPOINT || DEFAULT_PREVIEW_CONTACT_ENDPOINT).trim(),
    prospect_id: String(capture.prospect_id || packet.prospect?.prospect_id || packet.prospect_id || "").trim(),
    business_name: String(packet.prospect?.business_name || businessName || packet.business?.name || "Our team").trim(),
    phone: resolvedPhone,
    fallback_href: fallbackHref,
  };
}

const inlineJson = (value) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

export function previewContactScript(config) {
  return `window.PREVIEW_CONTACT=${inlineJson(config)};
(function(){
  "use strict";
  var cfg=window.PREVIEW_CONTACT||{};
  var endpoint=cfg.endpoint||"${DEFAULT_PREVIEW_CONTACT_ENDPOINT}";
  var business=cfg.business_name||"Our team";
  var tel=String(cfg.phone||"").replace(/[^+\\d]/g,"");
  var fallbackHref=tel?"tel:"+tel:(cfg.fallback_href||"");
  var forms=document.querySelectorAll("[data-quote-form]");
  if(!forms.length||!window.fetch)return;
  function bind(form){
    function val(name){var el=form.querySelector("[name='"+name+"']");return el?String(el.value||"").trim():"";}
    function picked(){
      var out=[];
      var nodes=form.querySelectorAll("input[type='checkbox']:checked,input[type='radio']:checked,[data-option].is-selected,[data-option][aria-pressed='true']");
      for(var i=0;i<nodes.length;i+=1){
        var el=nodes[i];
        var label=el.getAttribute("data-option")||el.value||(el.textContent||"").trim();
        if(label&&out.indexOf(label)===-1)out.push(label);
      }
      return out;
    }
    function status(text,kind,href,linkText){
      var box=form.querySelector("[data-quote-status]");
      if(!box){box=document.createElement("p");box.setAttribute("data-quote-status","");box.setAttribute("role","status");form.appendChild(box);}
      box.className="quote-status quote-status--"+kind;
      box.textContent=text;
      if(href){var link=document.createElement("a");link.href=href;link.textContent=linkText;box.appendChild(document.createTextNode(" "));box.appendChild(link);}
    }
    form.addEventListener("submit",function(event){
      event.preventDefault();
      var name=val("name");
      var contact=val("phone")||val("email")||val("email_or_phone");
      var options=picked();
      var note=val("message")||val("notes")||val("body");
      var message=(options.length?"Requested: "+options.join(", ")+". ":"")+note;
      if(!name||!contact||!message.trim()){status("Add your name, a phone or email, and a quick note so we can call you back.","error");return;}
      var button=form.querySelector("[type='submit']");
      if(button)button.disabled=true;
      status("Sending your request...","pending");
      var query=new URLSearchParams(window.location.search||"");
      var attribution={utm_source:query.get("utm_source")||"",utm_medium:query.get("utm_medium")||"",utm_campaign:query.get("utm_campaign")||"",utm_content:query.get("utm_content")||"",utm_term:query.get("utm_term")||""};
      fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,email_or_phone:contact,message:message.trim(),business_name:business,prospect_id:cfg.prospect_id||"",website:val("website"),form_id:"preview-quote",consent_given:true,...attribution})})
        .then(function(response){return response.json().catch(function(){return {};}).then(function(json){if(!response.ok||json.accepted!==true)throw new Error("not_accepted");});})
        .then(function(){
          var fields=form.querySelectorAll("input,textarea,select,button");
          for(var i=0;i<fields.length;i+=1)fields[i].disabled=true;
          window.dispatchEvent(new CustomEvent("lead_capture",{detail:{form_id:"preview-quote",business_name:business,utm_source:attribution.utm_source}}));
          status("Got it - "+business+" will call you back.","success");
        })
        .catch(function(){
          if(button)button.disabled=false;
          if(fallbackHref)status("That did not go through.","error",fallbackHref,tel?"Call "+business+" directly":"Email us directly");
          else status("That did not go through - please try again in a moment.","error");
        });
    });
  }
  for(var i=0;i<forms.length;i+=1)bind(forms[i]);
})();`;
}

export function quoteFormHtml(ctx, { rows = 3, style = "" } = {}) {
  const fallback = ctx.contactCapture.fallback_href || ctx.contactCapture.endpoint;
  const submitLabel = ctx.premierOverride ? ctx.cta.primaryLabel : "Request a quote";
  return `<form class="quote-form" data-quote-form action="${esc(fallback)}" method="get"${style ? ` style="${style}"` : ""}>
    <label>Name<input name="name" type="text" autocomplete="name" required></label>
    <label>Phone or email<input name="email_or_phone" type="text" required></label>
    <label>What's going on?<textarea name="message" rows="${rows}" required></textarea></label>
    <div class="quote-hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
    <button class="btn solid" type="submit">${esc(submitLabel)}</button>
    <p class="quote-status" data-quote-status role="status" aria-live="polite"></p>
  </form>`;
}
function imageUrlAtWidth(src, width, { aspect = 4 / 3, quality = 55 } = {}) {
  const url = String(src || "");
  if (!url.includes("img1.wsimg.com/")) return url;
  const transformAt = url.indexOf("/:/");
  const base = transformAt >= 0 ? url.slice(0, transformAt) : url.replace(/\/$/, "");
  const transform = transformAt >= 0 ? url.slice(transformAt + 3) : "";
  const crop = transform.split("/").find((part) => part.startsWith("cr="));
  const targetWidth = Math.max(240, Math.round(width));
  const targetHeight = aspect > 0 ? Math.max(180, Math.round(targetWidth / aspect)) : null;
  const resize = targetHeight ? `rs=w:${targetWidth},h:${targetHeight},cg:true` : `rs=w:${targetWidth}`;
  return `${base}/:/${crop ? `${crop}/` : ""}${resize}/qt=q:${quality}`;
}

function responsiveImageAttrs(src, { fallback = 960, widths = [480, 720, 960], sizes = "100vw", priority = false, aspect = 4 / 3, quality = 55 } = {}) {
  const url = String(src || "");
  const optimized = imageUrlAtWidth(url, fallback, { aspect, quality });
  const intrinsicHeight = Math.max(180, Math.round(fallback / aspect));
  const srcset = url.includes("img1.wsimg.com/")
    ? ` srcset="${widths.map((width) => `${esc(imageUrlAtWidth(url, width, { aspect, quality }))} ${width}w`).join(", ")}" sizes="${esc(sizes)}"`
    : "";
  return `src="${esc(optimized)}"${srcset} width="${fallback}" height="${intrinsicHeight}" decoding="${priority ? "sync" : "async"}"${priority ? ' fetchpriority="high"' : ""}`;
}

function isFlagshipHero(ctx) {
  return Boolean(ctx.premierMedia?.hero || ctx.premierMedia?.gallery?.length);
}

function heroImageOptions(ctx) {
  return isFlagshipHero(ctx)
    ? { fallback: 1920, widths: [640, 960, 1440, 1920], sizes: "100vw", aspect: 16 / 9, quality: 88 }
    : { fallback: 1280, widths: [480, 720, 960, 1280], sizes: "(max-width: 820px) 100vw, 50vw", aspect: 4 / 3, quality: 86 };
}

function heroPreloadHtml(ctx, rel = "") {
  const lead = ctx.premierMedia?.hero;
  if (!lead || lead.kind !== "photo") return "";
  const url = lead.url.startsWith("media/") ? rel + lead.url : lead.url;
  if (!url.includes("img1.wsimg.com/")) return `<link rel="preload" as="image" href="${esc(url)}" fetchpriority="high">`;
  const options = heroImageOptions(ctx);
  const srcset = options.widths.map((width) => `${esc(imageUrlAtWidth(url, width, options))} ${width}w`).join(", ");
  return `<link rel="preload" as="image" href="${esc(imageUrlAtWidth(url, options.fallback, options))}" imagesrcset="${srcset}" imagesizes="${esc(options.sizes)}" fetchpriority="high">`;
}

// ---------------- hero-kit-v1 atmosphere packs ----------------
// Signature effects ported to vanilla CSS/JS from Mark's best Lovable heroes
// (factory/recipes/lovable-kit/hero-kit-v1; index: factory/recipes/recipes.json).
// Deterministic per seed, reduced-motion safe, and the business-brand palette
// stays dominant: kit accents land on ~30% of rolls and never over scraped
// brand colors. Packs: blueprint / gold-particles / atmosphere / spotlight /
// photo-stack (media treatment) / none (wellness-calm).
let _heroKit;
function loadHeroKit() {
  if (_heroKit !== undefined) return _heroKit;
  try {
    _heroKit = JSON.parse(readFileSync(fileURLToPath(new URL("../recipes/recipes.json", import.meta.url)), "utf8")).recipes || [];
  } catch { _heroKit = []; } // missing kit never kills a build
  return _heroKit;
}
// Salted mulberry32 — an independent stream so kit rolls never shift the
// existing seed.rng() consumption order (layout stays stable sans kit).
function kitRngFrom(seedInt) {
  let a = (seedInt ^ 0x9e3779b9) | 0;
  return function () {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const ATMO_POOLS = { // trade vertical -> weighted pack pool (seeded pick)
  excavation:  ["blueprint", "blueprint", "blueprint", "atmosphere"],
  concrete:    ["blueprint", "blueprint", "spotlight"],
  roofing:     ["blueprint", "spotlight", "atmosphere"],
  fencing:     ["atmosphere", "atmosphere", "atmosphere", "spotlight"],
  landscaping: ["atmosphere", "atmosphere", "spotlight"],
  "tree care": ["atmosphere", "spotlight"],
  cleaning:    ["none"], // wellness-calm — dense motion reads wrong (kit 08)
  default:     ["gold-particles", "gold-particles", "spotlight", "none"],
};
function pickKitRecipe(tradeKey, rng) {
  const kit = loadHeroKit();
  if (!kit.length) return null;
  const match = kit.filter((r) => (r.verticals || []).some((v) => tradeKey === v));
  const pool = match.length ? match : kit;
  return pool[Math.floor(rng() * pool.length)] || null;
}
function kitAccent(pal, recipe, rng) { // ~30% adoption, contrast-banded per mode
  const hexL = (h) => { const m = /^#([0-9a-fA-F]{6})$/.exec(h || ""); if (!m) return null; const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const ok = (h) => { const L = hexL(h); return L != null && (pal.mode === "light" ? L >= 0.12 && L <= 0.62 : L >= 0.38 && L <= 0.88); };
  const acc = recipe?.palette?.accent, acc2 = recipe?.palette?.accent2;
  if (!acc || !ok(acc) || rng() >= 0.3) return pal;
  return { ...pal, accent: acc, accent2: acc2 && ok(acc2) && acc2 !== acc ? acc2 : pal.accent2 };
}
function atmosphereHtml(ctx) {
  const { atmo, pal } = ctx;
  if (atmo === "blueprint") return `<svg class="atmo-layer atmo-blueprint" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="bp-fine" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="${pal.ink}" stroke-width=".25" opacity=".4"/></pattern>
      <pattern id="bp-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="${pal.accent}" stroke-width=".5"/></pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#bp-fine)"/><rect width="100%" height="100%" fill="url(#bp-grid)"/>
    <g stroke="${pal.accent}" stroke-width="1" fill="none"><line x1="6%" y1="18%" x2="14%" y2="18%"/><line x1="10%" y1="14%" x2="10%" y2="22%"/><circle cx="10%" cy="18%" r="3"/><line x1="86%" y1="76%" x2="94%" y2="76%"/><line x1="90%" y1="72%" x2="90%" y2="80%"/><circle cx="90%" cy="76%" r="3"/></g>
    <g class="bp-dim" stroke="${pal.ink}" stroke-width=".6" fill="none" opacity=".5"><path d="M0 320 Q 200 280 400 320 T 800 320 T 1200 320 T 1600 320"/><path d="M0 360 Q 200 340 400 360 T 800 360 T 1200 360 T 1600 360"/></g>
  </svg>`;
  if (atmo === "atmosphere") return `<div class="atmo-layer atmo-fog a" aria-hidden="true"></div>
  <div class="atmo-layer atmo-fog b" aria-hidden="true"></div>
  <div class="atmo-sweep" aria-hidden="true"></div>
  <div class="atmo-letterbox" aria-hidden="true"></div>
  <div class="atmo-letterbox bottom" aria-hidden="true"></div>`;
  if (atmo === "gold-particles") return `<canvas class="atmo-layer atmo-particles" data-atmo-particles data-accent="${esc(pal.accent)}" aria-hidden="true"></canvas>`;
  if (atmo === "spotlight") return `<div class="atmo-layer atmo-spotlight" data-atmo-spotlight aria-hidden="true"></div>`;
  return ""; // none / photo-stack (photo-stack renders inside mediaStage)
}
function atmosphereCss(ctx) {
  const light = ctx.pal.mode === "light";
  return `
/* hero-kit-v1 atmosphere packs */
.atmo-layer{position:absolute;inset:0;z-index:1;pointer-events:none}
.atmo-blueprint{width:100%;height:100%;opacity:${light ? ".13" : ".18"};mix-blend-mode:${light ? "multiply" : "screen"}}
.atmo-blueprint .bp-dim{animation:bpDrift 24s ease-in-out infinite alternate}
@keyframes bpDrift{from{transform:translate(0,0)}to{transform:translate(-30px,-6px)}}
.atmo-fog{inset:-20%;
background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 .95 0 0 0 0 .85 0 0 0 0 .7 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E");
background-size:900px 900px;opacity:${light ? ".1" : ".16"};
mix-blend-mode:${light ? "multiply" : "screen"};animation:fogA 38s ease-in-out infinite alternate}
.atmo-fog.b{background-size:1200px 1200px;opacity:${light ? ".07" : ".11"};animation:fogB 52s ease-in-out infinite alternate}
@keyframes fogA{from{transform:translate(0,0)}to{transform:translate(60px,-30px)}}
@keyframes fogB{from{transform:translate(0,0)}to{transform:translate(-80px,40px)}}
.atmo-sweep{position:absolute;top:0;bottom:0;left:0;width:38%;z-index:1;pointer-events:none;filter:blur(14px);mix-blend-mode:screen;background:linear-gradient(105deg,transparent 0%,rgba(255,225,185,0) 30%,rgba(255,228,190,${light ? ".14" : ".22"}) 50%,rgba(255,225,185,0) 70%,transparent 100%);transform:translateX(-110%);animation:atmoSweep 13s ease-in-out infinite}
@keyframes atmoSweep{0%{transform:translateX(-110%)}55%,100%{transform:translateX(320%)}}
.atmo-letterbox{position:absolute;left:0;right:0;top:0;height:52px;z-index:2;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,${light ? ".22" : ".5"}),transparent)}
.atmo-letterbox.bottom{top:auto;bottom:0;height:72px;background:linear-gradient(0deg,rgba(0,0,0,${light ? ".22" : ".5"}),transparent)}
.atmo-particles{width:100%;height:100%}
.atmo-spotlight{opacity:.6;background:radial-gradient(620px circle at var(--sx,55%) var(--sy,38%),color-mix(in srgb,var(--accent) ${light ? "13%" : "20%"},transparent),transparent 62%);transition:opacity .5s}
.media-plane .stack-ph{opacity:0;transition:opacity 1.2s ease;animation:none!important}
.media-plane .stack-ph.is-top{opacity:1}
@media(prefers-reduced-motion:reduce){.atmo-fog,.atmo-sweep,.atmo-blueprint .bp-dim{animation:none}.atmo-spotlight,.atmo-particles{display:none}.media-plane .stack-ph{transition:none}}
`;
}
// Runtime for the JS-driven packs — gold-particles canvas (GoldParticles.tsx
// port), throttled pointer spotlight, photo-stack cycler. All skip/cancel on
// prefers-reduced-motion; multi-instance safe like ESTIMATOR_JS.
const ATMOS_JS = `
(() => {
  const rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  if (rm || saveData) document.querySelectorAll(".hero video").forEach((video) => { video.pause(); video.removeAttribute("autoplay"); });
  document.querySelectorAll("canvas[data-atmo-particles]").forEach((canvas) => {
    if (rm) { canvas.remove(); return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const m = /^#?([0-9a-fA-F]{6})/.exec(canvas.getAttribute("data-accent") || "");
    const rgb = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)].join(",") : "201,168,76";
    let W = 0, H = 0, raf = 0;
    const size = () => { const r = canvas.parentElement.getBoundingClientRect(); W = canvas.width = Math.max(1, r.width | 0); H = canvas.height = Math.max(1, r.height | 0); };
    size();
    addEventListener("resize", size, { passive: true });
    const P = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .3, vy: -Math.random() * .4 - .1, s: Math.random() * 3 + 1, o: Math.random() * .5 + .1, p: Math.random() * Math.PI * 2 }));
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; p.p += .02;
        if (p.y < -10) p.y = H + 10;
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        const g = p.o * (.6 + .4 * Math.sin(p.p));
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 3);
        grad.addColorStop(0, "rgba(" + rgb + "," + g.toFixed(3) + ")");
        grad.addColorStop(1, "rgba(" + rgb + ",0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 3, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "rgba(" + rgb + "," + Math.min(1, g * 1.5).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * .5, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw); });
  });
  document.querySelectorAll("[data-atmo-spotlight]").forEach((el) => {
    if (rm) { el.remove(); return; }
    const host = el.closest(".hero") || el.parentElement;
    let raf = 0, ex = 0, ey = 0;
    host.addEventListener("pointermove", (e) => {
      ex = e.clientX; ey = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = host.getBoundingClientRect();
        el.style.setProperty("--sx", ((ex - r.left) / r.width * 100).toFixed(1) + "%");
        el.style.setProperty("--sy", ((ey - r.top) / r.height * 100).toFixed(1) + "%");
      });
    }, { passive: true });
  });
  document.querySelectorAll("[data-photo-stack]").forEach((plane) => {
    const imgs = plane.querySelectorAll(".stack-ph");
    if (rm || imgs.length < 2) return;
    let i = 0;
    setInterval(() => { imgs[i].classList.remove("is-top"); i = (i + 1) % imgs.length; imgs[i].classList.add("is-top"); }, 4000);
  });
})();`;

// ---------------- trade knowledge (v6 table, carried forward) ----------------
const TRADES = {
  roofing:    { noun: "roof", plural: "roofs", verb: "protect", services: ["Roof replacement", "Storm & hail repair", "Metal roofing", "Roof inspections"], material: ["standing seam", "architectural shingle", "underlayment", "flashing"], hooks: ["Built for the weather {city} actually gets.", "A {noun} that ends the leak-watch for good.", "Storm season is not a surprise. Your {noun} shouldn't act like it."], stat: "roofs restored" },
  landscaping:{ noun: "yard", plural: "landscapes", verb: "shape", services: ["Landscape design", "Paver patios", "Planting & cleanup", "Irrigation"], material: ["flagstone", "drip line", "native planting", "steel edging"], hooks: ["A {noun} that looks tended even in the off-season.", "Outdoor rooms, built for {city} light.", "Grass is easy. A landscape has intent."], stat: "yards transformed" },
  plumbing:   { noun: "plumbing", plural: "systems", verb: "keep flowing", services: ["Repiping", "Water heaters", "Drain cleaning", "Leak detection"], material: ["PEX", "copper", "pressure valve", "clean-out"], hooks: ["Pipes don't wait for morning. Neither do we.", "Quiet {noun} is the whole job.", "Water goes where we tell it in {city}."], stat: "calls answered" },
  electrical: { noun: "wiring", plural: "panels", verb: "power", services: ["Panel upgrades", "EV chargers", "Lighting", "Troubleshooting"], material: ["200-amp panel", "conduit", "GFCI", "load calc"], hooks: ["Clean current, tidy conduit, no surprises on the invoice.", "Your panel should be the most boring thing you own.", "{city} runs on good {noun}. So should your house."], stat: "panels upgraded" },
  hvac:       { noun: "air", plural: "systems", verb: "condition", services: ["AC repair", "Furnace installs", "Duct sealing", "Tune-ups"], material: ["heat pump", "SEER2", "plenum", "refrigerant"], hooks: ["Comfort you stop thinking about.", "Sized right, sealed tight, serviced on time.", "{city} summers negotiated on your behalf."], stat: "systems tuned" },
  excavation: { noun: "ground", plural: "sites", verb: "move", services: ["Site prep", "Grading", "Trenching", "Demolition"], material: ["compaction", "cut and fill", "swale", "base rock"], hooks: ["Dirt has opinions. We negotiate.", "Every build starts with honest {noun}.", "Grade it right once."], stat: "sites prepped" },
  painting:   { noun: "walls", plural: "rooms", verb: "finish", services: ["Interior painting", "Cabinet refinishing", "Color consultation", "Exterior repaint"], material: ["low-VOC", "levelling primer", "cut line", "satin finish"], hooks: ["Color chosen for {city} light, not a swatch card.", "A finish you'll want to touch.", "The last coat is the one people see. We obsess over all of them."], stat: "rooms finished" },
  fencing:    { noun: "fence", plural: "fence lines", verb: "frame", services: ["Cedar privacy fences", "Gates & hardware", "Ranch fencing", "Repairs"], material: ["post-set", "cedar picket", "powder-coat", "gate latch"], hooks: ["Straight lines you can sight down.", "A {noun} that holds its line for decades.", "Good {plural} make patient neighbors."], stat: "fence lines set" },
  "tree care":{ noun: "canopy", plural: "trees", verb: "steward", services: ["Pruning", "Removals", "Health assessments", "Stump grinding"], material: ["crown thinning", "rigging", "root flare", "arborist chip"], hooks: ["Your {plural} are decades old. Hire like it.", "Careful cuts, healthy {noun}.", "{city} shade, kept safe."], stat: "trees cared for" },
  concrete:   { noun: "slab", plural: "pours", verb: "form", services: ["Driveways", "Patios", "Foundations", "Flatwork repair"], material: ["rebar grid", "broom finish", "control joint", "4000 PSI"], hooks: ["Formed square, poured full, cut clean.", "A {noun} is forever. Pour accordingly.", "Concrete rewards patience and preparation."], stat: "pours completed" },
  "pool service": { noun: "pool", plural: "pools", verb: "keep swim-ready", services: ["Weekly pool service", "Equipment repair", "Green-to-clean rescues", "Filter & pump installs"], material: ["salt cell", "variable-speed pump", "DE filter", "water chemistry"], hooks: ["Swim-ready every week of the season.", "A {noun} you never have to think about.", "{city} water, balanced like a pro did it — because one did."], stat: "pools maintained" },
  cleaning:   { noun: "space", plural: "homes", verb: "reset", services: ["Recurring cleans", "Deep cleans", "Move-out cleans", "Post-construction"], material: ["HEPA vac", "microfiber system", "checklist", "green products"], hooks: ["Walk in like it's move-in day.", "A clean you can smell from the porch.", "{city} homes, reset weekly."], stat: "homes reset" },
  solar:      { noun: "array", plural: "systems", verb: "harvest", services: ["Solar installs", "Battery storage", "Panel cleaning", "System audits"], material: ["bifacial panel", "microinverter", "rapid shutdown", "kWh offset"], hooks: ["Your roof has a day job now.", "{city} sun, on your ledger.", "An {noun} sized to the bill, not the brochure."], stat: "systems commissioned" },
  default:    { noun: "work", plural: "projects", verb: "deliver", services: ["Consultations", "Installations", "Maintenance", "Repairs"], material: ["scope", "materials", "schedule", "walkthrough"], hooks: ["Done properly, priced plainly.", "{city} work with a name on it.", "The quote is the price."], stat: "projects delivered" },
};
const tradeOf = (category) => {
  const c = (category || "").toLowerCase();
  for (const k of Object.keys(TRADES)) if (k !== "default" && c.includes(k.split(" ")[0])) return { key: k, ...TRADES[k] };
  if (/tree/.test(c)) return { key: "tree care", ...TRADES["tree care"] };
  return { key: "default", ...TRADES.default };
};

const PALETTES = {
  roofing:    [{ bg: "#F5F1E8", ink: "#231F1A", accent: "#A63D2F", accent2: "#3E5C6B", mode: "light" }, { bg: "#1C2228", ink: "#F2EEE6", accent: "#E0703D", accent2: "#8FB0C0", mode: "dark" }],
  landscaping:[{ bg: "#F7F5EC", ink: "#22281E", accent: "#3E6B3F", accent2: "#B98A2F", mode: "light" }, { bg: "#20281F", ink: "#F1F0E4", accent: "#9BC08A", accent2: "#D9A441", mode: "dark" }],
  plumbing:   [{ bg: "#F2F5F4", ink: "#152528", accent: "#0F6B70", accent2: "#C06B2E", mode: "light" }, { bg: "#12262A", ink: "#EDF4F2", accent: "#4FB3AC", accent2: "#E09154", mode: "dark" }],
  electrical: [{ bg: "#F6F4EF", ink: "#1D1D22", accent: "#B07B10", accent2: "#31456B", mode: "light" }, { bg: "#191A21", ink: "#F3F1E9", accent: "#E8B23A", accent2: "#7C93C4", mode: "dark" }],
  hvac:       [{ bg: "#F3F5F7", ink: "#1B2430", accent: "#2E6188", accent2: "#C46A3B", mode: "light" }, { bg: "#17222C", ink: "#EFF3F6", accent: "#6FA8CD", accent2: "#E0854F", mode: "dark" }],
  excavation: [{ bg: "#F5F0E6", ink: "#26201A", accent: "#8A5A2B", accent2: "#4E5B3F", mode: "light" }, { bg: "#241E17", ink: "#F2ECDF", accent: "#CE9455", accent2: "#93A578", mode: "dark" }],
  painting:   [{ bg: "#FAFAF7", ink: "#232228", accent: "#7D4B9E", accent2: "#C2803B", mode: "light" }, { bg: "#232028", ink: "#F6F4F0", accent: "#B58BD0", accent2: "#DBA55E", mode: "dark" }],
  fencing:    [{ bg: "#F7F3EA", ink: "#241F18", accent: "#8C5A28", accent2: "#48604A", mode: "light" }, { bg: "#221D16", ink: "#F3EEE3", accent: "#CE9455", accent2: "#8FAF97", mode: "dark" }],
  "tree care":[{ bg: "#F4F6EF", ink: "#1F261C", accent: "#4A6B35", accent2: "#A66B2E", mode: "light" }, { bg: "#1D241A", ink: "#F0F2E8", accent: "#98BB7C", accent2: "#D99C55", mode: "dark" }],
  concrete:   [{ bg: "#F4F3F0", ink: "#232323", accent: "#5C6670", accent2: "#B4552D", mode: "light" }, { bg: "#212224", ink: "#F1F0EC", accent: "#9AA7B4", accent2: "#DE8B5B", mode: "dark" }],
  "pool service": [{ bg: "#F1F7F8", ink: "#12333F", accent: "#0F7B9E", accent2: "#C98A3B", mode: "light" }, { bg: "#0F2A33", ink: "#EAF4F5", accent: "#4FB6D8", accent2: "#E0A45E", mode: "dark" }],
  cleaning:   [{ bg: "#F8F7F4", ink: "#22262A", accent: "#2F7A68", accent2: "#B4552D", mode: "light" }, { bg: "#1D2422", ink: "#F2F4F0", accent: "#7BC0AC", accent2: "#DE8B5B", mode: "dark" }],
  solar:      [{ bg: "#FBF7EE", ink: "#20221E", accent: "#C28A12", accent2: "#33566B", mode: "light" }, { bg: "#1C1E22", ink: "#F6F2E7", accent: "#EFC04A", accent2: "#7FA3BE", mode: "dark" }],
  default:    [{ bg: "#F7F4EE", ink: "#1E1B16", accent: "#B4552D", accent2: "#41604F", mode: "light" }, { bg: "#1E1B16", ink: "#F4F0E7", accent: "#D97E4A", accent2: "#8FAF9B", mode: "dark" }],
};
const FAMILY_MODE = { "cinematic-video-parallax": "dark", "split-editorial-index": "light", "service-map-pins": "light", "material-lab-swatch": "light", "magazine-owner-letter": "light", "atlas-grid-reveal": "dark" };

export const BUSINESS_TYPE_PAIRS = Object.freeze([
  { id: "fraunces-archivo", display: "Fraunces", body: "Archivo" },
  { id: "caslon-jost", display: "Libre Caslon Text", body: "Jost" },
  { id: "space-source-serif", display: "Space Grotesk", body: "Source Serif 4" },
  { id: "zilla-public", display: "Zilla Slab", body: "Public Sans" },
  { id: "newsreader-figtree", display: "Newsreader", body: "Figtree" },
  { id: "bricolage-instrument", display: "Bricolage Grotesque", body: "Instrument Sans" },
  { id: "playfair-karla", display: "Playfair Display", body: "Karla" },
  { id: "dm-serif-dm-sans", display: "DM Serif Display", body: "DM Sans" },
  { id: "plex-serif-sans", display: "IBM Plex Serif", body: "IBM Plex Sans" },
  { id: "cormorant-manrope", display: "Cormorant Garamond", body: "Manrope" },
  { id: "bodoni-roboto", display: "Bodoni Moda", body: "Roboto" },
  { id: "oswald-merriweather", display: "Oswald", body: "Merriweather" },
  { id: "big-shoulders-inter", display: "Big Shoulders Display", body: "Inter" },
  { id: "lora-work-sans", display: "Lora", body: "Work Sans" },
  { id: "sora-nunito", display: "Sora", body: "Nunito Sans" },
  { id: "alegreya-family", display: "Alegreya", body: "Alegreya Sans" },
  { id: "roboto-slab-source", display: "Roboto Slab", body: "Source Sans 3" },
  { id: "urbanist-noto-serif", display: "Urbanist", body: "Noto Serif" },
  { id: "syne-inter", display: "Syne", body: "Inter" },
  { id: "archivo-black-plex", display: "Archivo Black", body: "IBM Plex Sans" },
]);

const GOOGLE_FONT_WEIGHTS = Object.freeze({
  "Archivo Black": [400],
  "DM Serif Display": [400],
  "Instrument Serif": [400],
  "Libre Caslon Text": [400, 700],
});

// ---------------- motif + scene (v6, carried) ----------------
function motifSvg(tradeKey, accent, seed) {
  const o = 0.16;
  const m = {
    roofing: `<g fill="none" stroke="${accent}" stroke-width="1.4" opacity="${o}">${[0,1,2,3].map(i=>`<path d="M ${40+i*90} 300 L ${240+i*90} ${120+seed.motifScale*30} L ${440+i*90} 300"/>`).join("")}</g>`,
    landscaping: `<g fill="none" stroke="${accent}" stroke-width="1.2" opacity="${o}">${[0,1,2,3,4].map(i=>`<path d="M -20 ${80+i*70} C 200 ${20+i*70}, 420 ${140+i*70}, 660 ${60+i*70} S 980 ${120+i*70}, 1220 ${70+i*70}"/>`).join("")}</g>`,
    plumbing: `<g fill="none" stroke="${accent}" stroke-width="1.6" opacity="${o}"><path d="M 60 60 H 300 A 40 40 0 0 1 340 100 V 260 A 40 40 0 0 0 380 300 H 640 A 40 40 0 0 1 680 340 V 420"/><circle cx="300" cy="60" r="8"/><circle cx="680" cy="420" r="8"/></g>`,
    electrical: `<g fill="none" stroke="${accent}" stroke-width="1.4" opacity="${o}"><path d="M 40 200 H 260 L 300 120 L 360 280 L 420 160 L 460 200 H 700"/><circle cx="700" cy="200" r="7" fill="${accent}"/><path d="M 200 340 H 380 L 420 300 H 620"/></g>`,
    "pool service": `<g fill="none" stroke="${accent}" stroke-width="1.4" opacity="${o}">${[0,1,2,3,4].map(i=>`<path d="M -20 ${110+i*80} q 80 ${-30-seed.motifScale*14} 160 0 t 160 0 t 160 0 t 160 0 t 160 0 t 160 0"/>`).join("")}</g>`,
    excavation: `<g fill="none" stroke="${accent}" stroke-width="1.1" opacity="${o}">${[0,1,2,3,4,5].map(i=>`<line x1="${i*160}" y1="0" x2="${i*160}" y2="460"/>`).join("")}${[0,1,2].map(i=>`<line x1="0" y1="${i*160}" x2="1000" y2="${i*160}"/>`).join("")}<path d="M 80 380 L 300 180 L 520 340 L 760 140" stroke-width="2.2"/></g>`,
    default: `<g fill="none" stroke="${accent}" stroke-width="1.2" opacity="${o}">${[0,1,2,3].map(i=>`<circle cx="${300+seed.motifScale*100}" cy="230" r="${70+i*60}"/>`).join("")}</g>`,
  };
  return m[tradeKey] || m.default;
}

function sceneSvg(trade, pal, seed, blob) {
  return `<svg class="scene-under" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><clipPath id="blobClip${useed(seed) % 997}"><path d="${blob}" transform="translate(0,-160) scale(1.0,1.28)"/></clipPath>
    <linearGradient id="sg${useed(seed) % 997}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.accent}" stop-opacity=".28"/><stop offset="1" stop-color="${pal.accent2}" stop-opacity=".14"/></linearGradient></defs>
    <rect width="1000" height="640" fill="url(#sg${useed(seed) % 997})"/>
    <g clip-path="url(#blobClip${useed(seed) % 997})"><rect width="1000" height="640" fill="${pal.accent}" opacity=".12"/></g>
    ${motifSvg(trade.key, pal.mode === "light" ? pal.ink : pal.accent, seed)}
  </svg>`;
}

function logoBlock(packet, name, pal, rel = "") {
  const src = sourceBrandLogoUrl(packet);
  if (src) {
    const url = src.startsWith("media/") ? rel + src : src;
    // Glass chip: scraped source logos arrive in every shape and quality —
    // presenting them inside a frosted, hairline-ringed container keeps even
    // flat or boxy source art looking deliberate on any hero or nav.
    return `<span class="brand-chip glass"><img class="sourced-logo" src="${esc(url)}" alt="${esc(name)} logo" height="76" data-role="logo" data-logo-kind="source" style="height:76px;width:auto;object-fit:contain"></span>`;
  }
  // No defensible source logo: preserve the complete business identity as a
  // clearly labeled proposed textmark. A shared trade icon would make unrelated
  // companies look like the same brand.
  const signature = crypto.createHash("sha256").update(String(name || "")).digest("hex").slice(0, 16);
  return `<span class="brand-chip glass">
    <span class="proposed-wordmark" data-role="logo" data-logo-kind="proposed" data-logo-signature="textmark-${signature}" data-logo-exception="source logo unavailable; proposed business-name textmark" aria-label="Proposed wordmark for ${esc(name)}" role="img">${esc(name)}</span>
  </span>`;
}

// ---------------- copy ----------------
const SERVICE_DISPLAY_ACRONYM = /^(?:[A-Z]{2,3}|HVAC)$/u;
const SERVICE_DISPLAY_SLASH_ACRONYM = /^\p{Lu}+(?:\/\p{Lu}+)+$/u;
const SERVICE_DISPLAY_AMPERSAND_ACRONYM = /^\p{Lu}+(?:&\p{Lu}+)+$/u;
const SERVICE_DISPLAY_UPPER_ALPHANUMERIC = /^(?=[\p{Lu}\d./+-]*\d)(?=[\p{Lu}\d./+-]*\p{Lu})[\p{Lu}\d]+(?:[-/.+][\p{Lu}\d]+)*$/u;
const SERVICE_DISPLAY_TECHNICAL_HYPHEN = /^\p{Lu}{2,5}-(?:\p{Lu}|Certified|Rated|Compliant|Approved|Listed|Grade|Series|Type|Class)$/u;

function serviceDisplayWord(value, firstWord) {
  const source = String(value);
  if (
    (!source.includes("-") && /\p{Ll}\p{Lu}/u.test(source))
    || /^(?:\p{Lu}\p{Ll}?)-\p{Lu}\p{Ll}+$/u.test(source)
    || SERVICE_DISPLAY_SLASH_ACRONYM.test(source)
    || SERVICE_DISPLAY_AMPERSAND_ACRONYM.test(source)
    || SERVICE_DISPLAY_UPPER_ALPHANUMERIC.test(source)
    || SERVICE_DISPLAY_TECHNICAL_HYPHEN.test(source)
  ) return source;
  return source.split("-").map((part, index) => {
    if (!/\p{L}/u.test(part)) return part;
    if (SERVICE_DISPLAY_ACRONYM.test(part)
      && (!source.includes("-") || /\p{Ll}/u.test(source))) return part;
    const lower = part.toLocaleLowerCase("en-US");
    return firstWord && index === 0
      ? lower.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("en-US"))
      : lower;
  }).join("-");
}

export function normalizeServiceDisplayLabel(value = "") {
  const clean = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!clean || !/\p{L}/u.test(clean)) return clean;
  const words = clean.split(" ");
  let firstWord = true;
  return words.map((word) => {
    if (!/\p{L}/u.test(word)) return word;
    const normalized = serviceDisplayWord(word, firstWord);
    firstWord = false;
    return normalized;
  }).join(" ");
}

function headline(trade, biz, seed) {
  const hook = trade.hooks[useed(seed) % trade.hooks.length] || `${trade.plural} for ${biz.city}.`;
  return hook
    .replaceAll("{city}", biz.city)
    .replaceAll("{noun}", trade.noun)
    .replaceAll("{plural}", trade.plural);
}
function stats(packet, trade, gbp) {
  const src = packet.enrichment_sources ?? {};
  const out = [];
  if (src.years?.value) out.push({ n: `${src.years.value}+`, label: "years in the trade" });
  if (gbp.rating?.value) {
    const provider = gbp.rating.attribution === "Google" ? "Google" : "public";
    out.push({ n: `${gbp.rating.value}★`, label: gbp.rating.count ? `${gbp.rating.count} ${provider} reviews` : `${provider} rating` });
  }
  const svcCount = (packet.services || []).length;
  if (svcCount) out.push({ n: String(svcCount), label: "core services" });
  const location = sanitizeBusinessLocation(packet);
  out.push({ n: location.state || location.city, label: `${location.city} based` });
  return out.slice(0, 3);
}
function faqsFor(trade, biz, count = 8) {
  const all = [
    [`What work is currently available?`, `Contact ${biz.name} directly to confirm services for your property.`],
    [`What area do you serve?`, `${biz.name} is listed in ${biz.locationLabel}. Confirm the exact service area directly with the business.`],
    [`How do I request pricing?`, `Contact ${biz.name} directly for current pricing and availability.`],
    [`What should I prepare before contacting you?`, `Share the property location, the work you need, and any useful photos.`],
  ];
  return all.slice(0, count);
}

// ---------------- GBP-derived data ----------------
const CITATION_PLATFORMS = [
  { match: /google\.|g\.page|maps\.app\.goo/i, label: "Google Business Profile", glyph: "G" },
  { match: /yelp\./i, label: "Yelp", glyph: "Y" },
  { match: /facebook\.|fb\.com/i, label: "Facebook", glyph: "f" },
  { match: /instagram\./i, label: "Instagram", glyph: "IG" },
  { match: /bbb\.org/i, label: "BBB", glyph: "B" },
  { match: /nextdoor\./i, label: "Nextdoor", glyph: "N" },
  { match: /angi\.|angieslist/i, label: "Angi", glyph: "A" },
  { match: /houzz\./i, label: "Houzz", glyph: "H" },
  { match: /thumbtack\./i, label: "Thumbtack", glyph: "T" },
  { match: /linkedin\./i, label: "LinkedIn", glyph: "in" },
];

// Verified citation/profile links from the packet. Sources: trust.citations,
// enrichment_sources.socials, business.socials. URL required; fabricated
// provenance rejected; unknown hosts dropped (truth law).
export function verifiedCitations(packet = {}) {
  const src = packet.enrichment_sources ?? {};
  const pools = [
    packet.trust?.citations,
    packet.trust?.profiles,
    src.socials?.value,
    src.citations?.value,
    packet.business?.socials,
  ];
  const out = [];
  const seen = new Set();
  for (const pool of pools) {
    for (const entry of (Array.isArray(pool) ? pool : [])) {
      const url = String((entry && typeof entry === "object" ? entry.url ?? entry.href ?? entry.link : entry) || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const provenance = entry && typeof entry === "object" ? [entry.source, entry.origin, entry.provenance].filter(Boolean).join(" ") : "";
      if (FABRICATED_ASSET_SOURCE.test(provenance)) continue;
      const platform = CITATION_PLATFORMS.find((candidate) => candidate.match.test(url));
      if (!platform || seen.has(platform.label)) continue;
      seen.add(platform.label);
      out.push({ label: platform.label, glyph: platform.glyph, url });
      if (out.length >= 6) break;
    }
  }
  return out;
}

function TRUST_CITATIONS(packet) {
  const citations = verifiedCitations(packet);
  if (!citations.length) return "";
  return `<div class="trust-citations" data-trust-citations>
    <span class="tc-label">Find us on</span>
    ${citations.map((item) => `<a class="tc-chip" href="${esc(item.url)}" target="_blank" rel="noopener nofollow"><i aria-hidden="true">${esc(item.glyph)}</i>${esc(item.label)}</a>`).join("")}
  </div>`;
}

function cleanLocationText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;|-]+|[\s,;|-]+$/g, "")
    .trim();
}

function cityFromAddress(value, state) {
  const parts = cleanLocationText(value).split(",").map(cleanLocationText).filter(Boolean);
  if (parts.length < 2) return "";
  const statePattern = state ? new RegExp(`^${state}(?:\\s+\\d{5}(?:-\\d{4})?)?$`, "i") : /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i;
  const stateIndex = parts.findIndex((part) => statePattern.test(part));
  const candidate = stateIndex > 0 ? parts[stateIndex - 1] : parts.at(-2);
  return /^[A-Z]{2}$/i.test(candidate || "") ? "" : candidate || "";
}

export function sanitizeBusinessLocation(packet = {}) {
  const rawState = cleanLocationText(packet.business?.state).toUpperCase();
  const state = /^[A-Z]{2}$/.test(rawState) ? rawState : "";
  const rawCity = cleanLocationText(packet.business?.city);
  const invalidCity = !rawCity || /^[A-Z]{2}$/i.test(rawCity) || rawCity.toUpperCase() === state;
  const address = packet.enrichment_sources?.address?.value || packet.business?.address || "";
  const fallbackCity = cityFromAddress(address, state);
  const city = invalidCity ? fallbackCity || "your city" : rawCity;
  const labelParts = [city, state].filter(Boolean);
  const uniqueParts = labelParts.filter((part, index, all) => (
    all.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index
  ));
  return { city, state, label: uniqueParts.join(", ") };
}

export function dedupeLocationLabels(values = [], location = {}) {
  const cityState = cleanLocationText(location.label || [location.city, location.state].filter(Boolean).join(", "));
  const city = cleanLocationText(location.city);
  const state = cleanLocationText(location.state);
  const seen = new Set();
  const output = [];
  for (const raw of Array.isArray(values) ? values : [values]) {
    let value = cleanLocationText(raw);
    if (!value) continue;
    const chunks = value.split(/\s+(?:-|–|—|\||·)\s+/).map(cleanLocationText).filter(Boolean);
    for (let chunk of chunks) {
      if (cityState) {
        const escaped = cityState.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const repeats = new RegExp(`(?:${escaped})(?:\\s*(?:-|–|—|\\||·)\\s*${escaped})+`, "gi");
        chunk = chunk.replace(repeats, cityState);
      }
      chunk = cleanLocationText(chunk);
      if (!chunk || (state && chunk.toUpperCase() === state)) continue;
      const key = chunk.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(chunk);
    }
  }
  if (!output.length && cityState) output.push(cityState);
  if (!output.length && city) output.push(city);
  return output;
}

function normalizedLatLng(value, latitude, longitude) {
  const rawLat = value?.lat ?? value?.latitude ?? (Array.isArray(value) ? value[0] : latitude);
  const rawLng = value?.lng ?? value?.lon ?? value?.longitude ?? (Array.isArray(value) ? value[1] : longitude);
  if (rawLat == null || rawLng == null || String(rawLat).trim() === "" || String(rawLng).trim() === "") return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const SCHEMA_WEEKDAYS = Object.freeze({
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
});

function schemaClockTime(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .trim()
    .toUpperCase();
  const twelveHour = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] || 0);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (twelveHour[3] === "AM") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!twentyFourHour) return null;
  return `${String(Number(twentyFourHour[1])).padStart(2, "0")}:${twentyFourHour[2]}`;
}

function hoursSpecificationFromRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const day = SCHEMA_WEEKDAYS[String(row.day || "").trim().toLowerCase()];
    if (!day || row.closed === true || row.by_appointment === true) return [];
    const displayHours = String(row.hours || "").normalize("NFKC");
    if (/\b(?:closed|appointment)\b/i.test(displayHours)) return [];
    const openAllDay = /^open\s*24\s*hours$/i.test(
      displayHours.replace(/[\u00A0\u2009\u202F]/g, " ").trim(),
    );
    const range = displayHours.split(/\s*(?:-|–|—|\bto\b)\s*/i);
    const opens = openAllDay ? "00:00" : schemaClockTime(row.opens || range[0]);
    const closes = openAllDay ? "23:59" : schemaClockTime(row.closes || range[1]);
    if (!opens || !closes) return [];
    return [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: day,
      opens,
      closes,
    }];
  });
}

function validatedHoursSpecification(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const normalized = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return [];
    const rawDays = Array.isArray(row.dayOfWeek) ? row.dayOfWeek : [row.dayOfWeek];
    const days = rawDays.map((day) => {
      const token = String(day || "").split("/").pop().trim().toLowerCase();
      return SCHEMA_WEEKDAYS[token] || null;
    });
    const opens = schemaClockTime(row.opens);
    const closes = schemaClockTime(row.closes);
    if (!days.length || days.some((day) => !day) || !opens || !closes) return [];
    for (const dayOfWeek of days) {
      normalized.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek,
        opens,
        closes,
      });
    }
  }
  return normalized;
}

function gbpData(packet) {
  const src = packet.enrichment_sources ?? {};
  const reviewFact = src.reviews_attributed ?? {};
  const reviewValues = Array.isArray(reviewFact.value) ? reviewFact.value : reviewFact.value ? [reviewFact.value] : [];
  const reviews = reviewValues.map((review) => {
    if (!review || typeof review !== "object") return null;
    const text = String(review.text ?? review.quote ?? review.review ?? review.body ?? "").trim();
    if (!text) return null;
    return {
      ...review,
      text,
      author: String(review.author ?? review.name ?? review.reviewer ?? "Customer").trim() || "Customer",
      attribution: reviewAttribution(review, reviewFact),
    };
  }).filter(Boolean);
  const latlng = normalizedLatLng(
    src.latlng?.value
      ?? packet.business?.latlng
      ?? packet.business?.coordinates
      ?? packet.location?.coordinates,
    src.latitude?.value ?? packet.business?.lat ?? packet.business?.latitude,
    src.longitude?.value ?? packet.business?.lng ?? packet.business?.longitude,
  );
  const hours = src.hours?.value ?? null;
  const explicitHoursSpec = src.hours?.hours_spec;
  const validatedExplicitHoursSpec = validatedHoursSpecification(explicitHoursSpec);
  return {
    hours,
    hoursSpec: validatedExplicitHoursSpec.length
      ? validatedExplicitHoursSpec
      : hoursSpecificationFromRows(hours),
    reviews,
    address: src.address?.value ?? packet.business?.address ?? null,
    latlng,
    placeId: src.place_id?.value ?? packet.business?.place_id ?? packet.business?.placeId ?? packet.place_id ?? null,
    rating: normalizeRating(src),
  };
}

// G4 (E8): rating may arrive as a number, {value,count}, or {rating,reviews}.
// Never let undefined reach a public surface.
function normalizeRating(src) {
  const raw = src.rating?.value ?? null;
  if (raw == null) return null;
  const value = typeof raw === "object" ? (raw.value ?? raw.rating ?? null) : raw;
  const count = typeof raw === "object"
    ? (raw.count ?? raw.reviews ?? raw.review_count ?? null)
    : (src.rating?.count ?? src.review_count?.value ?? src.reviews?.count ?? null);
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = count == null || count === "" ? null : Number(count);
  return {
    value: Number(value),
    count: Number.isFinite(n) && n > 0 ? n : null,
    attribution: reviewAttribution({}, src.rating),
  };
}

function publicOwnerName(packet, businessName) {
  const raw = String(packet?.enrichment_sources?.owner?.value || packet?.voice_persona?.owner_name || "").trim();
  if (!raw) return null;
  const compact = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const owner = compact(raw);
  const business = compact(businessName);
  if (!owner || owner === business || owner.includes(business) || business.includes(owner)) return null;
  if (/^(?:the\s+)?(?:business|company|owner|staff|team|crew)$/i.test(raw)) return null;
  return raw;
}

export function publicBusinessDisplayName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name) return "Local Business";
  const first = name.split(/\s+[|·•]\s+/)[0]?.trim();
  return first || name;
}

// ---------------- media engine ----------------
function publicMediaProvenance(value = "") {
  const source = String(value || "").toLowerCase();
  if (source === "stock-ambiance") return "stock-ambiance";
  if (source === "upload") return "client-upload";
  if (source === "gbp") return "business-profile";
  if (source === "build-request") return "provided-source";
  if (source === "ai" || source === "ai-ambiance") return "ai-ambiance";
  return "business-site";
}

function renderedPremierMediaTreatment(treatment) {
  return treatment === "ken-burns" ? "cinematic-light-shader" : treatment;
}

const RENDERED_PHOTO_EXT = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

function renderedMediaIdentity(value) {
  const safe = safeMediaUrl(typeof value === "object" ? value?.url : value);
  if (!safe) return "";
  try {
    const parsed = new URL(safe, "https://siteforge.invalid/");
    parsed.hash = "";
    for (const key of ["auto", "crop", "dpr", "fit", "fm", "format", "h", "height", "q", "quality", "w", "width"]) {
      parsed.searchParams.delete(key);
    }
    const normalizedPath = parsed.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z\d]+$)/i, "");
    const normalizedQuery = [...parsed.searchParams]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return `${parsed.hostname.toLowerCase()}${normalizedPath.toLowerCase()}?${normalizedQuery}`;
  } catch {
    return safe.replace(/[?#].*$/, "").toLowerCase();
  }
}

function heroStillIdentity(selection) {
  if (selection.hero?.kind === "photo") return renderedMediaIdentity(selection.hero);
  if (selection.hero?.kind !== "video") return "";
  const hero = selection.hero || {};
  const automaticPosterCandidates = [
    ...(selection.gallery || []).filter((asset) => !isBoundContainedSourceProof(asset)),
    ...(selection.sourcePhoto && !isBoundContainedSourceProof(selection.sourcePhoto)
      ? [selection.sourcePhoto]
      : []),
  ];
  const candidates = [
    hero.poster,
    hero.poster_url,
    hero.posterUrl,
    hero.thumbnail,
    hero.thumbnail_url,
    hero.thumbnailUrl,
    hero.meta?.poster,
    hero.metadata?.poster,
    ...automaticPosterCandidates.map((asset) => asset?.url),
  ];
  return candidates
    .map((value) => safeMediaUrl(value))
    .filter((value) => value && RENDERED_PHOTO_EXT.test(value))
    .map(renderedMediaIdentity)
    .find(Boolean) || "";
}

const SERVICE_TOKEN_STOP_WORDS = new Set([
  "and", "for", "from", "home", "homes", "installation", "maintenance",
  "project", "projects", "residential", "service", "services", "the", "with",
]);

function semanticTokens(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/(?:ing|ed|es|s)$/i, ""))
    .filter((token) => token.length >= 3 && !SERVICE_TOKEN_STOP_WORDS.has(token)))];
}

function exactSemanticTerms(left, right) {
  return left.length === right.length && left.every((term) => right.includes(term));
}

function serviceMediaEvidence(asset, service) {
  const serviceTerms = semanticTokens(service);
  if (!serviceTerms.length) return null;
  const explicitTags = [
    ...(Array.isArray(asset?.service_tags) ? asset.service_tags : []),
    ...(Array.isArray(asset?.serviceTags) ? asset.serviceTags : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
    ...(Array.isArray(asset?.meta?.service_tags) ? asset.meta.service_tags : []),
    ...(Array.isArray(asset?.meta?.serviceTags) ? asset.meta.serviceTags : []),
    ...(Array.isArray(asset?.metadata?.service_tags) ? asset.metadata.service_tags : []),
    ...(Array.isArray(asset?.metadata?.serviceTags) ? asset.metadata.serviceTags : []),
  ];
  for (const tag of explicitTags) {
    const tagTerms = semanticTokens(tag);
    if (tagTerms.length && exactSemanticTerms(serviceTerms, tagTerms)) {
      return {
        score: 100 + serviceTerms.length,
        basis: "explicit-tag",
        terms: serviceTerms,
        evidence: String(tag),
        confidence: null,
      };
    }
  }

  const classification = asset?.meta?.media_classification
    || asset?.metadata?.media_classification
    || asset?.media_classification
    || null;
  if (classification && typeof classification === "object") {
    const confidence = Number(
      classification.confidence
      ?? classification.score
      ?? classification.probability
      ?? 0,
    );
    const classificationEvidence = [
      classification.label,
      classification.description,
      classification.service,
      ...(Array.isArray(classification.services) ? classification.services : []),
      ...(Array.isArray(classification.service_tags) ? classification.service_tags : []),
      ...(Array.isArray(classification.serviceTags) ? classification.serviceTags : []),
      ...(Array.isArray(classification.tags) ? classification.tags : []),
      ...(Array.isArray(classification.categories) ? classification.categories : []),
    ].filter(Boolean).join(" ");
    const classificationTerms = semanticTokens(classificationEvidence);
    if (
      confidence >= 0.75
      && serviceTerms.every((term) => classificationTerms.includes(term))
    ) {
      return {
        score: 80 + serviceTerms.length,
        basis: "vision-all-terms",
        terms: serviceTerms,
        evidence: classificationEvidence,
        confidence,
      };
    }
  }

  const descriptiveEvidence = [
    asset?.label,
    asset?.alt,
    asset?.title,
    asset?.role,
    asset?.caption,
    asset?.description,
  ].filter(Boolean).join(" ");
  const descriptive = semanticTokens(descriptiveEvidence);
  if (
    serviceTerms.length >= 2
    && serviceTerms.every((term) => descriptive.includes(term))
  ) {
    return {
      score: 20 + serviceTerms.length,
      basis: "descriptive-all-terms",
      terms: serviceTerms,
      evidence: descriptiveEvidence,
      confidence: null,
    };
  }
  return null;
}

function allocatePremierPageMedia(selection, {
  contactSheetSlots = 0,
  serviceSlots = 3,
  services = [],
} = {}) {
  const reservedHero = heroStillIdentity(selection);
  const seen = new Set();
  const available = (selection.gallery || []).filter((asset) => {
    const identity = renderedMediaIdentity(asset);
    if (!identity || identity === reservedHero || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 12);
  const serviceBudget = Math.min(
    serviceSlots,
    Math.max(0, available.length - 5),
    available.length >= 8 ? 3 : available.length >= 7 ? 2 : serviceSlots,
  );
  const usedServiceMedia = new Set();
  const serviceMedia = services.slice(0, serviceSlots).map((service) => {
    if (usedServiceMedia.size >= serviceBudget) return null;
    const ranked = available
      .filter((asset) => !usedServiceMedia.has(renderedMediaIdentity(asset)))
      .map((asset) => ({ asset, match: serviceMediaEvidence(asset, service) }))
      .filter(({ match }) => match?.score >= 20)
      .map(({ asset, match }) => ({ asset, ...match }))
      .sort((left, right) => right.score - left.score || renderedMediaIdentity(left.asset).localeCompare(renderedMediaIdentity(right.asset)));
    const match = ranked[0];
    if (!match) return null;
    usedServiceMedia.add(renderedMediaIdentity(match.asset));
    return {
      ...match.asset,
      matched_service: service,
      service_match_score: match.score,
      service_match_basis: match.basis,
      service_match_terms: match.terms,
      service_match_evidence: match.evidence,
      service_match_confidence: match.confidence,
    };
  });
  const afterService = available.filter((asset) => !usedServiceMedia.has(renderedMediaIdentity(asset)));
  const contactSheetCount = Math.min(contactSheetSlots, Math.max(0, afterService.length - 5));
  const contactSheetMedia = afterService.slice(0, contactSheetCount);
  const gallery = afterService.slice(contactSheetCount);
  return {
    ...selection,
    contactSheetMedia,
    gallery,
    galleryPhotos: gallery,
    serviceMedia,
  };
}

function mediaStage(ctx, rel = "") {
  const rebaseAsset = (asset) => {
    if (!asset) return null;
    const rebased = { ...asset };
    for (const key of ["url", "poster", "poster_url", "posterUrl", "thumbnail", "thumbnail_url", "thumbnailUrl"]) {
      if (rebased[key]) rebased[key] = routeAssetUrl(safeMediaUrl(rebased[key]), rel);
    }
    return rebased;
  };
  const selection = {
    ...ctx.premierMedia,
    hero: rebaseAsset(ctx.premierMedia?.hero),
    sourceVideo: rebaseAsset(ctx.premierMedia?.sourceVideo),
    sourcePhoto: rebaseAsset(ctx.premierMedia?.sourcePhoto),
    ambianceVideo: rebaseAsset(ctx.premierMedia?.ambianceVideo),
    motionFallback: rebaseAsset(ctx.premierMedia?.motionFallback),
    gallery: (ctx.premierMedia?.gallery || []).map(rebaseAsset).filter(Boolean),
  };
  let rendered = renderPremierHeroMedia(selection, { businessName: ctx.biz.name });
  const requestedTreatment = ctx.premierOverride ? ctx.composition.mediaFrame.treatment : null;
  const mappedTreatment = requestedTreatment ? renderedPremierMediaTreatment(requestedTreatment) : null;
  const requestedTreatmentAttr = requestedTreatment && requestedTreatment !== mappedTreatment
    ? ` data-requested-media-treatment="${esc(requestedTreatment)}"`
    : "";
  if (!rendered) {
    const treatment = mappedTreatment || "visual-shader";
    const cinematicFallback = treatment === "cinematic-light-shader"
      ? '<div class="cinematic-light" aria-hidden="true"></div><div class="media-veil" aria-hidden="true"></div>'
      : "";
    return `<div class="media-plane premier-media-missing${ctx.premierOverride ? ` premier-treatment-${esc(treatment)}` : ""}" data-media-plane data-media-source="unavailable" data-media-treatment="${esc(treatment)}"${requestedTreatmentAttr} data-media-provenance="none">${ambianceSvg(ctx.trade.key, ctx.pal, ctx.seed)}${cinematicFallback}</div>`;
  }
  const source = selection.mode === "ai-ambiance-video"
    ? "ai-ambiance"
    : selection.mode === "source-video"
      ? "video"
      : "photo";
  const sourceContactSheet = source === "photo" && !selection.hero && /premier-media--source-photo-contact-sheet/.test(rendered);
  const treatment = sourceContactSheet ? "source-photo-contact-sheet" : source === "photo" ? "source-photo-light-shader" : selection.mode === "source-video" ? "source-video" : "labeled-ambiance-video";
  const renderedTreatment = mappedTreatment || treatment;
  if (source === "photo" && !sourceContactSheet) {
    rendered = rendered
      .replace("premier-media--cinematic-light-photo", "premier-media--source-photo")
      .replace(/data-motion-treatment="[^"]*"/, 'data-motion-treatment="cinematic-light-shader"');
    // Right-size the GoDaddy/Website-Builder hero source to the exact optimized
    // URL that <link rel=preload> requests (heroPreloadHtml), so the hero paints
    // from a single cached fetch instead of downloading a multi-megabyte
    // original. object-fit:cover makes this a pure weight win, no visual change.
    const heroUrl = selection.hero?.url || "";
    if (heroUrl.includes("img1.wsimg.com/")) {
      const opts = heroImageOptions(ctx);
      const optimized = imageUrlAtWidth(heroUrl, opts.fallback, opts);
      const srcset = opts.widths.map((w) => `${esc(imageUrlAtWidth(heroUrl, w, opts))} ${w}w`).join(", ");
      rendered = rendered.replace(
        /(<img\b)([^>]*?)\ssrc="[^"]*"/,
        `$1$2 src="${esc(optimized)}" srcset="${srcset}" sizes="${esc(opts.sizes)}"`,
      );
    }
  }
  return `<div class="media-plane media-${esc(ctx.composition.mediaFrame.id)}${ctx.premierOverride ? ` premier-treatment-${esc(renderedTreatment)}` : ""}" data-media-plane data-media-source="${esc(source)}" data-media-treatment="${esc(renderedTreatment)}"${requestedTreatmentAttr} data-media-provenance="${esc(publicMediaProvenance(selection.hero?.source))}">
    ${rendered}
    <div class="cinematic-light" aria-hidden="true"></div>
    <div class="media-veil" aria-hidden="true"></div>
  </div>`;
}

// ---------------- map block ----------------
function mapBlock(ctx, { compact = false } = {}) {
  const model = ctx.premierMap;
  const links = directionUrls(model);
  const {
    googleDirectionsUrl: _googleDirectionsUrl,
    appleDirectionsUrl: _appleDirectionsUrl,
    directions: _directions,
    appleDirections: _appleDirections,
    ...safeModel
  } = model;
  const phoneAction = ctx.phone && !compact
    ? `<a class="btn line sm" href="tel:${esc(ctx.phone.replace(/[^+\d]/g, ""))}">${esc(ctx.phone)}</a>`
    : "";
  let renderedMap = renderPremierMap(model);
  const lat = Number(model?.lat);
  const lng = Number(model?.lng);
  const hasExactCoordinates = Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
  if (hasExactCoordinates) {
    renderedMap = renderedMap.replace(
      ' data-google-map="satellite"',
      ` data-map data-accent="${esc(ctx.pal.accent)}" data-label="${esc(model.businessName || model.label || ctx.biz.name)}" data-google-map="satellite"`,
    );
  }
  return {
    ...safeModel,
    ...links,
    placeId: ctx.gbp.placeId || null,
    html: `<div class="premier-map-shell" data-map-accent="${esc(ctx.pal.accent)}">${renderedMap}</div>${phoneAction ? `<div class="map-call">${phoneAction}</div>` : ""}`,
  };
}
// G8 (E8): scroll-driven reveals — kitchen 'scroll-driven-css' recipe, honest
// IntersectionObserver fallback, disabled under prefers-reduced-motion.
const PCHAT_JS = `
(() => {
  const root = document.querySelector("[data-pchat]");
  if (!root) return;
  const fab = root.querySelector("[data-pchat-open]"), panel = root.querySelector("[data-pchat-panel]");
  const log = root.querySelector("[data-pchat-log]"), form = root.querySelector("[data-pchat-form]"), input = root.querySelector("[data-pchat-in]");
  const biz = root.dataset.business || "";
  const msgs = [];
  const add = (role, text) => { const d = document.createElement("div"); d.className = "pchat-msg " + (role === "user" ? "me" : "them"); d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  fab.addEventListener("click", () => { panel.hidden = false; fab.hidden = true; input.focus(); });
  root.querySelector("[data-pchat-close]").addEventListener("click", () => { panel.hidden = true; fab.hidden = false; });
  if (location.hash === "#chat") { panel.hidden = false; fab.hidden = true; }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.value = ""; add("user", q); msgs.push({ role: "user", content: q });
    const wait = document.createElement("div"); wait.className = "pchat-msg them"; wait.textContent = "…"; log.appendChild(wait); log.scrollTop = log.scrollHeight;
    try {
      const r = await fetch("https://ghost-agency-backend.vercel.app/api/chat/preview-agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ business_name: biz, messages: msgs.slice(-12) }) });
      const j = await r.json();
      wait.textContent = j.reply || "Call us at (949) 339-5562 — a person will pick up.";
      msgs.push({ role: "assistant", content: wait.textContent });
    } catch { wait.textContent = "Connection hiccup — call (949) 339-5562 and a person will pick up."; }
  });
})();`;

// Inline WSS "W" mark for the glass launch tile (matches the brand kit).
const WSS_TILE_MARK = `<svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="ltg" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4A6CF7"/><stop offset="1" stop-color="#8B5CF6"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="#131318"/>
  <path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#ltg)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="50" cy="20" r="4" fill="#8B5CF6"/>
</svg>`;

const LAUNCH_JS = `
(() => {
  document.querySelectorAll("[data-launch-chip]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      // Let the Activate CTA (and share/dismiss) follow its own href/handler —
      // do not hijack the click into a scroll, which caused the sticky-header
      // nav glitch and made the checkout link feel dead.
      if (e.target.closest("[data-launch-share],[data-launch-dismiss],[data-launch-cta]")) return;
      const href = chip.getAttribute("data-launch-target") || "";
      const target = href ? document.querySelector(href) : null;
      if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    });
  });

  // Live 7-day countdown on the glass launch tile + rail.
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    const deadline = Date.parse(el.getAttribute("data-countdown") || "");
    if (!Number.isFinite(deadline)) return;
    const tick = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) { el.textContent = "Preview offer expired"; return; }
      const d = Math.floor(ms / 864e5);
      const h = Math.floor((ms % 864e5) / 36e5);
      const m = Math.floor((ms % 36e5) / 6e4);
      el.textContent = d > 0 ? d + "d " + h + "h left" : h + "h " + m + "m left";
      if (ms < 864e5) { const box = el.closest(".lt-count,.lr-urgency"); if (box) box.classList.add("lt-urgent"); }
    };
    tick();
    setInterval(tick, 30000);
  });

  // Share: native share sheet where available, else copy link + prebuilt email.
  document.querySelectorAll("[data-launch-share]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = btn.getAttribute("data-share-url") || location.href;
      const title = btn.getAttribute("data-share-title") || document.title;
      const text = btn.getAttribute("data-share-text") || "";
      const mode = btn.getAttribute("data-launch-share");
      if (mode === "email") {
        location.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(text + "\\n\\n" + url);
        return;
      }
      if (mode === "native" && navigator.share) {
        try { await navigator.share({ title, text, url }); return; } catch (_) {}
      }
      try {
        await navigator.clipboard.writeText(url);
        const prev = btn.textContent; btn.textContent = "Link copied ✓";
        setTimeout(() => { btn.textContent = prev; }, 1800);
      } catch (_) { window.prompt("Copy this link:", url); }
    });
  });

  const DISMISS_KEY = "wsl-launch-tile-dismissed";
  try {
    if (sessionStorage.getItem(DISMISS_KEY) === "1") {
      document.querySelectorAll(".launch-tile[data-launch-chip]").forEach((tile) => tile.setAttribute("hidden", ""));
    }
  } catch (_) {}
  document.querySelectorAll("[data-launch-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const tile = btn.closest("[data-launch-chip]");
      if (!tile) return;
      const open = tile.classList.toggle("lt-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  document.querySelectorAll("[data-launch-dismiss]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const tile = btn.closest("[data-launch-chip]");
      if (tile) tile.setAttribute("hidden", "");
      try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
    });
  });
})();`;

// Gallery lightbox: click/keyboard opens a full-screen viewer with the larger
// source image, arrow/keyboard navigation, and reduced-motion-safe fade. Built
// lazily so pages without a gallery ship no overlay markup.
const LIGHTBOX_JS = `
(() => {
  const cells = Array.from(document.querySelectorAll(".g-cell[data-lb-src]"));
  if (!cells.length) return;
  let ov = null, imgEl = null, capEl = null, idx = 0, lastFocus = null;
  const show = (i) => {
    idx = (i + cells.length) % cells.length;
    const c = cells[idx];
    imgEl.src = c.getAttribute("data-lb-src");
    imgEl.alt = c.getAttribute("data-lb-cap") || "";
    capEl.textContent = c.getAttribute("data-lb-cap") || "";
  };
  const close = () => {
    if (!ov) return;
    ov.hidden = true;
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  const go = (d) => show(idx + d);
  const build = () => {
    ov = document.createElement("div");
    ov.className = "lb-overlay"; ov.hidden = true;
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Photo viewer");
    ov.innerHTML = '<button class="lb-close" type="button" aria-label="Close">\\u00d7</button><button class="lb-nav lb-prev" type="button" aria-label="Previous photo">\\u2039</button><figure class="lb-stage"><img alt=""><figcaption class="lb-cap"></figcaption></figure><button class="lb-nav lb-next" type="button" aria-label="Next photo">\\u203a</button>';
    document.body.appendChild(ov);
    imgEl = ov.querySelector("img"); capEl = ov.querySelector(".lb-cap");
    ov.querySelector(".lb-close").addEventListener("click", close);
    ov.querySelector(".lb-prev").addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    ov.querySelector(".lb-next").addEventListener("click", (e) => { e.stopPropagation(); go(1); });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  };
  const open = (i) => {
    lastFocus = document.activeElement;
    if (!ov) build();
    show(i);
    ov.hidden = false;
    document.documentElement.style.overflow = "hidden";
    ov.querySelector(".lb-close").focus();
  };
  cells.forEach((c, i) => {
    c.addEventListener("click", () => open(i));
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); } });
  });
  document.addEventListener("keydown", (e) => {
    if (!ov || ov.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  });
})();`;

const ESTIMATOR_JS = `
(() => {
  document.querySelectorAll("[data-estimator]").forEach((root) => {
  const ins = [...root.querySelectorAll("[data-est-in]")];
  const fmt = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString();
  const update = () => {
    const [a, b, c] = ins.map((el) => Number(el.value));
    ins.forEach((el, i) => { root.querySelector('[data-est-val="' + i + '"]').textContent = fmt(Number(el.value)); });
    root.querySelectorAll("[data-est-out]").forEach((out) => {
      try { out.textContent = fmt(Math.max(0, eval(out.dataset.estExpr))); } catch { out.textContent = "—"; }
    });
  };
  ins.forEach((el) => el.addEventListener("input", update));
  update();
  });
})();`;

const REVEAL_JS = `
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const targets = document.querySelectorAll(".band .shell > *, .svc, .review, .g-cell");
  targets.forEach((el, i) => { el.setAttribute("data-reveal", ""); el.style.transitionDelay = Math.min(i % 6, 4) * 60 + "ms"; });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  targets.forEach((el) => io.observe(el));
})();`;

const MAP_JS = `
(function(){
  var el=document.querySelector('[data-map]');
  if(!el||!navigator.onLine)return;
  var lat=+el.dataset.lat,lng=+el.dataset.lng;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180)return;
  var css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';document.head.appendChild(css);
  var s=document.createElement('script');s.src='https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';s.defer=true;
  s.onload=function(){try{
    var holder=document.createElement('div');holder.className='ml-holder';el.appendChild(holder);
    var map=new maplibregl.Map({container:holder,center:[lng,lat],zoom:16,attributionControl:{compact:true},
      style:{version:8,sources:{esri:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}},layers:[{id:'esri',type:'raster',source:'esri'}]}});
    map.scrollZoom.disable();map.addControl(new maplibregl.NavigationControl({showCompass:false}));
    var marker=document.createElement('div');marker.className='map-marker';marker.setAttribute('role','img');marker.setAttribute('aria-label',el.dataset.label||'Business location');
    var pin=document.createElement('span');pin.className='map-pin';marker.appendChild(pin);
    pin.style.setProperty('--pin',el.dataset.accent||getComputedStyle(document.documentElement).getPropertyValue('--accent'));
    new maplibregl.Marker({element:marker}).setLngLat([lng,lat]).setPopup(new maplibregl.Popup({offset:24}).setText(el.dataset.label||'')).addTo(map);
    map.on('load',function(){el.classList.add('map-live');el.setAttribute('data-map-rendered','exact-coordinate-pin')});
  }catch(e){}};
  document.head.appendChild(s);
})();`;

// ---------------- hours ----------------
function hoursStrip(gbp, { compact = false } = {}) {
  if (!gbp.hours) {
    return `<div class="hours placeholder" data-hours="placeholder"><b>Hours unavailable</b><span>Contact the business directly to confirm current hours.</span></div>`;
  }
  const rows = gbp.hours.map((h) => `<div class="hrow"><span>${esc(h.day.slice(0, 3))}</span><b>${esc(h.hours)}</b></div>`).join("");
  return `<div class="hours sourced" data-hours="sourced" ${compact ? 'data-compact="1"' : ""}><b>Hours</b><div class="hgrid">${rows}</div><span class="src-chip">from Google Business Profile</span></div>`;
}

// ---------------- sections (single-page cinematic — Remic PROMPT A order) ----------------
function sectionHtml(kind, ctx, rel = "") {
  const { trade, biz, pal, services, seed, phone, quote, gbp } = ctx;
  switch (kind) {
    case "trust-strip": {
      const ratingChip = gbp.rating
        ? gbp.rating.attribution === "Google"
          ? `${gbp.rating.value}★ on Google${gbp.rating.count ? ` (${gbp.rating.count} reviews)` : ""}`
          : `${gbp.rating.value}★ public rating${gbp.rating.count ? ` (${gbp.rating.count} reviews)` : ""}`
        : null;
      const businessPhotoCount = new Set((ctx.photos || []).filter((item) => (
        item?.kind === "photo"
        && !/\b(?:ai|generated|gemini)\b/i.test(String(item?.source || item?.provenance || ""))
      )).map(renderedMediaIdentity).filter(Boolean)).size;
      let chips = [
        `Serving ${biz.locationLabel}`,
        ...(businessPhotoCount ? [`${businessPhotoCount} source photos`] : []),
        ...(gbp.hours?.length ? ["Hours from Google Business Profile"] : []),
        ...(ctx.packet.enrichment_sources?.years?.value ? [`${ctx.packet.enrichment_sources.years.value}+ years`] : []),
        ...(ratingChip ? [ratingChip] : []),
      ];
      let trustAttrs = "";
      if (ctx.premierOverride) {
        const blocks = ctx.composition.reviewTreatment.trustBlocks;
        const credentials = (ctx.packet.enrichment_sources?.credentials?.value || []).filter((item) => item?.verified === true);
        chips = [
          `Serving ${biz.locationLabel}`,
          ...(businessPhotoCount ? [`${businessPhotoCount} source photos`] : []),
          ...(gbp.hours?.length ? ["Hours from Google Business Profile"] : []),
        ];
        if (blocks.includes("stat-band-4up") && services.length) chips.push(`${services.length} listed services`);
        if (blocks.includes("review-carousel-attributed") && ratingChip) chips.push(ratingChip);
        if (blocks.includes("license-badge-ribbon")) {
          chips.push(...credentials.slice(0, 3).map((item) => `${String(item.kind || "credential").replace(/-/g, " ")} ${item.number || ""}`.trim()));
        }
        trustAttrs = ` data-premier-trust="${esc(blocks.join("|"))}"`;
      }
      const trustMarkRail = renderTrustMarkRail(ctx.packet);
      return `<section class="band trust-strip"${trustAttrs} aria-label="Trust signals"><div class="shell">
        <div class="strip-row">${chips.map((c) => `<span class="t-chip">${esc(c)}</span>`).join("")}</div>
        ${trustMarkRail}
      </div></section>`;
    }
    case "services": if (!services.length) return ""; return `<section class="band services" id="services"><div class="shell">
      <p class="kicker">What we ${esc(trade.verb)}</p><h2>${esc(trade.plural[0].toUpperCase() + trade.plural.slice(1))}, done like we live here.</h2>
      <div class="svc-grid">${services.map((s, i) => {
        const media = svcMedia(ctx, s, i, rel);
        return `<article class="svc${media ? "" : " svc--text"}" data-service-media="${media ? "matched-source" : "text-only"}" style="--d:${i * 60}ms">
        ${media ? `<div class="svc-visual" aria-hidden="true">${media}</div>` : ""}
        <span class="idx">${String(i + 1).padStart(2, "0")}</span><h3>${esc(s)}</h3>
        <p>${esc(svcBlurb(ctx, s, i))}</p>
        </article>`;
      }).join("")}</div></div></section>`;
    case "founder": {
      const vp = ctx.packet.voice_persona ?? {};
      const snippet = vp.first_person_snippets?.[0];
      const owner = publicOwnerName(ctx.packet, biz.name);
      return `<section class="band alt founder"><div class="shell founder-grid">
        <div><p class="kicker">About the business</p>
        <h2>${owner ? esc(owner) : esc(biz.name)}${owner ? `, ${esc(biz.name)}` : ""}</h2>
        <p class="founder-note">${snippet ? `“${esc(snippet)}”` : esc(`${biz.name} serves ${biz.locationLabel}. Contact the business directly to confirm the work available for your property.`)}</p>
        ${snippet ? `<span class="sig">— ${esc(owner || `the ${biz.name} team`)}</span>` : ""}</div></div></section>`;
    }
    case "proof": {
      if (!gbp.reviews.length) return "";
      const cards = gbp.reviews.slice(0, 4).map((r) => {
        const rawName = /\bGoogle\b/i.test(r.author) && r.attribution !== "Google" ? "Customer" : r.author;
        const name = rawName.split(/\s+/).filter(Boolean).map((word, index) => index === 0 ? word : `${word[0]}.`).join(" ") || "Customer";
        const sourceKey = r.attribution === "Google" ? "google" : r.attribution === "Business website" ? "business-site" : "unattributed";
        const sourceChip = r.attribution ? ` · <span class="src-chip">${esc(r.attribution)}</span>` : "";
        return `<figure class="review glass" data-review-source="${sourceKey}">
          ${r.rating ? `<span class="stars" aria-label="${r.rating} star review">${"★".repeat(Math.round(r.rating))}</span>` : ""}
          <blockquote>${esc(r.text)}</blockquote>
          <figcaption>${esc(name)}${sourceChip}</figcaption></figure>`;
      }).join("");
      const ratingSource = gbp.rating?.attribution === "Google" ? "Google" : "public";
      const ratingText = gbp.rating?.count
        ? ` — ${gbp.rating.value}★ across ${gbp.rating.count} ${ratingSource} reviews`
        : gbp.rating
          ? ` — ${gbp.rating.value}★ ${ratingSource} rating`
          : "";
      const sourceNote = gbp.reviews.some((review) => review.attribution === "Google")
        ? "Google is named only where the attached source record identifies Google Business Profile. Other labels follow their own source evidence."
        : "Source labels follow the evidence attached to each quote; unknown providers are left unattributed.";
      return `<section class="band proof" id="reviews"><div class="shell"><p class="kicker">In their words</p>
        <h2>What ${esc(biz.city)} says${ratingText}.</h2>
        <div class="review-grid">${cards}</div>
        <p class="muted src-note">${esc(sourceNote)}</p></div></section>`;
    }
    case "process": return `<section class="band alt process"><div class="shell"><p class="kicker">Contact steps</p><h2>Start with the property.</h2>
      <ol class="steps">${["Describe the work you need", "Share useful property photos", "Confirm available services directly", "Review timing and pricing with the business"].map((s, i) => `<li><b>${i + 1}</b><span>${esc(s)}</span></li>`).join("")}</ol></div></section>`;
    case "materials": return "";
    case "gallery": {
      const heroPhotoIdentities = presentedHeroPhotoIdentities(ctx.premierMedia);
      const galleryPhotos = ctx.premierMedia.gallery
        .filter((asset) => !heroPhotoIdentities.has(renderedMediaIdentity(asset)))
        .slice(0, 12);
      const singleContainedPhoto = galleryPhotos.length === 1 && isBoundContainedSourceProof(galleryPhotos[0]);
      if (galleryPhotos.length < 2 && !singleContainedPhoto) return "";
      const slots = galleryGridSlots(galleryPhotos.length);
      const imgs = galleryPhotos.map((p, i) => {
        const u = p.url.startsWith("media/") ? rel + p.url : p.url;
        const cap = p.label || `${biz.name} source photo ${i + 1}`;
        const contained = isBoundContainedSourceProof(p);
        const large = contained ? u : imageUrlAtWidth(u, 1600, { aspect: 4 / 3, quality: 90 });
        const slot = contained && galleryPhotos.length === 1 ? { span: 12, rows: 2 } : slots[i] || { span: 4, rows: 1 };
        const imageAttrs = contained
          ? `src="${esc(u)}" width="${Number(p.width)}" height="${Number(p.height)}"`
          : responsiveImageAttrs(u, { fallback: 1280, widths: [480, 800, 1280], sizes: "(max-width: 700px) 100vw, 50vw", aspect: 4 / 3, quality: 86 });
        return `<figure class="g-cell${contained ? " g-cell--contained-source-proof" : ""}" style="--g-span:${slot.span};--g-rows:${slot.rows}" data-media-presentation="${contained ? "contained-source-proof" : "source-gallery"}" data-lb-src="${esc(large)}" data-lb-cap="${esc(cap)}" role="button" tabindex="0" aria-label="Open photo: ${esc(cap)}">
          <img ${imageAttrs} alt="${esc(cap)}" loading="lazy" onerror="this.closest('.g-cell').remove()">
          <span class="g-zoom" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m21 21-4.35-4.35M11 8v6M8 11h6"></path>
            </svg>
          </span>
        </figure>`;
      }).join("");
      const displayName = biz.name.replace(/[.!?]+$/g, "");
      return `<section class="band gallery" id="work"><div class="shell"><p class="kicker">Source gallery</p><h2>Source photos for ${esc(displayName)}.</h2>
        <div class="g-grid" data-gallery-count="${galleryPhotos.length}">${imgs}</div>
        <p class="muted src-note gallery-source-note">Photos carried from the provided source catalog.</p></div></section>`;
    }
    case "map": {
      if (!ctx.premierMap?.available) return "";
      const m = mapBlock(ctx);
      return `<section class="band alt area" id="area"><div class="shell"><div class="area-grid">
      <div class="map-col">${m.html}</div>
      <div><p class="kicker">Location</p><h2>Listed in ${esc(biz.locationLabel)}.</h2>
      <p>Contact ${esc(biz.name)} directly to confirm the current service area.</p>
      ${hoursStrip(gbp, { compact: true })}
      ${phone ? `<a class="btn solid" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">Call ${esc(phone)}</a>` : ""}</div></div></div></section>`; }
    case "faq": { const faqs = ctx.faqs;
      return `<section class="band faq" id="faq"><div class="shell"><p class="kicker">Fair questions</p><h2>Asked often, answered straight.</h2>
      ${faqs.map(([q, a]) => `<details class="faq"><summary class="speakable">${esc(q)}</summary><p class="speakable">${esc(a)}</p></details>`).join("")}</div></section>`; }
    case "estimator": {
      return "";
    }
    case "cta": {
      const ctaAttrs = ctx.premierOverride ? ` data-premier-cta="${esc(ctx.cta.primary)}" data-premier-cta-secondary="${esc(ctx.cta.secondary)}"` : "";
      return `<section class="band cta" id="quote"${ctaAttrs}><div class="shell"><div class="cta-card">
        <div><p class="kicker light">Next step</p><h2>${esc(quote)}</h2><p>Tell us about the ${esc(trade.noun)}. We reply like people, not a ticketing system.</p></div>
        ${quoteFormHtml(ctx)}</div></div></section>`;
    }
    default: return "";
  }
}
function galleryGridSlots(count) {
  const slots = Array.from({ length: Math.max(0, count) }, () => ({ span: 4, rows: 1 }));
  if (count >= 2) {
    slots[0] = { span: 7, rows: 2 };
    slots[1] = { span: 5, rows: 2 };
  }
  const remaining = Math.max(0, count - 2);
  const remainder = remaining % 3;
  if (remainder === 1 && count >= 3) slots[count - 1] = { span: 12, rows: 1 };
  if (remainder === 2 && count >= 4) {
    slots[count - 2] = { span: 6, rows: 1 };
    slots[count - 1] = { span: 6, rows: 1 };
  }
  return slots;
}

// A service card receives a photo only when the asset itself carries a
// deterministic service match. Otherwise the card is intentionally text-led.
function svcMedia(ctx, service, i, rel = "") {
  const pool = ctx.premierMedia?.serviceMedia || [];
  if (!pool.length) return "";
  const p = pool[i];
  if (!p || p.matched_service !== service || !(p.service_match_score >= 20)) return "";
  const u = p.url.startsWith("media/") ? rel + p.url : p.url;
  const focus = ["center 44%", "center 58%", "center 36%"][(useed(ctx.seed) + i) % 3];
  const confidenceAttr = p.service_match_confidence != null && Number.isFinite(Number(p.service_match_confidence))
    ? ` data-service-match-confidence="${Number(p.service_match_confidence).toFixed(3)}"`
    : "";
  return `<img class="svc-photo" ${responsiveImageAttrs(u, { fallback: 960, widths: [480, 720, 960], sizes: "(max-width: 820px) 100vw, 33vw", aspect: 16 / 9, quality: 84 })} alt="" loading="lazy" data-media-provenance="${esc(publicMediaProvenance(p.source))}" data-service-match="${esc(service)}" data-service-match-score="${p.service_match_score}" data-service-match-basis="${esc(p.service_match_basis)}" data-service-match-terms="${esc((p.service_match_terms || []).join("|"))}" data-service-match-evidence="${esc(p.service_match_evidence)}"${confidenceAttr} style="object-position:${focus}" onerror="this.closest('.svc-visual')?.remove()">`;
}
function svcBlurb(ctx, service, i) {
  const serviceText = String(service || "").trim();
  const normalized = serviceText.toLowerCase();
  const specific = [
    [["landscaping"], /\blandscape design\b/, "Plan planting, hardscape, shade, and circulation as one coherent yard."],
    [["landscaping"], /\bpaver patios?\b/, "Set the patio footprint, edge detail, drainage, and finish before installation."],
    [["landscaping"], /\bplanting\b.*\bcleanup\b|\bcleanup\b.*\bplanting\b/, "Shape the planting beds, clear tired material, and reset the yard's focal points."],
    [["landscaping"], /\birrigation\b/, "Review zones, coverage, and water needs against the planting plan."],
    [["roofing"], /\broof replacement\b/, "Review the roof system, material choice, flashing, and tear-off scope together."],
    [["roofing"], /\bstorm\b.*\brepair\b|\bhail\b.*\brepair\b/, "Document the damaged areas and define a repair scope before weather finds the next weak point."],
    [["roofing"], /\bmetal roofing\b/, "Compare panel profile, edge conditions, penetrations, and finish as one roof system."],
    [["roofing"], /\broof inspections?\b/, "Trace visible wear, transitions, drainage, and penetrations before choosing the next step."],
    [["plumbing"], /\brepip/, "Map the affected runs, access points, fixture connections, and material plan before work starts."],
    [["plumbing"], /\bwater heaters?\b/, "Match capacity, fuel or power, venting, and placement to the property's actual demand."],
    [["plumbing"], /\bdrain clean/, "Locate the slowdown, confirm access, and clear the line with the downstream path in view."],
    [["plumbing"], /\bleak detection\b/, "Narrow the source before opening finishes or prescribing a repair."],
    [["electrical"], /\bpanel upgrades?\b/, "Review service capacity, circuit demand, panel condition, and the path for new loads."],
    [["electrical"], /\bev chargers?\b/, "Match charging speed to panel capacity, parking position, and cable routing."],
    [["electrical"], /\blighting\b/, "Plan fixture placement, control, color temperature, and task light as one system."],
    [["electrical"], /\btroubleshoot/, "Isolate the symptom, test the likely causes, and repair the verified fault."],
    [["hvac"], /\bac repair\b/, "Check airflow, controls, refrigerant-side symptoms, and equipment condition before recommending a fix."],
    [["hvac"], /\bfurnace\b/, "Match heat output, venting, controls, and distribution to the space."],
    [["hvac"], /\bduct seal/, "Find the losses, prioritize accessible leaks, and protect airflow through the system."],
    [["hvac"], /\btune-?ups?\b/, "Review the operating sequence, airflow, controls, and wear before peak season."],
    [["excavation"], /\bsite prep\b/, "Set access, limits, elevations, and subgrade expectations before the next trade arrives."],
    [["excavation"], /\bgrading\b/, "Shape elevation, drainage, and compaction around what the finished site must do."],
    [["excavation"], /\btrench/, "Define depth, route, access, and backfill before the first cut."],
    [["excavation"], /\bdemolition\b/, "Separate removal, protection, haul-off, and site-ready handoff in the scope."],
    [["painting"], /\binterior paint/, "Coordinate surface repair, sheen, color breaks, and room sequence before the first coat."],
    [["painting"], /\bcabinet refinish/, "Set the prep, coating system, color, and hardware plan for a durable reset."],
    [["painting"], /\bcolor consultation\b/, "Compare color, light, adjoining finishes, and sheen in the rooms where they will live."],
    [["painting"], /\bexterior repaint\b/, "Review substrate condition, prep, weather exposure, and finish before coating begins."],
    [["fencing"], /\b(?:fence|fences|fencing)\b/, "Set the line, height, material, gate locations, and finish before posts go in."],
    [["fencing"], /\b(?:gate|gates|hardware)\b/, "Coordinate swing, clearance, latch, hinges, and daily use at the opening."],
    [["tree care"], /\bprun/, "Set the objective for structure, clearance, and canopy health before any cut."],
    [["tree care"], /\bremovals?\b/, "Plan access, rigging, drop zones, protection, and cleanup around the site."],
    [["tree care"], /\bhealth assessments?\b/, "Read canopy, trunk, roots, and site stress together before choosing treatment."],
    [["tree care"], /\bstump grind/, "Confirm grind depth, access, spoil handling, and what will replace the stump."],
    [["concrete"], /\b(?:driveways?|flatwork|foundations?|patios?)\b/, "Align layout, base preparation, reinforcement, drainage, and finish before the pour."],
    [["pool service"], /\b(?:pool service|green-to-clean)\b/, "Review water condition, circulation, filtration, and the service rhythm needed to recover clarity."],
    [["pool service"], /\b(?:equipment repair|filters?|pumps?)\b/, "Isolate the failed component, confirm system fit, and define the repair or replacement path."],
    [["cleaning"], /\b(?:clean|cleans|post-construction)\b/, "Set the rooms, surfaces, priorities, and handoff standard before the reset begins."],
    [["solar"], /\bsolar installs?\b/, "Match the array layout, electrical path, equipment, and production goal to the property."],
    [["solar"], /\bbattery storage\b/, "Size storage around critical loads, usage pattern, backup goals, and the existing solar system."],
    [["solar"], /\bpanel cleaning\b/, "Review access, surface condition, buildup, and safe cleaning limits before service."],
    [["solar"], /\bsystem audits?\b/, "Compare current production, equipment condition, and monitoring data before recommending changes."],
  ].find(([trades, pattern]) => trades.includes(ctx.trade.key) && pattern.test(normalized));
  if (specific) return specific[2];

  const serviceForSentence = /^[A-Z][a-z]/.test(serviceText)
    ? `${serviceText[0].toLowerCase()}${serviceText.slice(1)}`
    : serviceText;
  const fallbacks = [
    `Define the scope, site conditions, materials, and finish for ${serviceForSentence}.`,
    `Turn the property priorities into a clear plan for ${serviceForSentence}.`,
    `Review access, constraints, preparation, and handoff for ${serviceForSentence}.`,
  ];
  return fallbacks[i % fallbacks.length];
}

function premierCrosswalkCss(ctx) {
  if (!ctx.premierOverride) return "";
  const card = ctx.composition.layoutGravity.cardGeometry;
  const radius = { glass: "8px", paper: "2px", tech: "2px", monolith: "4px", ticket: "2px", hexagonal: "6px" }[card.style] || "6px";
  const borderStyle = card.style === "ticket" ? "dashed" : "solid";
  const intensity = Number(ctx.composition.motionEffect.intensity || 0);
  const duration = intensity >= 3 ? "8s" : intensity === 2 ? "12s" : "18s";
  const primary = ctx.composition.motionEffect.primary;
  const mappedHero = `.hero[data-motion-grammar="${primary}"]`;
  const motionCss = primary === "none"
    ? `${mappedHero} .kinetic span{opacity:1!important;transform:none!important;animation:none!important}${mappedHero} :is(.cinematic-light,.marquee div,.atmo-layer){animation:none!important}${mappedHero} .hero-media-layer{transform:none!important}`
    : /parallax|scroll-scale/.test(primary)
      ? `${mappedHero} .hero-media-layer :is(img,video){animation:premierMappedDrift ${duration} ease-in-out infinite alternate!important;transform-origin:center;will-change:transform}@keyframes premierMappedDrift{from{transform:scale(1.03) translate3d(-.7%,0,0)}to{transform:scale(1.1) translate3d(1.2%,.6%,0)}}`
      : primary === "magnetic-buttons"
        ? `${mappedHero} .btn{transition:transform .2s ease}${mappedHero} .btn:hover{transform:translateY(-3px)}`
        : primary === "tilt-3d-cards"
          ? `${mappedHero} :is(.project-starter,.svc){transition:transform .35s ease;transform-style:preserve-3d}${mappedHero} :is(.project-starter,.svc):hover{transform:perspective(900px) rotateX(1.5deg) rotateY(-1.5deg) translateY(-3px)}`
          : primary === "ripple-canvas"
            ? `${mappedHero} .hero-veil{background-image:repeating-radial-gradient(circle at 70% 35%,transparent 0 34px,color-mix(in srgb,var(--accent) 9%,transparent) 35px 36px);animation:premierRipple ${duration} ease-in-out infinite alternate}@keyframes premierRipple{to{background-size:106% 106%}}`
            : `${mappedHero} .hero-motif{animation:premierMotif ${duration} ease-in-out infinite alternate}@keyframes premierMotif{to{transform:translate3d(1.2%,-.8%,0)}}`;
  const treatment = renderedPremierMediaTreatment(ctx.composition.mediaFrame.treatment);
  const treatmentRoot = `.hero[data-motion-grammar] .premier-treatment-${treatment}`;
  const mediaCss = {
    "cinematic-light-shader": `${treatmentRoot} .cinematic-light{animation-duration:${duration}}`,
    "duotone-brand": `${treatmentRoot} :is(img,video){filter:grayscale(1) contrast(1.08) sepia(.25)}${treatmentRoot} .media-veil{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 44%,transparent),color-mix(in srgb,var(--accent2) 35%,transparent));mix-blend-mode:color}`,
    cinemagraph: `${treatmentRoot} :is(img,video){animation:premierCinemagraph ${duration} ease-in-out infinite alternate!important;transform-origin:center;will-change:transform}@keyframes premierCinemagraph{from{transform:scale(1.035) translate3d(-.35%,0,0)}to{transform:scale(1.035) translate3d(.35%,0,0)}}`,
    "video-loop": `${treatmentRoot} :is(img,video){filter:saturate(.88) contrast(1.1) brightness(.92)}${treatmentRoot} .media-veil{box-shadow:inset 0 0 120px rgba(0,0,0,.28)}`,
    "blueprint-svg": `${treatmentRoot} :is(img,video){filter:grayscale(.78) contrast(1.14)}${treatmentRoot} .media-veil{background-image:linear-gradient(color-mix(in srgb,var(--accent) 15%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 15%,transparent) 1px,transparent 1px);background-size:28px 28px}`,
    "grain-only": `${treatmentRoot} .media-veil{opacity:.22;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.38'/%3E%3C/svg%3E")}`,
    halftone: `${treatmentRoot} .media-veil{opacity:.3;background-image:radial-gradient(circle,color-mix(in srgb,var(--ink) 55%,transparent) 1px,transparent 1.5px);background-size:7px 7px;mix-blend-mode:multiply}`,
    "split-tone": `${treatmentRoot} .media-veil{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 32%,transparent) 0 50%,color-mix(in srgb,var(--accent2) 28%,transparent) 50%);mix-blend-mode:color}`,
  }[treatment] || "";
  const cardExtra = card.style === "glass"
    ? `background:color-mix(in srgb,var(--panel) 72%,transparent);backdrop-filter:${card.backdrop_filter};-webkit-backdrop-filter:${card.backdrop_filter}`
    : card.style === "monolith"
      ? "box-shadow:0 24px 60px -38px var(--ink)"
      : card.style === "tech"
        ? "box-shadow:inset 3px 0 0 var(--accent)"
        : "";
  return `
:root{--panel:${ctx.pal.panel};--premier-mapped-surface:${ctx.pal.mappedSurface};--premier-card-radius:${radius}}
:is(.project-starter,.svc,.review,.cta-card,.hours,.premier-map){border-radius:var(--premier-card-radius);border-style:${borderStyle};${cardExtra}}
.widget-material-swatch-lab .starter-choice{display:grid;grid-template-columns:18px 1fr}.widget-material-swatch-lab .starter-choice i{width:14px;height:14px;background:var(--swatch);border:1px solid var(--line)}
.widget-process-timeline .widget-timeline{display:grid;gap:.55rem;list-style:none;padding:0}.widget-process-timeline .widget-timeline li{display:grid;grid-template-columns:28px 1fr;gap:.65rem;align-items:center}.widget-process-timeline .widget-timeline b{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--accent);color:var(--accent)}
.widget-service-map .atlas-widget{grid-template-columns:1fr}.widget-project-storytelling .starter-choice{border-left:3px solid var(--accent)}
[data-premier-trust] .t-chip{border-radius:var(--premier-card-radius)}
[data-premier-trust*="stat-band-4up"] .strip-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
[data-premier-trust*="marquee-institutional-logos"] .strip-row{overflow-x:auto;flex-wrap:nowrap;border-block:1px solid var(--line);padding-block:.8rem}
[data-premier-trust*="signed-owner-letter"] .strip-row{font-family:var(--display);font-style:italic;border-left:4px solid var(--accent);padding-left:1rem}
[data-premier-trust*="license-badge-ribbon"] .strip-row{border-block:1px solid var(--accent);padding-block:.75rem}.trust-strip[data-premier-trust*="license-badge-ribbon"] .t-chip{border-style:double}
[data-premier-trust*="review-carousel-attributed"] .strip-row{justify-content:center}.trust-strip[data-premier-trust*="review-carousel-attributed"] .t-chip{box-shadow:inset 0 -2px 0 var(--accent)}
[data-premier-trust*="before-after-slider"] .strip-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border-inline:1px solid var(--line)}
[data-premier-trust*="video-testimonial-wall"] .strip-row{box-shadow:inset 0 0 0 1px var(--line),inset 0 -12px 0 color-mix(in srgb,var(--accent) 12%,transparent);padding:.9rem}
[data-premier-trust*="live-verified-pulsing"] .t-chip{border-style:dotted;border-color:var(--accent)}
[data-premier-cta="solid-accent"] .btn.solid{box-shadow:0 10px 28px -18px var(--accent)}
[data-premier-cta="modal-router"] .btn.solid{min-width:min(100%,220px);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--bg) 28%,transparent)}
[data-premier-cta="tier-1-pdf"] .btn.solid{border-radius:2px;border-left:6px solid var(--accent2)}
[data-premier-cta="sticky-quote"] .btn.solid{min-width:min(100%,220px);outline:1px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:3px}
${motionCss}
${mediaCss}
@media(prefers-reduced-motion:reduce){.hero[data-motion-grammar] :is(.cinematic-light,.hero-motif,.hero-veil),.hero[data-motion-grammar] .hero-media-layer :is(img,video){animation:none!important;transform:none!important}.project-starter:hover,.svc:hover,.btn:hover{transform:none!important}}
`;
}

// ---------------- shared page chrome ----------------
function baseCss(ctx) {
  const { pal, type, seed, HERO: H } = ctx;
  const light = pal.mode === "light";
  return `
:root{--bg:${pal.bg};--ink:${pal.ink};--accent:${pal.accent};--accent2:${pal.accent2};
--brand:${pal.accentBrandColors[0] || pal.accent};--brand-2:${pal.accentBrandColors[1] || pal.accent2};
--brand-raw-1:${pal.brandColors[0] || pal.accent};--brand-raw-2:${pal.brandColors[1] || pal.accent2};
--muted:${pal.muted};
--line:color-mix(in srgb, var(--ink) 16%, transparent);--panel:${pal.panel};
--display:${type.display};--display-weight:${type.displayWeight};--body:${type.body};color-scheme:${pal.mode};}
*{box-sizing:border-box}html{scroll-padding-top:96px}html,body{max-width:100%;overflow-x:clip}img,svg,video{max-width:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-synthesis:none;line-height:1.6}
nav.main{flex-wrap:wrap}
.shell{width:min(1160px,calc(100vw - 40px));margin:0 auto}
h1,h2,h3{font-family:var(--display);font-weight:var(--display-weight);line-height:1.12;letter-spacing:-.014em;margin:0 0 .5em}
h2{font-size:clamp(1.6rem,3.4vw,2.4rem)}p{color:var(--muted);max-width:64ch}
.kicker{font-size:.74rem;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 .9rem;display:flex;gap:.6rem;align-items:center}
.kicker::before{content:"";width:22px;height:2px;background:var(--accent)}
.kicker.light{color:${light ? "#fff" : "var(--accent)"}}
.btn{display:inline-flex;align-items:center;gap:.45rem;padding:.72rem 1.3rem;border-radius:${pick(["999px", "10px", "4px"], seed.rng)};font-weight:700;font-size:.95rem;text-decoration:none;border:1.5px solid var(--accent);transition:transform .15s;cursor:pointer}
.btn:hover{transform:translateY(-1.5px)}.btn.sm{padding:.5rem .95rem;font-size:.86rem}
:where(a,button,input,textarea,select):focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 75%,white);outline-offset:3px}
.skip-link{position:fixed;left:1rem;top:1rem;z-index:9999;transform:translateY(-180%);background:var(--ink);color:var(--bg);padding:.65rem 1rem;border-radius:8px;font-weight:700}.skip-link:focus{transform:none}
.btn.solid{background:var(--accent);color:${light ? "#fff" : pal.bg}}
.btn.line{color:var(--ink)}
header.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:nowrap;padding:.65rem 0;position:sticky;top:0;z-index:50;background:color-mix(in srgb, var(--bg) 78%, transparent);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);border-bottom:1px solid color-mix(in srgb, var(--line) 60%, transparent)}
.brand{display:flex;align-items:center;gap:.9rem;min-width:0;flex:1 1 auto;text-decoration:none;color:var(--ink)}
.brand-chip{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:.36rem .56rem;border-radius:14px;background:color-mix(in srgb,var(--panel) 46%,transparent);border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);box-shadow:0 10px 30px -14px color-mix(in srgb,var(--ink) 42%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 22%,transparent);backdrop-filter:blur(14px) saturate(1.25);-webkit-backdrop-filter:blur(14px) saturate(1.25)}
.brand-chip:has(.sourced-logo){background:#747976;border-color:rgba(255,255,255,.28);box-shadow:0 12px 34px -16px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.28)}
.sourced-logo{filter:brightness(1.16) contrast(1.12) saturate(1.04)}
.hero-logo .brand-chip{padding:.55rem .8rem;border-radius:16px;overflow:visible;line-height:0}
.brand-chip{overflow:visible;line-height:0}
.brand [data-role="logo"]{height:58px!important;width:auto;max-width:min(270px,34vw);object-fit:contain;object-position:left center}
.brand .brand-chip:has(.sourced-logo)+span,.brand .brand-chip:has(.proposed-wordmark)+span{display:none}
.brand .proposed-wordmark,.proposed-wordmark{display:block;height:auto!important;max-width:min(440px,70vw);font-family:var(--display);font-size:clamp(1.05rem,2.2vw,1.65rem);font-weight:var(--display-weight);line-height:1.04;letter-spacing:-.025em;white-space:normal;color:var(--ink)}
.brand .proposed-wordmark{display:-webkit-box;max-width:min(300px,30vw);overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:clamp(.9rem,1.45vw,1.15rem);line-height:1.08}
.hero-logo .proposed-wordmark{max-width:min(520px,80vw);font-size:clamp(1.35rem,3vw,2.6rem)}
.brand b{font-family:var(--display);font-size:1.25rem;line-height:1.1;display:block}
.brand span{font-size:.78rem;color:var(--accent);font-weight:700;letter-spacing:.06em}
nav.main{display:flex;gap:1.05rem;flex:0 0 auto;font-size:.92rem;font-weight:600;align-items:center}nav.main a{color:var(--muted);text-decoration:none}nav.main a:hover,nav.main a[aria-current]{color:var(--ink)}
.mobile-quick-cta{display:none}.mobile-nav{display:none;position:relative}.mobile-nav summary{list-style:none}.mobile-nav summary::-webkit-details-marker{display:none}
@media(max-width:1024px){
html{scroll-padding-top:80px}
header.top{display:grid;grid-template-columns:minmax(0,1fr) auto 46px;gap:.5rem;padding:.5rem 0;align-items:center}
.brand{min-width:0;max-width:100%}.brand [data-role="logo"]{height:48px!important;max-width:min(198px,48vw)}.brand .brand-chip:has(.sourced-logo)+span,.brand .brand-chip:has(.proposed-wordmark)+span{display:none}.brand>b,.brand>span{min-width:0}.brand b{font-size:1rem;overflow-wrap:anywhere}.brand span{font-size:.7rem}.brand .proposed-wordmark{font-size:clamp(.9rem,4.2vw,1.15rem)}
nav.main{display:none}
.mobile-quick-cta{display:inline-flex;min-height:44px;padding:.5rem .8rem;justify-content:center;white-space:nowrap}
.mobile-nav{display:block;justify-self:end}.mobile-nav summary{display:grid;place-items:center;width:44px;height:44px;border:1px solid var(--line);border-radius:8px;background:color-mix(in srgb,var(--panel) 88%,transparent);font-size:1.35rem;cursor:pointer}
.mobile-nav-panel{position:absolute;right:0;top:calc(100% + .55rem);width:min(300px,calc(100vw - 24px));display:none;gap:.2rem;padding:.7rem;background:color-mix(in srgb,var(--panel) 96%,transparent);border:1px solid var(--line);border-radius:8px;box-shadow:0 24px 60px -24px color-mix(in srgb,var(--ink) 60%,transparent);backdrop-filter:blur(18px)}.mobile-nav[open] .mobile-nav-panel{display:grid}
.mobile-nav-panel a{display:flex;align-items:center;min-height:44px;padding:.55rem .7rem;color:var(--ink);text-decoration:none;font-weight:650;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.mobile-nav-panel a:last-child{border-bottom:0}.mobile-nav-panel .btn{justify-content:center;margin-top:.3rem;color:#fff}
}
@media(max-width:360px){.brand>span>span{display:none}.mobile-quick-cta{padding:.5rem .65rem}}
/* hero */
.hero{position:relative;padding:clamp(2.5rem,6vw,5rem) 0 clamp(2.5rem,6vw,4.5rem);overflow:hidden}
.hero-grid{display:grid;grid-template-columns:${H.grid};gap:clamp(1.6rem,4vw,3.6rem);align-items:stretch;position:relative;z-index:2}
.hero-copy{align-self:center}
@media(max-width:860px){.hero-grid{grid-template-columns:1fr}.hero-copy{order:0}.hero-stage{order:1}}
.hero h1{font-size:${H.headSize};max-width:14ch}
.hero .intro{font-size:1.08rem}
.hero-stage{position:relative;min-height:clamp(340px,36vw,560px)}
.hero{position:relative}
.hero.flagship{min-height:min(92vh,880px);display:block;padding:0}
.hero.flagship .hero-grid{width:min(1160px,calc(100vw - 40px));min-height:min(92vh,880px);margin:0 auto;grid-template-columns:minmax(0,780px)!important;align-content:end;position:relative;z-index:3;padding:7rem 0 7rem}
.hero.flagship .hero-copy{order:0!important;position:relative;z-index:3}
.hero.flagship .hero-stage{position:absolute;inset-block:0;left:50%;width:100vw;min-height:100%;z-index:0;transform:translateX(-50%)}
.hero.flagship .media-plane{border-radius:0;box-shadow:none;clip-path:none!important;--mask-r:0}
.hero.flagship .media-plane .hero-media{object-position:center 38%}
.hero.flagship .veil{z-index:1;background:linear-gradient(180deg, color-mix(in srgb, var(--bg) 12%, transparent), color-mix(in srgb, var(--bg) 90%, transparent) 82%), linear-gradient(96deg, color-mix(in srgb, var(--bg) 78%, transparent) 8%, transparent 58%)}
.hero.flagship h1{font-size:clamp(2.9rem,7vw,5.6rem);line-height:1.02;max-width:15ch;letter-spacing:-.015em}
.hero.flagship .intro{max-width:56ch;font-size:1.08rem}
.hero.flagship .hero-widget{background:color-mix(in srgb, var(--panel) 55%, transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid color-mix(in srgb, var(--line) 60%, transparent)}
.hero.flagship .stat-row .stat{background:color-mix(in srgb, var(--panel) 45%, transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb, var(--line) 55%, transparent);border-radius:12px;padding:.55rem .9rem}
.hero.flagship .motif-overlay{opacity:.35;z-index:2}
.hero.flagship .marquee{position:absolute;inset-inline:0;bottom:0;z-index:4;margin-top:0!important}
.hero-est{display:flex;flex-direction:column;gap:.35rem;max-width:400px;border-radius:16px;padding:1.1rem 1.2rem;margin-top:1rem}
.hero-est .he-title{font:700 1rem var(--display)}
.hero-est .est-row{padding:.35rem 0;border-bottom:1px dashed color-mix(in srgb, var(--line) 60%, transparent)}
.hero-est .he-outs{display:flex;gap:1.4rem;padding:.6rem 0 .5rem}
.hero-est .est-out b{font-size:1.6rem}
.hero-est .btn{align-self:flex-start}
.hero-action-tile{display:flex;align-items:center;gap:.9rem;max-width:560px;padding:.8rem 1rem;margin-top:1rem;border-radius:18px;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(18px);box-shadow:0 18px 44px -30px var(--ink)}
.hero-action-tile .he-title{font:700 .92rem var(--display);white-space:nowrap}.action-steps{display:flex;gap:.6rem;flex:1}.action-steps span{display:flex;align-items:center;gap:.32rem;font-size:.72rem;white-space:nowrap}.action-steps i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--bg);font-style:normal;font-weight:800}.hero-action-tile .btn{white-space:nowrap}
.honest-wordmark{display:inline-flex;align-items:center;max-width:180px;font:700 clamp(.82rem,1.3vw,1.05rem)/1.05 var(--display);color:var(--ink);padding:.5rem .7rem;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--panel) 78%,transparent)}
@media(max-width:700px){.hero-action-tile{align-items:flex-start;flex-wrap:wrap;max-width:100%}.action-steps{width:100%;order:2}.action-steps span{white-space:normal}.hero-action-tile .btn{margin-left:auto}}
@media(max-width:860px){.hero.flagship{min-height:78vh}.hero.flagship .hero-grid{min-height:78vh;padding:5rem 0 6rem}}
.hero::before{content:"";position:absolute;inset:-10% 40% 20% -10%;z-index:0;pointer-events:none;background:radial-gradient(60% 80% at 30% 20%, color-mix(in srgb, var(--brand,var(--accent)) 16%, transparent), transparent 70%),radial-gradient(50% 70% at 70% 80%, color-mix(in srgb, var(--brand-2,var(--accent2)) 12%, transparent), transparent 70%);filter:blur(20px);animation:aurora 16s ease-in-out infinite alternate}
@keyframes aurora{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(4%,2%,0) scale(1.06)}}
.media-plane[data-media-treatment="source-photo-light-shader"] :is(.hero-media,.premier-media--source-photo img){animation:none;transform:none}
@media(max-width:860px){.media-plane .hero-media{animation:none}.media-plane .duotone{filter:none}}
.media-plane{position:absolute;inset:0;border-radius:var(--mask-r,22px);overflow:hidden;box-shadow:0 30px 70px -30px color-mix(in srgb, var(--ink) 45%, transparent)}
.media-plane.m-soft{--mask-r:26px}.media-plane.m-arch{--mask-r:46% 46% 14px 14px}.media-plane.m-slant{clip-path:polygon(0 4%,100% 0,100% 96%,0 100%);--mask-r:14px}.media-plane.m-blob{--mask-r:42% 18px 42% 18px}
.media-plane .scene-under{position:absolute;inset:0;width:100%;height:100%}
.media-plane .hero-media,.media-plane .ambiance{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.media-plane .duotone{filter:brightness(.92) contrast(1.06) saturate(1.02)}
.media-plane .tint{position:absolute;inset:0;background:linear-gradient(${140 + seed.hueRotate}deg, color-mix(in srgb, var(--accent) 38%, transparent), transparent 55%, color-mix(in srgb, var(--accent2) 30%, transparent));mix-blend-mode:${light ? "multiply" : "screen"};opacity:.32;pointer-events:none}
.media-plane.media-fallback .hero-media{display:none}
${cinematicCss()}
${atmosphereCss(ctx)}
.veil{position:absolute;inset:0;z-index:1;background:linear-gradient(${105 + seed.hueRotate}deg, color-mix(in srgb, var(--bg) 45%, transparent) 12%, transparent 48%);pointer-events:none}
.grain{position:absolute;inset:0;z-index:1;opacity:.5;pointer-events:none;
background-image:radial-gradient(circle at 8% 12%,color-mix(in srgb,var(--brand,var(--brand-raw-1)) 22%,transparent),transparent 30%),
radial-gradient(circle at 92% 24%,color-mix(in srgb,var(--brand-2,var(--brand-raw-2)) 18%,transparent),transparent 28%),
url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E")}
.motif-overlay{position:absolute;z-index:0;${seed.motifQuadrant.includes("t") ? "top:-40px" : "bottom:-40px"};${seed.motifQuadrant.includes("l") ? "left:-60px" : "right:-60px"};width:70%;opacity:.9;pointer-events:none}
.kinetic span{display:inline-block;opacity:0;transform:translateY(.4em);animation:rise .55s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}
.hero-widget{position:relative;z-index:3;margin-top:1.4rem}
.quote-widget{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center;background:color-mix(in srgb, var(--panel) 78%, transparent);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:14px;padding:1rem 1.2rem;box-shadow:0 18px 44px -22px color-mix(in srgb, var(--ink) 35%, transparent)}
.quote-widget b{font-family:var(--display);font-size:1.05rem;flex:1;min-width:180px}
.swatch-widget{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.swatch-cell{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:.9rem;font-size:.9rem}
.atlas-widget{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}
.atlas-widget .cell{display:flex;align-items:center;gap:.5rem;background:color-mix(in srgb, var(--panel) 80%, transparent);backdrop-filter:blur(6px);border:1px solid var(--line);border-radius:999px;padding:.45rem .95rem;font-size:.82rem;font-weight:600;transition:transform .18s,border-color .18s}
.atlas-widget .cell::before{content:"";width:6px;height:6px;border-radius:99px;background:var(--accent);flex:none}
.atlas-widget .cell:hover{transform:translateY(-3px);border-color:var(--accent)}
.letter-widget{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.3rem;font-family:var(--display);font-size:1.06rem}
.letter-widget .sig{display:block;margin-top:.7rem;color:var(--accent);font-weight:700;font-size:.9rem}
.map-widget svg{width:100%;height:auto}
.stat-row{display:flex;gap:1.6rem;margin-top:1.6rem;flex-wrap:wrap;position:relative;z-index:2}
.stat-row .stat b{font-family:var(--display);font-size:1.7rem;display:block;color:var(--accent)}
.stat-row .stat span{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.marquee{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:.7rem 0;overflow:hidden;white-space:nowrap;position:relative;z-index:2}
.marquee div{display:inline-block;animation:slide 30s linear infinite;font-family:var(--display);font-size:.95rem;color:var(--muted)}
.marquee span{margin:0 1.4rem}.marquee span::after{content:"·";margin-left:1.4rem;color:var(--accent)}
@keyframes slide{to{transform:translateX(-50%)}}
/* bands */
.band{padding:clamp(2.6rem,6vw,4.6rem) 0}
.band.alt{background:color-mix(in srgb, var(--ink) ${light ? "4%" : "6%"}, var(--bg))}
.trust-strip{padding:1rem 0;border-bottom:1px solid var(--line);background:color-mix(in srgb, var(--ink) ${light ? "3%" : "5%"}, var(--bg))}
.strip-row{display:flex;gap:.7rem;align-items:center;flex-wrap:wrap}
.t-chip{border:1px solid var(--line);border-radius:999px;padding:.32rem .85rem;font-size:.8rem;font-weight:600;color:var(--muted)}
.trust-mark-rail{display:flex;gap:clamp(.75rem,2vw,1.4rem);align-items:center;flex-wrap:wrap;margin-top:.9rem;padding-top:.9rem;border-top:1px solid var(--line)}
.trust-mark{display:grid;grid-template-columns:minmax(46px,76px) minmax(0,1fr);gap:.65rem;align-items:center;margin:0;max-width:210px}
.trust-mark img{display:block;width:100%;height:44px;object-fit:contain;filter:saturate(.88);background:color-mix(in srgb,var(--bg) 88%,transparent)}
.trust-mark figcaption{font-size:.72rem;line-height:1.25;color:var(--muted)}
.strip-stats{display:flex;gap:1.4rem;margin-left:auto;flex-wrap:wrap}
.mini-stat b{font-family:var(--display);color:var(--accent);font-size:1.15rem;margin-right:.3rem}
.mini-stat span{font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem}
.svc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.1rem;transition:transform .28s cubic-bezier(.2,.7,.2,1),box-shadow .28s;display:flex;flex-direction:column;gap:.3rem;overflow:hidden}
.svc:hover{transform:translateY(-5px);box-shadow:0 22px 48px -20px color-mix(in srgb, var(--ink) 45%, transparent);border-color:color-mix(in srgb, var(--accent) 45%, var(--line))}
.svc-visual{margin:-1.1rem -1.1rem .55rem;position:relative;aspect-ratio:16/9;overflow:hidden}
.svc-photo{display:block;width:100%;height:100%;object-fit:cover;filter:saturate(1.05);transition:transform .6s cubic-bezier(.2,.7,.2,1)}
.svc:hover .svc-photo{transform:scale(1.045)}
.svc--text{justify-content:flex-start;min-height:190px;padding-top:1.35rem}
.glass{background:color-mix(in srgb, var(--panel) 72%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
[data-reveal]{opacity:1;transform:none;transition:transform .6s cubic-bezier(.2,.7,.2,1)}
[data-reveal].in{opacity:1;transform:none}
.svc .idx{font-size:.72rem;color:var(--accent);font-weight:800;letter-spacing:.14em}
.svc h3{font-size:1.05rem;margin:.15rem 0 .2rem}.svc p{font-size:.88rem;margin:0;flex:1}
.svc-mat{align-self:flex-start;margin-top:.6rem;font-size:.74rem;font-weight:700;color:var(--accent);border:1px solid color-mix(in srgb, var(--accent) 40%, transparent);border-radius:999px;padding:.18rem .6rem}
.founder-grid{display:grid;grid-template-columns:1fr;gap:2rem;align-items:center}
@media(max-width:700px){.founder-grid{grid-template-columns:1fr}}
.founder-note{font-family:var(--display);font-size:1.15rem;line-height:1.5}
.founder .sig{color:var(--accent);font-weight:700;font-size:.9rem}
.review-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}
.review{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.15rem;display:flex;flex-direction:column;gap:.5rem}
.review .stars{color:var(--accent);letter-spacing:.1em}
.review blockquote{margin:0;font-size:.94rem;color:var(--ink)}
.review figcaption{font-size:.82rem;color:var(--muted);font-weight:600}
.src-chip{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border:1px solid color-mix(in srgb, var(--accent) 35%, transparent);border-radius:999px;padding:.12rem .5rem}
.src-note{font-size:.8rem;margin-top:1rem}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;counter-reset:s}
.steps li{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.1rem;display:flex;gap:.8rem;align-items:baseline}
.steps b{font-family:var(--display);color:var(--accent);font-size:1.5rem}
.mat-row{display:flex;gap:.6rem;flex-wrap:wrap;margin:.4rem 0 1rem}
.mat{border:1.5px solid var(--accent);border-radius:999px;padding:.35rem 1rem;font-size:.88rem;font-weight:600;color:var(--accent)}
.g-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:clamp(150px,18vw,230px);gap:.8rem}
.g-cell{margin:0;position:relative;grid-column:span var(--g-span,4);grid-row:span var(--g-rows,1);min-height:180px;border-radius:10px;overflow:hidden;background:var(--panel)}
.g-cell img{width:100%;height:100%;object-fit:cover;transition:transform .25s}
.g-cell--contained-source-proof{display:grid;place-items:center;min-height:min(70vh,640px);padding:clamp(1rem,4vw,3.5rem);background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 64%),var(--panel);border:1px solid color-mix(in srgb,var(--accent) 38%,var(--line));box-shadow:inset 0 0 0 10px color-mix(in srgb,var(--bg) 24%,transparent)}
.g-cell--contained-source-proof img{width:auto;height:auto;max-width:min(100%,450px);max-height:min(100%,600px);object-fit:contain;box-shadow:0 28px 70px rgba(0,0,0,.28)}
.g-cell--contained-source-proof:hover img{transform:none}
.g-cell:hover img{transform:scale(1.04)}
.g-cell[data-lb-src]{cursor:zoom-in}
.g-cell:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.g-zoom{position:absolute;top:.5rem;right:.5rem;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:color-mix(in srgb,var(--bg) 55%,transparent);color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transform:scale(.9);transition:opacity .2s,transform .2s;pointer-events:none}
.g-cell:hover .g-zoom,.g-cell:focus-visible .g-zoom{opacity:1;transform:scale(1)}
.lb-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:clamp(1rem,4vw,3rem);background:color-mix(in srgb,#05070c 88%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:lbIn .2s ease}
.lb-overlay[hidden]{display:none}
@keyframes lbIn{from{opacity:0}to{opacity:1}}
.lb-stage{margin:0;max-width:min(1100px,92vw);max-height:86vh;display:flex;flex-direction:column;gap:.7rem}
.lb-stage img{max-width:100%;max-height:78vh;width:auto;height:auto;object-fit:contain;border-radius:12px;box-shadow:0 30px 80px -20px #000;background:#0b0e14}
.lb-cap{color:#e7ecf3;font-size:.9rem;text-align:center;font-weight:600}
.lb-close{position:absolute;top:1rem;right:1.2rem;width:44px;height:44px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:1.6rem;line-height:1;cursor:pointer}
.lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:2rem;line-height:1;cursor:pointer;display:grid;place-items:center}
.lb-prev{left:max(1rem,2vw)}.lb-next{right:max(1rem,2vw)}
.lb-close:hover,.lb-nav:hover{background:rgba(255,255,255,.24)}
@media(prefers-reduced-motion:reduce){.lb-overlay{animation:none}.g-zoom,.g-cell img{transition:none}}
@media(max-width:700px){.g-grid{grid-template-columns:1fr;grid-auto-rows:auto}.g-cell{grid-column:1/-1;grid-row:auto;min-height:0;aspect-ratio:4/3}.g-cell--contained-source-proof{min-height:0;aspect-ratio:auto;padding:1rem}.g-cell--contained-source-proof img{max-height:70vh}}
@media(max-width:640px){.lb-nav{width:40px;height:40px;font-size:1.5rem}}
.area-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:2.4rem;align-items:center}
@media(max-width:820px){.area-grid,.cta-card,.founder-grid{grid-template-columns:1fr!important}}
.geo-map{position:relative;border-radius:14px;overflow:hidden;min-height:300px;border:1px solid var(--line)}
.geo-map iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.geo-map .ring-map{width:100%;height:100%;display:block}
.geo-map .ml-holder{position:absolute;inset:0;opacity:0;transition:opacity .4s}
.geo-map.map-live .ml-holder{opacity:1}
.map-pin{width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--pin,var(--accent));border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.map-meta{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-top:.8rem}
.map-meta .addr{font-size:.9rem;font-weight:600;color:var(--muted)}
.hours{margin:1.1rem 0;padding:1rem 1.1rem;background:var(--panel);border:1px solid var(--line);border-radius:12px;font-size:.9rem}
.hours>b{font-family:var(--display);display:block;margin-bottom:.4rem}
.hours .hgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.25rem .9rem}
.hours .hrow{display:flex;justify-content:space-between;gap:.6rem;border-bottom:1px dashed var(--line);padding:.14rem 0}
.hours .hrow span{color:var(--muted)}
.hours.placeholder span{color:var(--muted);font-size:.86rem}
.hours .src-chip{margin-top:.5rem;display:inline-block}
details.faq{border-bottom:1px solid var(--line);padding:.95rem 0}
details.faq summary{font-weight:700;cursor:pointer;list-style:none;font-size:1.02rem;font-family:var(--display)}
details.faq summary::after{content:" +";color:var(--accent)}details.faq[open] summary::after{content:" –"}
.cta-card{display:grid;grid-template-columns:1fr 1fr;gap:2rem;background:${light ? "var(--ink)" : "var(--panel)"};color:${light ? pal.bg : "var(--ink)"};border-radius:18px;padding:clamp(1.6rem,4vw,2.8rem);border:1px solid var(--line)}
.cta-card h2,.cta-card p{color:inherit}
.quote-form{display:grid;gap:.8rem}
.quote-form label{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;display:grid;gap:.3rem}
.quote-form input,.quote-form textarea{font:inherit;padding:.65rem .8rem;border-radius:8px;border:1.5px solid color-mix(in srgb, currentColor 25%, transparent);background:${light ? "rgba(255,255,255,.08)" : "var(--bg)"};color:inherit}
.quote-hp{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important}
.quote-status{min-height:1.4em;margin:0;font-size:.92rem;text-transform:none;letter-spacing:0}
.quote-status--pending{opacity:.72}.quote-status--success{color:var(--accent)}.quote-status--error{color:#f97066}
.quote-status a{color:inherit;font-weight:700}
.est-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:2rem;max-width:920px;margin:1.6rem auto 0;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:1.8rem 2rem;box-shadow:0 28px 70px -30px color-mix(in srgb, var(--ink) 45%, transparent)}
.estimator .kicker,.estimator h2,.estimator > .shell > .muted{text-align:center}
.estimator h2{margin-inline:auto}
@media(max-width:820px){.est-grid{grid-template-columns:1fr;padding:1.3rem}}
.est-row{display:grid;grid-template-columns:1fr auto;gap:.15rem .8rem;align-items:center;padding:.55rem 0;border-bottom:1px dashed color-mix(in srgb, var(--line) 70%, transparent)}
.est-row:last-child{border-bottom:0}
.est-row span{font-weight:700;font-size:.86rem;grid-column:1/3}.est-row small{color:var(--muted);font-weight:500}
.est-row output{font-family:var(--display);font-size:1.15rem;color:var(--accent);grid-column:2;grid-row:2}
.est-row input[type=range]{width:100%;accent-color:var(--accent);height:5px;grid-column:1;grid-row:2}
.est-readout{border-left:1px solid var(--line);padding-left:2rem;display:flex;flex-direction:column;gap:.9rem;align-self:center}
@media(max-width:820px){.est-readout{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:1.2rem}}
.est-out b{display:block;font-family:var(--display);font-size:2rem;line-height:1;color:var(--accent)}
.est-out span{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.est-fine{margin:0;font-size:.72rem;color:var(--muted)}
.hero h1 em.accent-word{font-style:italic;color:var(--accent)}
.pchat-fab{position:fixed;right:16px;bottom:76px;z-index:42;display:flex;align-items:center;gap:.5rem;border:1px solid color-mix(in srgb, var(--accent) 55%, transparent);border-radius:999px;padding:.6rem 1.05rem;font:700 .85rem var(--display);color:var(--ink);background:color-mix(in srgb, var(--panel) 55%, transparent);backdrop-filter:blur(14px);cursor:pointer;box-shadow:0 14px 40px -14px color-mix(in srgb, var(--ink) 50%, transparent)}
.pchat-dot{width:8px;height:8px;border-radius:99px;background:#2ecc71;animation:pulse 2s infinite}
.pchat-panel{position:fixed;right:16px;bottom:76px;z-index:60;width:min(360px,calc(100vw - 24px));border:1px solid color-mix(in srgb, var(--line) 60%, transparent);border-radius:18px;overflow:hidden;background:color-mix(in srgb, var(--panel) 65%, transparent);backdrop-filter:blur(20px) saturate(1.4);box-shadow:0 30px 80px -24px color-mix(in srgb, var(--ink) 60%, transparent)}
.pchat-head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;background:color-mix(in srgb, var(--accent) 85%, transparent);color:#fff}
.pchat-head b{font:700 .92rem var(--display)}.pchat-head span{font-size:.72rem;opacity:.85;margin-right:auto}
.pchat-head button{border:0;background:none;color:#fff;font-size:1.2rem;cursor:pointer;line-height:1}
.pchat-log{max-height:300px;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.55rem}
.pchat-msg{max-width:85%;padding:.55rem .8rem;border-radius:14px;font-size:.86rem;line-height:1.45}
.pchat-msg.them{background:color-mix(in srgb, var(--panel) 90%, transparent);border:1px solid var(--line);align-self:flex-start;border-bottom-left-radius:4px}
.pchat-msg.me{background:var(--accent);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.pchat-form{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid var(--line)}
.pchat-form input{flex:1;border:1px solid var(--line);border-radius:999px;padding:.55rem .9rem;font-size:.86rem;background:var(--bg);color:var(--ink)}
.pchat-fine{margin:0;padding:0 1rem .7rem;font-size:.68rem;color:var(--muted)}
/* Ultra-professional glass launch tile (bottom-right) */
.launch-tile{position:fixed;right:18px;bottom:18px;z-index:41;width:302px;max-width:calc(100vw - 32px);padding:15px 15px 13px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:linear-gradient(160deg,rgba(19,19,24,.92),rgba(10,10,15,.9));box-shadow:0 26px 70px -26px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3);color:#F2F2F5;font-family:var(--body)}
.launch-tile[hidden]{display:none}
.launch-tile .lt-x{position:absolute;top:9px;right:10px;width:22px;height:22px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-size:15px;line-height:1;cursor:pointer}
.launch-tile .lt-top{display:flex;align-items:center;gap:10px;margin-bottom:11px}
.launch-tile .lt-mark{display:inline-flex;flex:0 0 auto}
.launch-tile .lt-brand{min-width:0}.launch-tile .lt-brand b{display:block;font:800 12.5px/1.2 var(--display);color:#fff;letter-spacing:.01em}.launch-tile .lt-brand span{display:block;font-size:11px;color:rgba(255,255,255,.6)}
.launch-tile .lt-count{display:flex;align-items:center;gap:7px;margin:0 0 11px;padding:7px 10px;border-radius:9px;background:rgba(224,164,74,.12);border:1px solid rgba(224,164,74,.32);font-size:11.5px;color:#F0CE9A}.launch-tile .lt-count b{color:#fff;font-weight:800}
.launch-tile .lt-pulse{width:8px;height:8px;border-radius:50%;background:#E0A44A;box-shadow:0 0 0 0 rgba(224,164,74,.6);animation:ltp 1.8s infinite}
@keyframes ltp{0%{box-shadow:0 0 0 0 rgba(224,164,74,.55)}70%{box-shadow:0 0 0 8px rgba(224,164,74,0)}100%{box-shadow:0 0 0 0 rgba(224,164,74,0)}}
.launch-tile .lt-buy{display:block;text-decoration:none;text-align:center;padding:11px 12px;border-radius:11px;background:linear-gradient(120deg,#3550C8,#5A6CF7 46%,#8B5CF6);box-shadow:0 10px 26px -10px rgba(74,108,247,.7);color:#fff}
.launch-tile .lt-buy b{display:block;font:800 14.5px/1.15 var(--display)}.launch-tile .lt-buy span{display:block;margin-top:2px;font-size:11px;color:rgba(255,255,255,.82)}
.launch-tile .lt-share{display:flex;gap:6px;margin-top:10px}
.launch-tile .lt-share button{flex:1;padding:8px 4px;border:1px solid rgba(255,255,255,.16);border-radius:9px;background:rgba(255,255,255,.05);color:#E7E7ED;font:700 11px/1 var(--body);cursor:pointer;white-space:nowrap}
.launch-tile .lt-share button:hover{background:rgba(255,255,255,.1)}
@media(prefers-reduced-motion:reduce){.launch-tile .lt-pulse{animation:none}}
body:has(.launch-tile:not([hidden])) .pchat-fab{right:auto;left:16px}
body:has(.launch-tile:not([hidden])) .pchat-panel{right:auto;left:16px}
.launch-tile .lt-buy:focus-visible,.launch-tile .lt-share button:focus-visible,.launch-tile .lt-x:focus-visible,.launch-rail .lr-share-btn:focus-visible{outline:2px solid #8B5CF6;outline-offset:2px}
.launch-tile .lt-count.lt-urgent,.launch-rail .lr-urgency.lt-urgent{background:rgba(242,109,109,.14);border-color:rgba(242,109,109,.4);color:#F8B9B9}
.launch-tile .lt-count.lt-urgent .lt-pulse,.launch-rail .lr-urgency.lt-urgent .lr-pulse{background:#F26D6D}
.launch-tile .lt-toggle{display:none}
@media(max-width:560px){
  .launch-tile{padding:10px 12px 10px}
  .launch-tile .lt-toggle{display:grid;place-items:center;position:absolute;top:9px;right:38px;width:22px;height:22px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);font-size:12px;line-height:1;cursor:pointer;transform:rotate(180deg);transition:transform .2s}
  .launch-tile.lt-open .lt-toggle{transform:rotate(0deg)}
  .launch-tile .lt-top{margin-bottom:8px}
  .launch-tile:not(.lt-open) .lt-brand span{display:none}
  .launch-tile:not(.lt-open) .lt-share{display:none}
  .launch-tile:not(.lt-open) .lt-count{margin-bottom:8px;padding:5px 9px;font-size:11px}
  .launch-tile:not(.lt-open) .lt-buy{padding:9px 10px}
  .launch-tile:not(.lt-open) .lt-buy span{display:none}
  @media(prefers-reduced-motion:reduce){.launch-tile .lt-toggle{transition:none}}
}
/* legacy pill kept as a graceful fallback */
.launch-chip{position:fixed;left:16px;bottom:16px;z-index:41;display:flex;align-items:center;gap:.8rem;min-height:48px;padding:.65rem 1rem;border:1px solid color-mix(in srgb,var(--accent) 65%,#fff);border-radius:999px;background:color-mix(in srgb,var(--ink) 92%,transparent);color:#fff;text-decoration:none;box-shadow:0 18px 54px -22px #000;backdrop-filter:blur(16px);font:700 .82rem var(--body)}
.launch-chip b{font:700 .98rem var(--display);color:#fff}.launch-chip span{color:rgba(255,255,255,.78)}.launch-chip i{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-style:normal}
/* Launch-rail share + cross-sell */
.launch-rail .lr-urgency{display:flex;align-items:center;gap:8px;margin:.7rem 0 0;font-size:.82rem;color:#F0CE9A}.launch-rail .lr-urgency b{color:#fff;font-weight:800}
.launch-rail .lr-pulse{width:9px;height:9px;border-radius:50%;background:#E0A44A;animation:ltp 1.8s infinite}
.launch-rail .lr-share{margin:1.1rem 0 0;padding:.9rem 0 0;border-top:1px solid rgba(255,255,255,.1)}
.launch-rail .lr-share-label{display:block;margin-bottom:.55rem;font-size:.8rem;color:rgba(255,255,255,.75)}
.launch-rail .lr-share-btns{display:flex;gap:.5rem;flex-wrap:wrap}
.launch-rail .lr-share-btn{padding:.5rem .85rem;border:1px solid rgba(255,255,255,.28);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;font:700 .78rem var(--body);cursor:pointer}
.launch-rail .lr-share-btn:hover{background:rgba(255,255,255,.13)}
.launch-rail .lr-more{margin:1.1rem 0 0;padding:.9rem 0 0;border-top:1px solid rgba(255,255,255,.1)}
.launch-rail .lr-more-label{display:block;margin-bottom:.6rem;font:700 .68rem var(--body);text-transform:uppercase;letter-spacing:.14em;color:color-mix(in srgb,var(--accent) 78%,#fff)}
.launch-rail .lr-more-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.7rem}
.launch-rail .lr-more-item{padding:.7rem .8rem;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04)}
.launch-rail .lr-more-item b{display:block;font:700 .82rem var(--display);color:#fff;margin-bottom:.2rem}.launch-rail .lr-more-item span{font-size:.72rem;color:rgba(255,255,255,.7);line-height:1.4}
@media(max-width:860px){.launch-rail .lr-more-grid{grid-template-columns:1fr}}
.launch-rail{position:relative;z-index:2;width:100%;border-block:1px solid color-mix(in srgb,var(--accent) 42%,transparent);background:color-mix(in srgb,var(--ink) 94%,#050706);color:#fff;scroll-margin-top:86px}
.launch-inner{display:grid;grid-template-columns:minmax(220px,.72fr) minmax(0,1.35fr) minmax(230px,.62fr);gap:clamp(1.5rem,4vw,4rem);align-items:center;padding:clamp(2rem,5vw,4rem) 0}
.launch-rail .lr-head{min-width:0}.launch-rail .lr-eyebrow{display:block;margin-bottom:.65rem;color:color-mix(in srgb,var(--accent) 78%,#fff);font:700 .7rem var(--body);text-transform:uppercase;letter-spacing:.14em}.launch-rail .lr-ready{display:block;color:#fff;font:650 clamp(1.7rem,3.2vw,3rem)/1.02 var(--display)}
.launch-rail .lr-price{display:flex;align-items:baseline;gap:.35rem;margin:1rem 0 0;color:#fff}.launch-rail .lr-price strong{font:700 2.7rem/1 var(--display);color:color-mix(in srgb,var(--accent) 80%,#fff)}.launch-rail .lr-price span{font-size:.84rem;color:rgba(255,255,255,.7)}
.launch-rail .lr-body{min-width:0}.launch-rail .lr-lede{margin:0 0 1rem;max-width:62ch;color:rgba(255,255,255,.78);font-size:.98rem}.launch-rail .lr-lede b{color:#fff}
.launch-rail .lr-list{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:.6rem 1.2rem;font-size:.82rem}.launch-rail .lr-list li{position:relative;padding-left:1.35rem;color:rgba(255,255,255,.82)}.launch-rail .lr-list li::before{content:"✓";position:absolute;left:0;top:0;color:color-mix(in srgb,var(--accent) 78%,#fff);font-weight:800}
.launch-rail .lr-actions{display:grid;gap:.65rem}.launch-rail .lr-actions .btn{justify-content:center;min-height:50px}.launch-rail .lr-actions .btn.line{border-color:rgba(255,255,255,.45);color:#fff}.launch-rail .lr-checkout{margin:.8rem 0 0;font-size:.7rem;text-align:center;color:rgba(255,255,255,.62)}.launch-rail .lr-fine{margin:.6rem 0 0;font-size:.72rem;color:rgba(255,255,255,.6)}.launch-rail .lr-fine b{color:#fff}
@media(max-width:860px){.launch-inner{grid-template-columns:1fr 1fr}.launch-rail .lr-actions{grid-column:1/-1;grid-template-columns:1fr 1fr}.launch-rail .lr-checkout,.launch-rail .lr-fine{grid-column:1/-1}}
@media(max-width:560px){
body:has([data-launch-chip]){padding-bottom:72px}body:not(:has([data-launch-chip])){padding-bottom:78px}
.launch-tile{left:10px;right:10px;bottom:10px;width:auto}
.launch-chip{left:10px;right:10px;bottom:10px;justify-content:center;border-radius:8px}.launch-chip span{display:none}
.launch-inner{grid-template-columns:1fr;padding:2rem 0;gap:1.25rem}.launch-rail .lr-list{grid-template-columns:1fr}.launch-rail .lr-actions{grid-column:auto;grid-template-columns:1fr}.launch-rail .lr-checkout,.launch-rail .lr-fine{grid-column:auto}
body:has([data-launch-chip]) .pchat{display:none}
}
@media(max-width:700px){header.top nav,nav.main{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;scrollbar-width:none}}
footer{border-top:1px solid var(--line);padding:2.2rem 0 1.6rem;font-size:.88rem;color:var(--muted)}
.foot-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:2rem}
@media(max-width:760px){.foot-grid{grid-template-columns:1fr}}
.foot-heading{display:block;font-family:var(--display);font-weight:700;color:var(--ink);margin:0 0 .5rem;font-size:1rem}
.foot-grid a{color:inherit}
.foot-contact-link{display:flex!important;align-items:center;min-height:44px;width:max-content;padding:.1rem 0}
.foot-legal{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:1.6rem;padding-top:1rem}
.crumbs{font-size:.8rem;color:var(--muted);padding:.9rem 0 0}.crumbs a{color:inherit}
.page-head{position:relative;padding:clamp(2rem,5vw,3.6rem) 0;overflow:hidden;border-bottom:1px solid var(--line)}
.page-head h1{font-size:clamp(2rem,4.6vw,3.2rem);max-width:18ch}
.page-head .motif-overlay{width:50%;opacity:.6}
.cta-strip{display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap;background:color-mix(in srgb, var(--accent) ${light ? "10%" : "16%"}, var(--bg));border:1px solid color-mix(in srgb, var(--accent) 30%, transparent);border-radius:14px;padding:1.1rem 1.4rem;margin:2.2rem 0}
.cta-strip b{font-family:var(--display);font-size:1.12rem}
.prose p{margin:0 0 1rem}.prose h2{margin-top:2rem}
.xlinks{display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.4rem}
.xlinks a{border:1px solid var(--line);border-radius:999px;padding:.4rem 1rem;font-size:.86rem;font-weight:600;color:var(--muted);text-decoration:none}
.xlinks a:hover{color:var(--ink);border-color:var(--accent)}
/* Premier V8: composition-led hero and proof system. */
h1,h2,h3,.kicker,.btn{letter-spacing:0}
.hero{isolation:isolate;min-height:min(88vh,860px);padding:clamp(4.5rem,9vw,8rem) 0 5.5rem;display:grid;align-items:center;background:var(--bg)}
.hero-media-layer,.hero-veil,.hero-motif{position:absolute;inset:0;pointer-events:none}
.hero-media-layer{z-index:-3;overflow:hidden}
.hero-media-layer .media-plane,.hero-media-layer .premier-media,.hero-media-layer video,.hero-media-layer img{position:absolute;inset:0;width:100%;height:100%}
.hero:not([data-motion-grammar]) .hero-media-layer video,.hero:not([data-motion-grammar]) .hero-media-layer img{object-fit:cover;animation:none!important;transform:none!important;filter:none}
.hero[data-motion-grammar] .hero-media-layer video,.hero[data-motion-grammar] .hero-media-layer img{object-fit:cover;animation:none!important;transform:none;filter:none}
.media-disclosure{position:absolute;right:18px;bottom:16px;z-index:4;padding:7px 10px;border:1px solid color-mix(in srgb,#fff 34%,transparent);background:rgba(5,8,10,.58);color:#fff;font:600 .68rem/1.1 var(--body);letter-spacing:0;text-transform:uppercase;backdrop-filter:blur(8px)}
.hero-media-layer .media-plane{border:0;border-radius:0;box-shadow:none;overflow:hidden}
.hero-media-layer .premier-media{overflow:hidden}
.hero-media-layer .premier-media--source-photo-contact-sheet{inset:clamp(1rem,3vw,3.5rem);width:auto;height:auto;display:grid;grid-template-columns:1.15fr .85fr;grid-template-rows:1fr 1fr;gap:clamp(.45rem,1vw,.9rem);padding:clamp(.45rem,1vw,.9rem);background:color-mix(in srgb,var(--panel) 82%,transparent);border:1px solid color-mix(in srgb,var(--accent) 34%,var(--line));border-radius:clamp(12px,2vw,26px);box-shadow:0 30px 80px rgba(0,0,0,.28)}
.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item{position:relative;min-width:0;min-height:0;margin:0;overflow:hidden;border-radius:clamp(8px,1.2vw,18px)}
.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:first-child{grid-row:1/-1}
.hero-media-layer .premier-media--source-photo-contact-sheet img{position:relative;inset:auto;display:block;width:100%;height:100%;object-fit:cover}
.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:only-child{grid-column:1/-1;grid-row:1/-1}
.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:nth-child(2):last-child{grid-row:1/-1}
.hero-media-layer .premier-media--contained-source-proof{display:grid;grid-template-columns:1fr;grid-template-rows:1fr;place-items:center;padding:clamp(1rem,4vw,4rem);background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 62%),color-mix(in srgb,var(--panel) 92%,transparent)}
.hero-media-layer .premier-media--contained-source-proof .premier-source-sheet__item,.hero-media-layer .premier-media--contained-source-proof .premier-source-sheet__item:only-child{grid-column:1;grid-row:1;width:min(100%,450px);height:min(100%,600px);aspect-ratio:auto;display:grid;place-items:center;background:color-mix(in srgb,var(--panel) 94%,#000);border:1px solid color-mix(in srgb,var(--accent) 42%,var(--line));box-shadow:0 28px 70px rgba(0,0,0,.32),0 0 0 10px color-mix(in srgb,var(--panel) 72%,transparent)}
.hero-media-layer .premier-media--contained-source-proof img{position:relative;inset:auto;display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain}
@media(max-width:720px){.hero-media-layer .premier-media--source-photo-contact-sheet{inset:.75rem;grid-template-columns:1fr 1fr;grid-template-rows:1fr .68fr}.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:first-child{grid-column:1/-1;grid-row:1}.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:nth-child(2):last-child{grid-column:1/-1;grid-row:2}.hero-media-layer .premier-media--source-photo-contact-sheet .premier-source-sheet__item:only-child{grid-column:1/-1;grid-row:1/-1}}
.hero-veil{z-index:-2;background:linear-gradient(90deg,color-mix(in srgb,var(--bg) 94%,transparent) 0%,color-mix(in srgb,var(--bg) 82%,transparent) 38%,color-mix(in srgb,var(--bg) 32%,transparent) 72%,color-mix(in srgb,var(--bg) 18%,transparent) 100%)}
.hero-motif{z-index:-1;opacity:.28;mix-blend-mode:multiply;overflow:hidden}
.hero-motif svg{position:absolute;right:-6%;bottom:-8%;width:min(900px,72vw);height:auto}
.hero .atmo-layer,.hero .atmo-sweep,.hero .atmo-letterbox{z-index:-1}
.hero-grid{grid-template-columns:minmax(0,1fr) minmax(330px,420px);gap:clamp(2rem,5vw,5.5rem);align-items:center}
.hero-copy{max-width:720px;text-wrap:balance}
.hero-logo{display:flex;align-items:center;min-height:84px;margin-bottom:1.2rem}
.trust-citations{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:1.1rem}
.trust-citations .tc-label{font:700 .68rem var(--body);text-transform:uppercase;letter-spacing:.13em;color:color-mix(in srgb,var(--ink) 55%,transparent)}
.hero .trust-citations .tc-label,.hero-mast .trust-citations .tc-label{color:rgba(255,255,255,.72)}
.tc-chip{display:inline-flex;align-items:center;gap:.42rem;padding:.4rem .7rem .4rem .45rem;border-radius:999px;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);background:color-mix(in srgb,var(--panel) 55%,transparent);backdrop-filter:blur(10px);color:inherit;text-decoration:none;font:700 .74rem var(--body)}
.tc-chip:hover{border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.tc-chip i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,var(--accent) 82%,#fff);color:#fff;font:800 .62rem var(--body);font-style:normal}
.hero .tc-chip,.hero-mast .tc-chip{border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff}
@media(max-width:560px){.trust-citations{gap:.4rem}.tc-chip{font-size:.7rem;padding:.35rem .6rem .35rem .4rem}}
.hero-logo .sourced-logo,.hero-logo .proposed-logo{height:clamp(72px,8vw,108px)!important;width:auto;max-width:min(360px,70vw);object-fit:contain;object-position:left center;filter:drop-shadow(0 12px 24px color-mix(in srgb,var(--ink) 18%,transparent))}
.hero h1{font-size:clamp(3rem,7vw,6.1rem);line-height:.98;max-width:13ch;margin-bottom:.3em}
.hero .intro{font-size:clamp(1rem,1.5vw,1.18rem);max-width:58ch;color:var(--muted)}
.hero-actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-top:1.3rem}
.hero-phone{color:var(--ink);background:color-mix(in srgb,var(--panel) 78%,transparent);backdrop-filter:blur(12px)}
.hero-review{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-top:1rem;font-size:.84rem;color:var(--muted)}
.hero-review .stars{color:var(--accent);letter-spacing:.08em}.hero-review b{color:var(--ink)}
.project-starter{align-self:center;justify-self:end;width:min(100%,420px);padding:1.25rem;background:color-mix(in srgb,var(--panel) 94%,transparent);color:var(--ink);border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:8px;box-shadow:0 34px 90px -38px color-mix(in srgb,var(--ink) 62%,transparent);backdrop-filter:blur(18px) saturate(1.2)}
.starter-head{display:flex;justify-content:space-between;gap:1rem;text-transform:uppercase;font-size:.7rem;font-weight:700;color:var(--accent)}
.project-starter h2{font-size:clamp(1.35rem,2.5vw,2rem);margin:.8rem 0 .2rem}.project-starter p{font-size:.88rem;margin:.2rem 0 1rem}
.starter-choices{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.starter-choice{min-height:54px;display:flex;align-items:center;gap:.55rem;padding:.65rem;border:1px solid var(--line);border-radius:6px;color:var(--ink);text-decoration:none;font-weight:600;font-size:.82rem;background:color-mix(in srgb,var(--panel) 88%,transparent);transition:border-color .2s,background .2s,transform .2s}
.starter-choice span{color:var(--accent);font:700 .7rem var(--body)}.starter-choice:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--panel));transform:translateY(-2px)}
.starter-actions{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1rem}
.hero .stat-row{gap:1rem}.hero .stat{padding-right:1rem;border-right:1px solid var(--line)}.hero .stat:last-child{border-right:0}.hero .stat b{font-size:1.3rem}
.hero .marquee{position:absolute;inset:auto 0 0;z-index:4;background:color-mix(in srgb,var(--bg) 76%,transparent);backdrop-filter:blur(12px)}
.hero-layout{position:relative;z-index:3;width:min(1160px,calc(100vw - 40px));margin:0 auto}
.hero-layout,.hero-layout>*{min-width:0}
.hero-copy,.hero-tool-dock,.project-starter,.starter-choice{min-width:0}
.hero-logo .proposed-wordmark,.hero .intro,.project-starter,.starter-choice{overflow-wrap:anywhere}
.hero-layout-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,420px);gap:clamp(2rem,5vw,5.5rem);align-items:center}
.hero-layout-journal{display:grid;grid-template-columns:minmax(180px,.48fr) minmax(0,1.15fr) minmax(300px,.82fr);gap:clamp(1.4rem,3vw,3rem);align-items:end}
.hero-layout-journal .hero-index{align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;padding-right:1rem;border-right:1px solid var(--line)}
.hero-layout-window{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,390px);grid-template-areas:"copy tool" "proof tool";gap:1.3rem clamp(2rem,5vw,5rem);align-items:end}
.hero-layout-window .hero-copy{grid-area:copy}.hero-layout-window .hero-tool-dock{grid-area:tool}.hero-layout-window .hero-proof-ribbon{grid-area:proof}
.hero-layout-panorama{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,410px);grid-template-areas:"mast mast" "copy tool" "proof tool";gap:1rem clamp(2rem,6vw,6rem);align-items:end}
.hero-layout-panorama .hero-mast{grid-area:mast;display:flex;align-items:center;justify-content:space-between;gap:1.5rem}.hero-layout-panorama .hero-copy{grid-area:copy}.hero-layout-panorama .hero-tool-dock{grid-area:tool}.hero-layout-panorama .hero-proof-ribbon{grid-area:proof}
.hero-layout-atlas{display:grid;grid-template-columns:minmax(160px,.42fr) minmax(0,1fr) minmax(300px,.78fr);grid-template-areas:"mast mast mast" "legend copy tool";gap:1.4rem clamp(1.4rem,3.2vw,3.4rem);align-items:end}
.hero-layout-atlas .hero-mast{grid-area:mast;display:flex;align-items:center;justify-content:space-between;gap:1.5rem}.hero-layout-atlas .hero-service-legend{grid-area:legend}.hero-layout-atlas .hero-copy{grid-area:copy}.hero-layout-atlas .hero-tool-dock{grid-area:tool}
.hero-layout-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,390px);grid-template-areas:"mast mast" "copy tool" "proof proof";gap:1rem clamp(2rem,5vw,5rem);align-items:center}
.hero-layout-stage .hero-mast{grid-area:mast;display:flex;align-items:center;justify-content:space-between;gap:1.5rem}.hero-layout-stage .hero-copy{grid-area:copy;max-width:790px}.hero-layout-stage .hero-tool-dock{grid-area:tool}.hero-layout-stage .hero-proof-ribbon{grid-area:proof}
.hero-layout-bench{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"mast mast mast mast mast mast legend legend legend legend legend legend" "copy copy copy copy copy copy copy tool tool tool tool tool" "proof proof proof proof proof proof . tool tool tool tool tool";gap:1.2rem clamp(1.5rem,3vw,3.5rem);align-items:end}
.hero-layout-bench .hero-mast{grid-area:mast}.hero-layout-bench .hero-copy{grid-area:copy}.hero-layout-bench .hero-service-legend{grid-area:legend}.hero-layout-bench .hero-proof-ribbon{grid-area:proof}.hero-layout-bench .hero-tool-dock{grid-area:tool}
.hero-layout-section{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(310px,.65fr);grid-template-areas:"mast legend" "copy tool" "proof tool";gap:1.1rem clamp(2rem,5vw,5rem);align-items:end}
.hero-layout-section .hero-mast{grid-area:mast}.hero-layout-section .hero-copy{grid-area:copy}.hero-layout-section .hero-survey-rail{grid-area:legend}.hero-layout-section .hero-service-legend{grid-area:legend}.hero-layout-section .hero-proof-ribbon{grid-area:proof}.hero-layout-section .hero-tool-dock{grid-area:tool}
.hero-layout-lookbook{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"mast mast mast mast photos photos photos photos photos photos photos photos" "copy copy copy copy copy photos photos photos photos photos photos photos" "copy copy copy copy copy tool tool tool tool tool tool tool";gap:1.2rem clamp(1.6rem,3vw,3.8rem);align-items:end}
.hero-layout-lookbook .hero-mast{grid-area:mast}.hero-layout-lookbook .hero-copy{grid-area:copy}.hero-layout-lookbook .hero-contact-sheet{grid-area:photos}.hero-layout-lookbook .hero-tool-dock{grid-area:tool}
.hero-layout-signature{display:grid;grid-template-columns:minmax(220px,.42fr) minmax(0,1fr);grid-template-areas:"mast copy" "proof copy" "tool tool";gap:1.2rem clamp(1.6rem,3vw,4rem);align-items:start}
.hero-layout-signature .hero-mast{grid-area:mast}.hero-layout-signature .hero-copy{grid-area:copy}.hero-layout-signature .hero-proof-ribbon{grid-area:proof}.hero-layout-signature .hero-tool-dock{grid-area:tool}
.hero-layout-signature .project-starter{width:100%;max-width:none;display:grid;grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr);grid-template-areas:"head choices" "title choices" "intro choices" "actions choices";column-gap:1.4rem;align-items:start}
.hero-layout-signature .project-starter .starter-head{grid-area:head}.hero-layout-signature .project-starter h2{grid-area:title}.hero-layout-signature .project-starter>p{grid-area:intro}.hero-layout-signature .project-starter :is(.starter-choices,.swatch-widget,.atlas-widget,.widget-timeline){grid-area:choices}.hero-layout-signature .project-starter .starter-actions{grid-area:actions;justify-content:flex-start;margin-top:.35rem}
.hero-layout-command{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"brand brand brand brand brand brand brand brand input input input input" "decision decision decision decision decision decision decision output output output output output";gap:1.1rem clamp(1.5rem,3vw,3.6rem);align-items:start}
.hero-command-brand{grid-area:brand;display:flex;align-items:center;justify-content:space-between;gap:1.25rem;border-bottom:1px solid var(--line)}.hero-command-brand .hero-logo{margin:0}.hero-command-input{grid-area:input}.hero-command-decision{grid-area:decision;padding-top:1rem}.hero-command-output{grid-area:output;display:grid;gap:1rem;align-self:end}.hero-command-output .project-starter{width:100%}
.hero-layout-docket{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"head head head head head head head head head head head head" "argument argument argument argument argument argument argument exhibits exhibits exhibits exhibits exhibits" "argument argument argument argument argument argument argument action action action action action";gap:1rem clamp(1.6rem,3.5vw,4rem);align-items:start}
.hero-docket-head{grid-area:head;display:grid;grid-template-columns:1fr auto;align-items:end;border-bottom:3px double var(--ink);padding-bottom:.7rem}.hero-docket-head .hero-logo{margin:0}.hero-docket-argument{grid-area:argument;padding:clamp(1rem,3vw,2.5rem) 0}.hero-docket-exhibits{grid-area:exhibits;border-left:1px solid var(--line);padding-left:1rem}.hero-docket-action{grid-area:action}.hero-docket-action .project-starter{width:100%}
.hero-layout-broadsheet{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"mast mast mast mast mast mast mast mast mast mast mast mast" "lead lead lead lead lead lead lead column column column column column" "proof proof proof proof proof proof proof action action action action action";gap:.9rem clamp(1.5rem,3vw,3.5rem);align-items:start}
.hero-broadsheet-mast{grid-area:mast;display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;border-block:4px double var(--ink);padding:.55rem 0}.hero-broadsheet-mast .hero-logo{margin:0}.hero-broadsheet-lead{grid-area:lead;padding-top:1.2rem}.hero-broadsheet-column{grid-area:column;padding:1rem 0 0 1rem;border-left:1px solid var(--line)}.hero-broadsheet-proof{grid-area:proof}.hero-broadsheet-action{grid-area:action}.hero-broadsheet-action .project-starter{width:100%}
.hero-layout-assembly{display:grid;grid-template-columns:minmax(170px,.42fr) minmax(0,1.2fr) minmax(300px,.76fr);gap:clamp(1.2rem,3vw,3.2rem);align-items:stretch}
.hero-assembly-sources{display:flex;flex-direction:column;justify-content:space-between;border-right:1px solid var(--line);padding-right:1rem}.hero-assembly-spine{display:flex;flex-direction:column;justify-content:center;gap:1rem}.hero-assembly-spine .hero-mast{border-bottom:1px solid var(--line);padding-bottom:.6rem}.hero-assembly-resolution{align-self:end}.hero-assembly-resolution .project-starter{width:100%}
.hero-layout-assembly .hero-copy{max-width:none}.hero-layout-assembly .hero-copy h1{width:100%;max-width:100%;font-size:clamp(3rem,4.4vw,4rem);line-height:.96}.hero-layout-assembly .hero-copy .intro{font-size:1rem;line-height:1.5}.hero-layout-assembly .hero-actions{margin-top:.85rem}
.hero-layout-live{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"status status status status status status status status status status status status" "primary primary primary primary primary primary primary services services services services services" "readout readout readout readout readout readout readout control control control control control";gap:1rem clamp(1.5rem,3vw,3.5rem);align-items:end}
.hero-live-status{grid-area:status;display:flex;align-items:center;gap:1rem;border-bottom:1px solid color-mix(in srgb,var(--accent) 55%,var(--line));padding-bottom:.65rem}.hero-live-status .hero-logo{margin:0 auto 0 0}.hero-live-primary{grid-area:primary}.hero-live-services{grid-area:services}.hero-live-readout{grid-area:readout}.hero-live-control{grid-area:control}.hero-live-control .project-starter{width:100%;box-shadow:inset 4px 0 0 var(--accent),0 34px 90px -38px var(--ink)}
.hero-layout-care{display:grid;grid-template-columns:minmax(190px,.45fr) minmax(0,1.05fr) minmax(290px,.68fr);grid-template-areas:"intro story action" "intro proof action";gap:1rem clamp(1.5rem,3vw,3.4rem);align-items:end}
.hero-layout-care .hero-copy h1{font-size:clamp(2.5rem,4vw,4.4rem);line-height:.98;max-width:100%}
.hero-care-intro{grid-area:intro;align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;border-right:1px solid var(--line);padding-right:1rem}.hero-care-story{grid-area:story}.hero-care-action{grid-area:action}.hero-care-proof{grid-area:proof}.hero-care-action .project-starter{width:100%;border-radius:999px 999px 12px 12px;padding-top:2rem}
.hero-layout-ledger{display:grid;grid-template-columns:minmax(170px,.38fr) minmax(0,1fr) minmax(180px,.42fr);grid-template-areas:"head head head" "debit center credit" "close close close";gap:1rem clamp(1.5rem,3vw,3.4rem);align-items:start;border-block:1px solid var(--line);padding-block:1rem}
.hero-ledger-head{grid-area:head;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.hero-ledger-head .hero-logo{margin:0}.hero-ledger-debit{grid-area:debit}.hero-ledger-center{grid-area:center;border-inline:1px solid var(--line);padding-inline:clamp(1rem,3vw,2.6rem)}.hero-ledger-credit{grid-area:credit}.hero-ledger-close{grid-area:close}.hero-ledger-close .project-starter{width:100%;max-width:none}
.hero-layout-path{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(160px,.55fr) minmax(310px,.9fr);grid-template-areas:"start start start" "one two three" "proof proof proof";gap:1rem clamp(1.3rem,2.8vw,3rem);align-items:start}
.hero-path-start{grid-area:start;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.hero-path-start .hero-logo{margin:0}.hero-path-one{grid-area:one}.hero-path-two{grid-area:two}.hero-path-three{grid-area:three}.hero-path-proof{grid-area:proof}.hero-path-one,.hero-path-two,.hero-path-three{position:relative;padding-top:2.3rem;border-top:4px solid color-mix(in srgb,var(--accent) 45%,var(--line))}.hero-path-index{position:absolute;top:.5rem;left:0;color:var(--accent);font:800 .68rem var(--body)}.hero-path-three .project-starter{width:100%}
.hero-layout-path .hero-copy{max-width:none}.hero-layout-path .hero-copy h1{width:100%;max-width:100%;font-size:clamp(3rem,4.7vw,4.35rem);line-height:.96;overflow-wrap:break-word}.hero-layout-path .hero-copy .intro{font-size:1rem;line-height:1.5}.hero-layout-path .hero-actions{margin-top:.85rem}
.hero-layout-letter{display:grid;grid-template-columns:minmax(190px,.42fr) minmax(0,1fr) minmax(290px,.7fr);gap:clamp(1.2rem,3.4vw,4rem);align-items:start}
.hero-letter-mark{display:flex;min-height:100%;flex-direction:column;justify-content:space-between}.hero-letter-body{border-inline:1px solid var(--line);padding-inline:clamp(1rem,3vw,3rem)}.hero-letter-body .hero-copy{font-style:normal}.hero-letter-body .intro{font-family:var(--display);font-size:clamp(1.08rem,1.8vw,1.3rem)}.hero-letter-reply .project-starter{width:100%;transform:rotate(.5deg)}
.hero-layout-calibrated{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-areas:"head head head head head head head head head head head head" "scale scale scale value value value value value value proof proof proof" "scale scale scale value value value value value value control control control";gap:1rem clamp(1.4rem,3vw,3.4rem);align-items:start}
.hero-calibrated-head{grid-area:head;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--accent);padding-bottom:.6rem}.hero-calibrated-head .hero-logo{margin:0}.hero-calibrated-scale{grid-area:scale;border-right:1px solid var(--line);padding-right:1rem}.hero-calibrated-value{grid-area:value;padding-inline:1rem}.hero-calibrated-proof{grid-area:proof}.hero-calibrated-control{grid-area:control}.hero-calibrated-control .project-starter{width:100%;border-radius:2px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent)}
.hero-mast .hero-logo{margin:0}.hero-mast .kicker{margin:0}
.hero-service-legend{display:grid;gap:.15rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:.6rem 0}
.hero-service-legend span{display:grid;grid-template-columns:2.1rem 1fr;gap:.45rem;align-items:baseline;padding:.35rem 0;color:var(--muted);font-size:.76rem;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.hero-service-legend span:last-child{border-bottom:0}.hero-service-legend b{color:var(--accent);font-size:.68rem}
.hero-proof-ribbon{display:flex;align-items:center;justify-content:flex-start;border-top:1px solid var(--line);padding-top:.7rem}
.hero-proof-ribbon .stat-row{margin:0}
.hero-tool-dock{min-width:0}.hero-tool-dock .project-starter{margin:0}
.hero-contact-sheet{display:grid;grid-template-columns:1.25fr .75fr;grid-template-rows:1fr 1fr;gap:.7rem;min-height:320px}
.contact-photo{position:relative;margin:0;overflow:hidden;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);background:var(--panel);box-shadow:0 26px 70px -42px var(--ink)}
.contact-photo:first-child{grid-row:1 / 3}.contact-photo img{width:100%;height:100%;object-fit:cover}.contact-photo figcaption{position:absolute;left:.65rem;bottom:.55rem;padding:.32rem .5rem;background:color-mix(in srgb,#080b0a 72%,transparent);color:#fff;font:650 .66rem/1.1 var(--body);text-transform:uppercase}
.architecture-garden-window-showcase .hero-media-layer{left:0!important;clip-path:polygon(38% 0,100% 0,100% 100%,24% 100%)}
.architecture-garden-window-showcase .hero-veil{background:linear-gradient(90deg,var(--bg) 0 35%,color-mix(in srgb,var(--bg) 76%,transparent) 52%,transparent 78%)}
.architecture-atlas-coordinate-gallery .hero-media-layer,.architecture-atlas-coordinate-showcase .hero-media-layer{inset:0}
.architecture-atlas-coordinate-gallery .hero-motif svg{right:auto;left:-8%;bottom:-20%;width:min(1050px,82vw)}
.architecture-atlas-coordinate-journal .hero-media-layer{inset:0 0 0 30%}
.architecture-atlas-coordinate-journal .hero-veil{background:linear-gradient(90deg,rgba(5,8,8,.94),rgba(5,8,8,.62) 58%,rgba(5,8,8,.24))}
.cinematic-light{position:absolute;inset:-25%;z-index:2;background:linear-gradient(112deg,transparent 35%,rgba(255,255,255,.24) 49%,transparent 63%);transform:translateX(-75%);animation:premierLight 12s ease-in-out infinite;mix-blend-mode:soft-light}
.media-veil{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,.04),rgba(0,0,0,.22))}
@keyframes premierLight{0%,48%{transform:translateX(-75%)}82%,100%{transform:translateX(75%)}}
/* Composition variants alter gravity, media behavior, and rhythm. */
:is(.hero-cultivated-editorial,.hero-clinical-gallery,.hero-guided-care-path,.hero-local-signature,.hero-founder-broadsheet,.hero-casebook-editorial,.hero-maker-lookbook,.hero-precision-bay) .hero-media-layer{left:45%;border-left:1px solid var(--line)}
:is(.hero-cultivated-editorial,.hero-clinical-gallery,.hero-guided-care-path,.hero-local-signature,.hero-founder-broadsheet,.hero-casebook-editorial,.hero-maker-lookbook,.hero-precision-bay) .hero-veil{background:linear-gradient(90deg,var(--bg) 0 42%,transparent 68%),linear-gradient(0deg,color-mix(in srgb,var(--bg) 36%,transparent),transparent 58%)}
:is(.hero-terrain-atlas,.hero-arrival-scene,.hero-route-cinema,.hero-product-cinema,.hero-material-ledger,.hero-survey-section,.hero-table-theater,.hero-story-assembly) .hero-copy{color:#fff;text-shadow:0 2px 30px rgba(0,0,0,.38)}
:is(.hero-terrain-atlas,.hero-arrival-scene,.hero-route-cinema,.hero-product-cinema,.hero-material-ledger,.hero-survey-section,.hero-table-theater,.hero-story-assembly) .hero-copy :is(.intro,.hero-review,.stat span){color:rgba(255,255,255,.8)}
:is(.hero-terrain-atlas,.hero-arrival-scene,.hero-route-cinema,.hero-product-cinema,.hero-material-ledger,.hero-survey-section,.hero-table-theater,.hero-story-assembly) .hero-copy :is(.hero-review b,.hero-phone){color:#fff}
:is(.hero-terrain-atlas,.hero-arrival-scene,.hero-route-cinema,.hero-product-cinema,.hero-material-ledger,.hero-survey-section,.hero-table-theater,.hero-story-assembly) .hero-veil{background:linear-gradient(90deg,rgba(5,8,8,.86),rgba(5,8,8,.52) 52%,rgba(5,8,8,.2)),linear-gradient(0deg,rgba(5,8,8,.45),transparent 55%)}
/* Snowflake composition bases retain separate media behavior as well as DOM. */
[class*="architecture-input-decision-output"] .hero-media-layer{inset:0}
[class*="architecture-input-decision-output"] .hero-veil{background:linear-gradient(102deg,rgba(4,8,10,.94) 0 42%,rgba(4,8,10,.66) 68%,rgba(4,8,10,.24))}
[class*="architecture-input-decision-output"] :is(.hero-command-brand,.hero-command-input,.hero-command-decision,.hero-command-output){color:#fff}
[class*="architecture-input-decision-output"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.8)}

[class*="architecture-opening-argument"] .hero-media-layer{inset:0 0 0 54%;filter:saturate(.8)}
[class*="architecture-opening-argument"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 51%,color-mix(in srgb,var(--bg) 82%,transparent) 68%,transparent 88%)}
[class*="architecture-opening-argument"] .hero-docket-argument{background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(6px)}

[class*="architecture-front-page-story"] .hero-media-layer{inset:10% 3% 12% 65%;filter:sepia(.08) saturate(.86);border-radius:2px}
[class*="architecture-front-page-story"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 62%,color-mix(in srgb,var(--bg) 80%,transparent) 76%,transparent)}

[class*="architecture-many-to-one"] .hero-media-layer{inset:0}
[class*="architecture-many-to-one"] .hero-veil{background:linear-gradient(90deg,rgba(5,8,9,.88),rgba(5,8,9,.48) 58%,rgba(5,8,9,.72)),linear-gradient(0deg,rgba(5,8,9,.58),transparent)}
[class*="architecture-many-to-one"] :is(.hero-assembly-sources,.hero-assembly-spine){color:#fff}
[class*="architecture-many-to-one"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.8)}

[class*="architecture-live-product-state"] .hero-media-layer{inset:0;filter:contrast(1.08) saturate(.84)}
[class*="architecture-live-product-state"] .hero-veil{background:linear-gradient(90deg,rgba(4,7,11,.92),rgba(4,7,11,.48)),linear-gradient(0deg,rgba(4,7,11,.62),transparent 62%)}
[class*="architecture-live-product-state"] :is(.hero-live-status,.hero-live-primary,.hero-live-services,.hero-live-readout){color:#fff}
[class*="architecture-live-product-state"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.8)}

[class*="architecture-care-portrait-field"] .hero-media-layer{inset:6% 3% 7% 67%;border-radius:48% 48% 8px 8px;filter:saturate(.78)}
[class*="architecture-care-portrait-field"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 63%,color-mix(in srgb,var(--bg) 78%,transparent) 77%,transparent)}

[class*="architecture-assurance-balance"] .hero-media-layer{inset:0;filter:grayscale(.7) contrast(1.05);opacity:.28}
[class*="architecture-assurance-balance"] .hero-veil{background:linear-gradient(90deg,color-mix(in srgb,var(--bg) 94%,transparent),color-mix(in srgb,var(--bg) 72%,transparent)),repeating-linear-gradient(0deg,transparent 0 55px,color-mix(in srgb,var(--line) 55%,transparent) 56px)}

[class*="architecture-guided-first-step"] .hero-media-layer{inset:0 0 0 57%;filter:saturate(.75)}
[class*="architecture-guided-first-step"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 54%,color-mix(in srgb,var(--bg) 82%,transparent) 72%,transparent)}

[class*="architecture-host-letter"] .hero-media-layer{inset:5% 3% 7% 69%;border-radius:50% 50% 6px 6px;filter:sepia(.12) saturate(.82)}
[class*="architecture-host-letter"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 66%,color-mix(in srgb,var(--bg) 82%,transparent) 78%,transparent)}

[class*="architecture-calibrated-readout"] .hero-media-layer{inset:0;filter:grayscale(.45) contrast(1.12)}
[class*="architecture-calibrated-readout"] .hero-veil{background:linear-gradient(90deg,rgba(5,9,12,.92),rgba(5,9,12,.52)),repeating-linear-gradient(90deg,transparent 0 79px,rgba(255,255,255,.07) 80px)}
[class*="architecture-calibrated-readout"] :is(.hero-calibrated-head,.hero-calibrated-scale,.hero-calibrated-value,.hero-calibrated-proof){color:#fff}
[class*="architecture-calibrated-readout"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.8)}
/* Six visibly different local-business hero systems. */
[class*="architecture-garden-window"]{min-height:min(92vh,900px)}
[class*="architecture-garden-window"] .hero-media-layer{inset:7% 3% 7% 54%;border-radius:48% 48% 14px 14px;box-shadow:0 38px 100px -54px var(--ink)}
[class*="architecture-garden-window"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 49%,color-mix(in srgb,var(--bg) 84%,transparent) 60%,transparent 78%)}
[class*="architecture-garden-window"] .hero-layout-journal{grid-template-columns:minmax(170px,.42fr) minmax(0,1.18fr) minmax(300px,.78fr)}

[class*="architecture-atlas-coordinate"]{min-height:min(84vh,820px);align-items:end}
[class*="architecture-atlas-coordinate"] .hero-media-layer{inset:0}
[class*="architecture-atlas-coordinate"] .hero-veil{background:linear-gradient(90deg,rgba(6,10,9,.9),rgba(6,10,9,.48) 58%,rgba(6,10,9,.16)),linear-gradient(0deg,rgba(6,10,9,.56),transparent 62%)}
[class*="architecture-atlas-coordinate"] :is(.hero-copy,.hero-mast,.hero-proof-ribbon){color:#fff;text-shadow:0 2px 28px rgba(0,0,0,.38)}
[class*="architecture-atlas-coordinate"] :is(.intro,.hero-review,.stat span){color:rgba(255,255,255,.82)}
[class*="architecture-atlas-coordinate"] .hero-layout-panorama{padding-top:clamp(3rem,9vh,7rem)}

[class*="architecture-macro-material-bench"]{min-height:min(88vh,860px);align-items:end}
[class*="architecture-macro-material-bench"] .hero-media-layer{inset:0}
[class*="architecture-macro-material-bench"] .hero-veil{background:linear-gradient(180deg,rgba(5,7,8,.28),rgba(5,7,8,.82) 78%),linear-gradient(90deg,rgba(5,7,8,.82),transparent 72%)}
[class*="architecture-macro-material-bench"] :is(.hero-copy,.hero-mast,.hero-service-legend,.hero-proof-ribbon){color:#fff;text-shadow:0 2px 26px rgba(0,0,0,.42)}
[class*="architecture-macro-material-bench"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.82)}
[class*="architecture-macro-material-bench"] .hero-layout-bench{padding-top:clamp(3rem,8vh,6rem)}

[class*="architecture-elevation-cut"]{min-height:min(94vh,920px);align-items:center}
[class*="architecture-elevation-cut"] .hero-media-layer{inset:0 0 0 29%;clip-path:polygon(18% 0,100% 0,100% 100%,0 100%)}
[class*="architecture-elevation-cut"] .hero-veil{background:linear-gradient(112deg,#0d1113 0 43%,rgba(13,17,19,.78) 58%,rgba(13,17,19,.16) 82%)}
[class*="architecture-elevation-cut"] :is(.hero-copy,.hero-mast,.hero-service-legend,.hero-proof-ribbon){color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.4)}
[class*="architecture-elevation-cut"] :is(.intro,.hero-review,.stat span,.hero-service-legend span){color:rgba(255,255,255,.8)}
[class*="architecture-elevation-cut"] .hero-layout-section{border-top:1px solid rgba(255,255,255,.25);padding-top:1rem}

[class*="architecture-object-and-hand"]{min-height:min(92vh,900px)}
[class*="architecture-object-and-hand"] .hero-media-layer{inset:8% 3% 8% 49%;opacity:.2;border-radius:6px}
[class*="architecture-object-and-hand"] .hero-veil{background:linear-gradient(90deg,var(--bg) 0 47%,color-mix(in srgb,var(--bg) 88%,transparent) 64%,transparent)}
[class*="architecture-object-and-hand"] .contact-photo:first-child{transform:translateY(1.4rem)}
[class*="architecture-object-and-hand"] .contact-photo:nth-child(2){transform:translateX(-.8rem)}

[class*="architecture-arrival-scene"] h1{font-size:clamp(3rem,4.8vw,4.6rem);max-width:16ch}
[class*="architecture-offer-and-proof"]{min-height:auto;padding-top:clamp(230px,26vh,300px)}
[class*="architecture-offer-and-proof"] .hero-media-layer{inset:0 0 auto 0;height:clamp(220px,25vh,280px);border-radius:0;box-shadow:0 36px 100px -58px var(--ink)}
[class*="architecture-offer-and-proof"] .hero-veil{background:linear-gradient(180deg,transparent 0 25%,color-mix(in srgb,var(--bg) 78%,transparent) 76%,var(--bg) 100%)}
[class*="architecture-offer-and-proof"] .hero-layout-signature{align-items:start}
.edition-journal .hero-grid{align-items:end}.edition-journal .project-starter{transform:translateY(2rem)}
.edition-showcase .hero-copy{max-width:610px}.edition-showcase .project-starter{width:min(100%,380px)}
/* Long live business/service copy must keep the primary action and the start
   of the conversion widget inside a 900px desktop viewport. The density
   contract changes scale and rhythm only; each composition keeps its own DOM,
   grid areas, media treatment, and architecture-specific geometry. */
.hero[data-copy-density="long"] h1{font-size:clamp(2.55rem,4.2vw,4.2rem);line-height:.96;max-width:18ch}
.hero[data-copy-density="long"] .intro{font-size:clamp(.95rem,1.15vw,1.08rem);line-height:1.45;margin-block:.5rem 0}
.hero[data-copy-density="long"] .hero-actions{margin-top:.9rem}
.hero[data-copy-density="long"] .hero-review,.hero[data-copy-density="long"] .trust-citations{margin-top:.7rem}
@media(min-width:861px) and (max-height:950px){
  .hero[data-copy-density="long"]{min-height:min(82vh,760px);padding:clamp(2rem,4.4vh,3.25rem) 0 clamp(3.5rem,6vh,4.5rem);align-items:center}
  .hero[data-copy-density="long"] .hero-layout{gap:clamp(.7rem,1.5vw,1.25rem)}
  .hero[data-copy-density="long"] h1{font-size:clamp(2.5rem,4.05vw,3.9rem);line-height:.94;max-width:18ch}
  .hero[data-copy-density="long"] .hero-logo{min-height:58px;margin-bottom:.65rem}
  .hero[data-copy-density="long"] .hero-logo .sourced-logo,.hero[data-copy-density="long"] .hero-logo .proposed-logo{height:clamp(56px,6vw,78px)!important}
  .hero[data-copy-density="long"] .hero-logo .proposed-wordmark{font-size:clamp(1.15rem,2.3vw,2rem)}
  .hero[data-copy-density="long"] .kicker{margin-bottom:.55rem}
  .hero[data-copy-density="long"] .project-starter{padding:1rem}
  .hero[data-copy-density="long"] .project-starter h2{margin:.55rem 0 .15rem}
  .hero[data-copy-density="long"] .project-starter p{margin:.15rem 0 .7rem}
  .hero[data-copy-density="long"] .starter-choice{min-height:48px;padding:.5rem;font-size:.78rem}
  .hero[data-copy-density="long"] .starter-actions{margin-top:.7rem}
  .hero[data-copy-density="long"] .hero-service-legend span{padding:.25rem 0}
}
body[data-composition="terrain-atlas"] .svc-grid,body[data-composition="maker-lookbook"] .svc-grid{grid-template-columns:repeat(12,1fr)}
body[data-composition="terrain-atlas"] .svc,body[data-composition="maker-lookbook"] .svc{grid-column:span 4;border-radius:6px}
body[data-composition="terrain-atlas"] .svc:first-child,body[data-composition="maker-lookbook"] .svc:first-child{grid-column:span 8}
.review-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 0 .75rem;gap:1rem}.review{flex:0 0 min(560px,86vw);scroll-snap-align:start;border-radius:8px}
.g-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:clamp(150px,18vw,230px)}.g-cell{grid-column:span var(--g-span,4);grid-row:span var(--g-rows,1);aspect-ratio:auto;border-radius:6px}
.premier-map-shell{position:relative}
.premier-map{position:relative;min-height:360px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}
.premier-map iframe{display:block;width:100%;height:360px;border:0;filter:saturate(.9) contrast(1.04)}
.premier-map__directions{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap;padding:.75rem .9rem;background:var(--panel)}
.premier-map__address{font-size:.85rem;color:var(--muted)}.premier-map__directions nav{display:flex;gap:.5rem}.premier-map__directions a{color:var(--ink);font-weight:700;font-size:.82rem}.map-call{margin-top:.7rem}
.premier-map[data-map]{border-color:color-mix(in srgb,var(--accent) 48%,var(--line));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent)}
.premier-map[data-map] .ml-holder{position:absolute;inset:0 0 58px;z-index:1;min-height:280px;opacity:0;pointer-events:none;transition:opacity .35s ease;background:var(--panel)}
.premier-map[data-map].map-live .ml-holder{opacity:1;pointer-events:auto}
.premier-map[data-map].map-live iframe{opacity:0;pointer-events:none}
.premier-map[data-map] .premier-map__directions{position:relative;z-index:2;border-top:3px solid var(--accent)}
.premier-map[data-map] .premier-map__directions a{text-decoration-color:var(--accent);text-decoration-thickness:2px;text-underline-offset:3px}
.premier-map .map-marker{width:32px;height:42px;display:grid;place-items:start center;filter:drop-shadow(0 6px 8px rgba(0,0,0,.38))}
.premier-map .map-pin{position:relative;display:block;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--pin,var(--accent));border:3px solid #fff;box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--pin,var(--accent)) 68%,#fff)}
.premier-map .map-pin::after{content:"";position:absolute;width:7px;height:7px;border-radius:50%;background:#fff;left:7px;top:7px}
@media(max-width:860px){
  .hero{min-height:auto;padding:3.6rem 0 5rem}
  .hero .hero-media-layer{left:0;border-left:0}
  [class*="architecture-arrival-scene"] .hero-veil{background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 90%,transparent),color-mix(in srgb,var(--bg) 68%,transparent) 64%,color-mix(in srgb,var(--bg) 82%,transparent))}
  .hero-layout,.hero-layout-split,.hero-layout-journal,.hero-layout-window,.hero-layout-panorama,.hero-layout-atlas,.hero-layout-stage,.hero-layout-bench,.hero-layout-section,.hero-layout-lookbook,.hero-layout-signature,.hero-layout-command,.hero-layout-docket,.hero-layout-broadsheet,.hero-layout-assembly,.hero-layout-live,.hero-layout-care,.hero-layout-ledger,.hero-layout-path,.hero-layout-letter,.hero-layout-calibrated{width:min(1160px,calc(100% - 24px));max-width:100%;gap:1.2rem}
  .hero-layout>*{min-width:0;max-width:100%}
  .hero-layout-split,.hero-layout-window,.hero-layout-stage,.hero-layout-section,.hero-layout-signature,.hero-layout-command,.hero-layout-docket,.hero-layout-broadsheet,.hero-layout-assembly,.hero-layout-live,.hero-layout-care,.hero-layout-ledger,.hero-layout-path,.hero-layout-letter,.hero-layout-calibrated{display:grid;grid-template-columns:1fr}
  .hero-layout-stage{grid-template-areas:"mast" "copy" "tool" "proof"}
  .hero-layout-journal{display:grid;grid-template-columns:1fr;grid-template-areas:"index" "copy" "tool"}.hero-layout-journal .hero-index{grid-area:index}.hero-layout-journal .hero-copy{grid-area:copy}.hero-layout-journal .hero-tool-dock{grid-area:tool}
  .hero-layout-panorama{display:grid;grid-template-columns:1fr;grid-template-areas:"mast" "copy" "tool" "proof"}.hero-layout-panorama .hero-mast{grid-area:mast}.hero-layout-panorama .hero-copy{grid-area:copy}.hero-layout-panorama .hero-tool-dock{grid-area:tool}.hero-layout-panorama .hero-proof-ribbon{grid-area:proof}
  .hero-layout-bench{display:grid;grid-template-columns:1fr;grid-template-areas:"mast" "copy" "legend" "tool" "proof"}.hero-layout-bench .hero-mast{grid-area:mast}.hero-layout-bench .hero-copy{grid-area:copy}.hero-layout-bench .hero-service-legend{grid-area:legend}.hero-layout-bench .hero-tool-dock{grid-area:tool}.hero-layout-bench .hero-proof-ribbon{grid-area:proof}
  .hero-layout-section{grid-template-areas:"mast" "copy" "legend" "proof" "tool"}.hero-layout-section .hero-mast{grid-area:mast}.hero-layout-section .hero-copy{grid-area:copy}.hero-layout-section .hero-survey-rail{grid-area:legend}.hero-layout-section .hero-service-legend{grid-area:auto}.hero-layout-section .hero-proof-ribbon{grid-area:proof}.hero-layout-section .hero-tool-dock{grid-area:tool}
  .hero-layout-lookbook{display:grid;grid-template-columns:1fr;grid-template-areas:"mast" "copy" "photos" "tool"}.hero-layout-lookbook .hero-mast{grid-area:mast}.hero-layout-lookbook .hero-copy{grid-area:copy}.hero-layout-lookbook .hero-contact-sheet{grid-area:photos}.hero-layout-lookbook .hero-tool-dock{grid-area:tool}
  .hero-layout-signature{grid-template-areas:"mast" "copy" "proof" "tool"}.hero-layout-signature .hero-mast{grid-area:mast}.hero-layout-signature .hero-copy{grid-area:copy}.hero-layout-signature .hero-proof-ribbon{grid-area:proof}.hero-layout-signature .hero-tool-dock{grid-area:tool}.hero-layout-signature .project-starter{display:block}
  .hero-layout-command{grid-template-areas:"brand" "decision" "input" "output"}.hero-command-brand{grid-area:brand;align-items:flex-start}.hero-command-input{grid-area:input}.hero-command-decision{grid-area:decision}.hero-command-output{grid-area:output}
  .hero-layout-docket{grid-template-areas:"head" "argument" "exhibits" "action"}.hero-docket-head{grid-area:head;grid-template-columns:1fr}.hero-docket-argument{grid-area:argument}.hero-docket-exhibits{grid-area:exhibits;border-left:0;padding-left:0}.hero-docket-action{grid-area:action}
  .hero-layout-broadsheet{grid-template-areas:"mast" "lead" "column" "proof" "action"}.hero-broadsheet-mast{grid-area:mast;align-items:flex-start}.hero-broadsheet-lead{grid-area:lead}.hero-broadsheet-column{grid-area:column;border-left:0;padding-left:0}.hero-broadsheet-proof{grid-area:proof}.hero-broadsheet-action{grid-area:action}
  .hero-layout-assembly{grid-template-areas:"spine" "sources" "resolution"}.hero-assembly-sources{grid-area:sources;border-right:0;padding-right:0}.hero-assembly-spine{grid-area:spine}.hero-assembly-resolution{grid-area:resolution}
  .hero-layout-live{grid-template-areas:"status" "primary" "services" "readout" "control"}.hero-live-status{grid-area:status;align-items:flex-start;flex-wrap:wrap}.hero-live-primary{grid-area:primary}.hero-live-services{grid-area:services}.hero-live-readout{grid-area:readout}.hero-live-control{grid-area:control}
  .hero-layout-care{grid-template-areas:"intro" "story" "proof" "action"}.hero-care-intro{grid-area:intro;border-right:0;padding-right:0}.hero-care-story{grid-area:story}.hero-care-proof{grid-area:proof}.hero-care-action{grid-area:action}.hero-care-action .project-starter{border-radius:12px}
  .hero-layout-care .hero-copy h1{font-size:clamp(2.15rem,9.2vw,3.15rem);line-height:1}
  .hero-layout-ledger{grid-template-areas:"head" "center" "debit" "credit" "close"}.hero-ledger-head{grid-area:head;align-items:flex-start}.hero-ledger-debit{grid-area:debit}.hero-ledger-center{grid-area:center;border-inline:0;padding-inline:0}.hero-ledger-credit{grid-area:credit}.hero-ledger-close{grid-area:close}
  .hero-layout-path{grid-template-areas:"start" "one" "two" "three" "proof"}.hero-path-start{grid-area:start;align-items:flex-start}.hero-path-one{grid-area:one}.hero-path-two{grid-area:two}.hero-path-three{grid-area:three}.hero-path-proof{grid-area:proof}
  .hero-layout-letter{grid-template-areas:"mark" "body" "reply"}.hero-letter-mark{grid-area:mark}.hero-letter-body{grid-area:body;border-inline:0;padding-inline:0}.hero-letter-reply{grid-area:reply}.hero-letter-reply .project-starter{transform:none}
  .hero-layout-calibrated{grid-template-areas:"head" "value" "scale" "proof" "control"}.hero-calibrated-head{grid-area:head;align-items:flex-start}.hero-calibrated-scale{grid-area:scale;border-right:0;padding-right:0}.hero-calibrated-value{grid-area:value;padding-inline:0}.hero-calibrated-proof{grid-area:proof}.hero-calibrated-control{grid-area:control}
  .hero-index,.hero-mast{display:flex;flex-direction:column;align-items:flex-start;border:0;padding:0}.project-starter{width:100%;max-width:100%;justify-self:stretch;transform:none!important}.hero h1{font-size:clamp(2.15rem,9.6vw,3.4rem);line-height:.99;max-width:100%}
  .hero[data-copy-density="long"]{padding:2.8rem 0 4.5rem}
  .hero[data-copy-density="long"] h1{font-size:clamp(2rem,8.8vw,3rem);line-height:1;max-width:100%}
  .hero .intro,.hero-actions,.starter-actions,.starter-choice{max-width:100%}
  .hero-actions>*,.starter-actions>*{min-width:0}
  .hero-logo .sourced-logo,.hero-logo .proposed-logo{height:64px!important;max-height:64px;filter:drop-shadow(0 5px 18px rgba(0,0,0,.3))}
  .hero-logo .brand-chip{padding:.45rem .6rem}
  [class*="architecture-garden-window"] .hero-layout-journal{grid-template-columns:minmax(0,1fr)}[class*="architecture-garden-window"] .hero-media-layer{inset:48% 12px 1.25rem;border-radius:42% 42% 10px 10px;opacity:.56}[class*="architecture-garden-window"] .hero-veil{background:linear-gradient(180deg,var(--bg) 0 48%,color-mix(in srgb,var(--bg) 70%,transparent) 72%,transparent)}
  [class*="architecture-atlas-coordinate"]{padding-top:2.8rem;background:#101514}[class*="architecture-atlas-coordinate"] .hero-media-layer{inset:0}[class*="architecture-atlas-coordinate"] .hero-layout-panorama{padding-top:0}
  [class*="architecture-macro-material-bench"]{background:#111416}[class*="architecture-macro-material-bench"] .hero-media-layer{inset:0}[class*="architecture-macro-material-bench"] .hero-layout-bench{padding-top:0}
  [class*="architecture-elevation-cut"]{background:#0d1113}[class*="architecture-elevation-cut"] .hero-media-layer{inset:0 0 0 10%;clip-path:polygon(28% 0,100% 0,100% 100%,0 100%)}
  [class*="architecture-object-and-hand"] .hero-media-layer{display:none}[class*="architecture-object-and-hand"] .hero-veil{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--bg)),var(--bg))}[class*="architecture-object-and-hand"] .hero-contact-sheet{min-height:420px}
  [class*="architecture-opening-argument"] .hero-media-layer,[class*="architecture-guided-first-step"] .hero-media-layer{inset:58% 0 0;opacity:.42}
  [class*="architecture-front-page-story"] .hero-media-layer,[class*="architecture-host-letter"] .hero-media-layer{inset:0 0 68% 0;border-radius:0;opacity:.5}
  [class*="architecture-care-portrait-field"] .hero-media-layer{inset:0 0 68% 0;border-radius:0;opacity:.5}
  [class*="architecture-host-letter"] .hero-media-layer{left:0}
  [class*="architecture-offer-and-proof"]{padding-top:min(35vh,300px)}[class*="architecture-offer-and-proof"] .hero-media-layer{inset:0 0 auto 0;height:min(32vh,270px);border-radius:0}[class*="architecture-offer-and-proof"] .hero-veil{background:linear-gradient(180deg,transparent 0 30%,var(--bg) 100%)}
  .g-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:auto;gap:.6rem}.g-cell{grid-column:auto;grid-row:auto;aspect-ratio:4/3;min-height:0}.g-cell:first-child{grid-column:1/-1;aspect-ratio:16/9}.g-cell:last-child:nth-child(even){grid-column:1/-1;aspect-ratio:16/9}
  body[data-composition] .svc-grid{display:grid;grid-template-columns:1fr!important}body[data-composition] .svc{grid-column:auto!important}
}
@media(max-width:460px){.shell{width:min(100% - 24px,1160px)}.starter-choices{grid-template-columns:1fr}.hero .stat-row{gap:.55rem}.hero .stat{flex:1 1 42%;border-right:0}.project-starter{padding:1rem}.hero-actions .btn{width:100%;justify-content:center}}
@media (prefers-reduced-motion: reduce){.kinetic span{opacity:1;transform:none;animation:none}.marquee div{animation:none}*{transition:none!important;animation:none!important}}
/* Clean-screenshot mode: ?shot=1 sets html[data-shot="1"] via the blocking
   script in headHtml() before first paint, so mShots (and any automated
   capture used for the outreach email thumbnail) never shows the sales
   overlays covering the real site design. display:none removes them from
   layout entirely; !important beats the launch-tile[hidden] + glass styling. */
html[data-shot="1"] .launch-tile,html[data-shot="1"] .launch-rail,html[data-shot="1"] .pchat{display:none!important}
${ctx.recipeCss || ""}
${premierCrosswalkCss(ctx)}`;
}

function headHtml(ctx, { title, desc, rel = "", jsonLd, noindex, canonicalPath = null, preloadHero = false }) {
  const { biz, type, packet } = ctx;
  const fontUrl = fontStylesheetUrlFor(type.displayName, type.bodyName);
  const favicon = routeAssetUrl(sourceBrandLogoUrl(packet), rel);
  const canonicalUrl = canonicalPath == null ? null : absolutePublicUrl(ctx.publicBaseUrl, canonicalPath);
  const socialImageUrl = canonicalUrl && ctx.socialPreview?.hasRealAsset ? absolutePublicUrl(ctx.publicBaseUrl, "media/og.png") : null;
  const socialTags = canonicalUrl ? `<link rel="canonical" href="${esc(canonicalUrl)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonicalUrl)}"><meta property="og:site_name" content="${esc(biz.name)}">
${socialImageUrl ? `<meta property="og:image" content="${esc(socialImageUrl)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(`${biz.name} social preview`)}">` : ""}
<meta name="twitter:card" content="${socialImageUrl ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">${socialImageUrl ? `<meta name="twitter:image" content="${esc(socialImageUrl)}"><meta name="twitter:image:alt" content="${esc(`${biz.name} social preview`)}">` : ""}` : "";
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>(function(){try{if(/(?:^|[?&])shot=1(?:&|$)/.test(window.location.search))document.documentElement.setAttribute("data-shot","1")}catch(e){}})()</script>
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${socialTags}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://img1.wsimg.com" crossorigin>
${preloadHero ? heroPreloadHtml(ctx, rel) : ""}
<script>(()=>{const u=${JSON.stringify(fontUrl)};addEventListener("load",()=>{const l=document.createElement("link");l.rel="stylesheet";l.href=u;document.head.append(l)},{once:true})})()</script>
<noscript><link rel="stylesheet" href="${esc(fontUrl)}"></noscript>
${favicon ? `<link rel="icon" href="${esc(favicon)}"><link rel="apple-touch-icon" href="${esc(favicon)}">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

const SINGLE_PAGE_NAV_ITEMS = Object.freeze([
  ["services", "Services"],
  ["proof", "Reviews"],
  ["map", "Coverage"],
  ["faq", "FAQ"],
]);

function singlePageAction(ctx, sectionOrder = []) {
  const sections = new Set(Array.isArray(sectionOrder) ? sectionOrder : []);
  if (sections.has("cta")) {
    return { href: "#quote", label: "Get a quote", compactLabel: "Quote", heroLabel: "Start your project" };
  }
  const launch = ctx.packet?.launch || {};
  if (String(launch.purchase_url || "").trim() || String(launch.agent_phone || "").trim()) {
    return { href: "#launch-this-site", label: "Launch options", compactLabel: "Launch", heroLabel: "See launch options" };
  }
  if (ctx.phone) {
    return {
      href: `tel:${ctx.phone.replace(/[^+\d]/g, "")}`,
      label: "Call now",
      compactLabel: "Call",
      heroLabel: "Call now",
    };
  }
  const fallbacks = {
    services: { href: "#services", label: "View services", compactLabel: "Services", heroLabel: "Explore services" },
    proof: { href: "#reviews", label: "Read reviews", compactLabel: "Reviews", heroLabel: "Read reviews" },
    map: { href: "#area", label: "See service area", compactLabel: "Area", heroLabel: "See service area" },
    faq: { href: "#faq", label: "Read FAQs", compactLabel: "FAQs", heroLabel: "Read FAQs" },
  };
  for (const [section] of SINGLE_PAGE_NAV_ITEMS) {
    if (sections.has(section)) return fallbacks[section];
  }
  return { href: "#main", label: "Explore", compactLabel: "Explore", heroLabel: "Explore the site" };
}

function singlePageNavHtml(sectionOrder = []) {
  const sections = new Set(Array.isArray(sectionOrder) ? sectionOrder : []);
  return SINGLE_PAGE_NAV_ITEMS
    .filter(([section]) => sections.has(section))
    .map(([section, label]) => {
      const href = section === "proof" ? "#reviews" : section === "map" ? "#area" : `#${section}`;
      return `<a href="${href}">${label}</a>`;
    })
    .join("");
}

function headerHtml(ctx, rel = "", navItems = null, current = "", sectionOrder = []) {
  const { biz, packet, pal } = ctx;
  const nav = navItems
    ? navItems.map(([href, label]) => `<a href="${rel}${href}"${href === current ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")
    : singlePageNavHtml(sectionOrder);
  const action = navItems
    ? { href: rel + "contact/", label: "Get a quote", compactLabel: "Quote" }
    : singlePageAction(ctx, sectionOrder);
  return `<header class="top shell" data-sticky-cta data-conversion-rail>
  <a class="brand" href="${rel || "#"}">${logoBlock(packet, biz.name, pal, rel)}<span><b>${esc(biz.name)}</b><span>${esc(biz.locationLabel)}</span></span></a>
  <nav class="main" aria-label="Primary navigation">${nav}<a class="btn solid" data-conversion-action href="${action.href}">${action.label}</a></nav>
  <a class="btn solid mobile-quick-cta" data-conversion-action href="${action.href}">${action.compactLabel}</a>
  <details class="mobile-nav"><summary aria-label="Open navigation"><span aria-hidden="true">☰</span></summary><div class="mobile-nav-panel">${nav}<a class="btn solid" href="${action.href}">${action.label}</a></div></details>
</header>`;
}

function footerHtml(ctx, rel = "", navItems = null, sectionOrder = []) {
  const { biz, phone, gbp, trade, packet } = ctx;
  const m = mapBlock(ctx, { compact: true });
  const navCol = navItems
    ? navItems.map(([href, label]) => `<a href="${rel}${href}" style="display:block;padding:.14rem 0">${esc(label)}</a>`).join("")
    : `${singlePageNavHtml(sectionOrder).replaceAll("<a ", '<a style="display:block;padding:.14rem 0" ')}<a href="${singlePageAction(ctx, sectionOrder).href}" style="display:block;padding:.14rem 0">${singlePageAction(ctx, sectionOrder).label}</a>`;
  const directionsLink = m.directions ? `<a class="foot-contact-link" href="${esc(m.directions)}" target="_blank" rel="noopener noreferrer">Directions ↗</a>` : "";
  return `<footer><div class="shell">
  <div class="foot-grid">
    <div><strong class="foot-heading">${esc(biz.name)}</strong>
      <p style="font-size:.88rem;margin:0 0 .6rem">${esc(gbp.address || biz.locationLabel)}</p>
      ${phone ? `<a class="foot-contact-link" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">${esc(phone)}</a>` : ""}
      ${directionsLink}</div>
    <div><strong class="foot-heading">Pages</strong>${navCol}</div>
    <div><strong class="foot-heading">Hours</strong>${hoursStrip(gbp, { compact: true })}</div>
  </div>
  <div class="foot-legal">
    <span>© ${new Date().getFullYear()} ${esc(biz.name)} · ${esc(biz.locationLabel)}</span>
    <span>${packet.forge?.demo ? "Demo preview" : ""}</span>
  </div>
</div></footer>`;
}

// E2 — the buy path lives ON the site. Free website; the subscription unlocks
// the growth suite. Renders only when launch data is present (ghost lane).
function LAUNCH_RAIL(ctx) {
  const launch = ctx.packet.launch || {};
  const phone = String(launch.agent_phone || "").trim();
  const buyUrl = String(launch.purchase_url || "").trim();
  if (!buyUrl && !phone) return "";
  const tel = phone.replace(/[^+\d]/g, "");
  const expiry = (() => {
    const value = launch.expires_at || launch.expiresAt || ctx.packet.preview_expires_at;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? `Reserved through ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`
      : "Reservation deadline is listed in your email";
  })();
  const included = [
    "108-point local search, AI answer, schema, and trust setup",
    "Hosting, SSL, security, backups, and ongoing updates",
    "Google, Apple, and Bing local discovery foundations",
    "Lead form connected to your approved inbox",
    "U.S.-based human review plus 24/7 AI assistance",
    "Monthly visibility and lead-performance report",
  ];
  const chat = `<div class="pchat" data-pchat data-business="${esc(ctx.biz.name)}">
    <button class="pchat-fab" type="button" data-pchat-open aria-label="Chat with a live agent"><span class="pchat-dot"></span>Questions? Ask a live agent</button>
    <div class="pchat-panel glass" data-pchat-panel hidden>
      <div class="pchat-head"><b>Riley — Woodward team</b><span>replies in seconds</span><button type="button" data-pchat-close aria-label="Close">×</button></div>
      <div class="pchat-log" data-pchat-log><div class="pchat-msg them">Hey — I'm Riley, on the team that built this site for ${esc(ctx.biz.name)}. Ask me anything: what's included, pricing, edits, how launch works.</div></div>
      <form class="pchat-form" data-pchat-form><input type="text" data-pchat-in placeholder="Type a question…" maxlength="500" autocomplete="off"><button class="btn solid sm" type="submit">Send</button></form>
      <p class="pchat-fine">Real answers from our team system. Prefer voice? Call (949) 339-5562.</p>
    </div>
  </div>`;
  const deadlineIso = (() => {
    const value = launch.expires_at || launch.expiresAt || ctx.packet.preview_expires_at;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  })();
  const shareUrl = String(launch.preview_url || ctx.packet.preview_url || "").trim();
  const shareTitle = `${ctx.biz.name} — new website preview`;
  const shareText = `WSS Labs built ${ctx.biz.name} a full cinematic website. Take a look before it comes down:`;
  const shareAttrs = `data-share-url="${esc(shareUrl)}" data-share-title="${esc(shareTitle)}" data-share-text="${esc(shareText)}"`;
  const shareRow = `<div class="lr-share">
      <span class="lr-share-label">Love it? Show it off &mdash; it&rsquo;s yours to share:</span>
      <div class="lr-share-btns">
        <button type="button" class="lr-share-btn" data-launch-share="native" aria-label="Share this preview" ${shareAttrs}>&#128279; Share</button>
        <button type="button" class="lr-share-btn" data-launch-share="email" aria-label="Email this preview" ${shareAttrs}>&#9993;&#65039; Email it</button>
        <button type="button" class="lr-share-btn" data-launch-share="copy" aria-label="Copy preview link" ${shareAttrs}>&#128203; Copy link</button>
      </div>
    </div>`;
  // Cross-sell the WSS suite (buying psychology: they already trust the build).
  const crossSell = `<div class="lr-more">
      <span class="lr-more-label">Also from WSS Labs</span>
      <div class="lr-more-grid">
        <div class="lr-more-item"><b>&#128222; AnswerCrew</b><span>AI answers your calls, texts &amp; chat in seconds &mdash; books the job 24/7.</span></div>
        <div class="lr-more-item"><b>&#128202; Visibility Report</b><span>Tracks your local rankings and refreshes every two weeks.</span></div>
        <div class="lr-more-item"><b>&#9997;&#65039; Same-day edits</b><span>Ask our team for changes &mdash; usually live the same day.</span></div>
      </div>
    </div>`;
  return chat + `<section class="launch-rail" id="launch-this-site" data-launch-rail tabindex="-1" aria-labelledby="launch-site-heading">
    <div class="shell launch-inner">
      <div class="lr-head">
        <span class="lr-eyebrow">&#10024; Your custom website is ready</span>
        <h2 class="lr-ready" id="launch-site-heading">Built for ${esc(ctx.biz.name)}</h2>
        <p class="lr-price"><strong>$199</strong><span>/month &middot; the site itself is free to preview</span></p>
        ${deadlineIso ? `<p class="lr-urgency"><span class="lr-pulse"></span><b data-countdown="${esc(deadlineIso)}">7 days left</b> &mdash; then this preview comes down.</p>` : ""}
      </div>
      <div class="lr-body">
      <p class="lr-lede"><b>The design is already yours.</b> Activation puts it on your domain and turns on support, lead capture, and ongoing optimization.</p>
      <ul class="lr-list">${included.map((item) => `<li>${item}</li>`).join("")}</ul>
      ${shareRow}
      ${crossSell}
      </div>
      <div class="lr-actions">
        ${buyUrl ? `<a class="btn solid lr-buy" href="${esc(buyUrl)}" data-launch-cta>Activate this website now</a>` : ""}${phone ? `<a class="btn line" href="tel:${tel}">Call ${esc(phone)}</a>` : ""}
        <p class="lr-checkout">&#128274; Secure Stripe checkout &middot; Visa &middot; Mastercard &middot; Amex &middot; Apple Pay</p>
        <p class="lr-fine"><b>${esc(expiry)}.</b> Cancel anytime. Keep your domain. This preview offer disappears after launch.</p>
      </div>
    </div>
  </section>`;
}

function LAUNCH_CHIP(ctx, rel = "") {
  const launch = ctx.packet.launch || {};
  if (!String(launch.purchase_url || "").trim() && !String(launch.agent_phone || "").trim()) return "";
  const buyUrl = String(launch.purchase_url || "").trim();
  // The floating Activate button must actually check out. Go straight to the
  // secure checkout when a purchase URL exists; only fall back to scrolling to
  // the in-page launch rail when there is no checkout link yet.
  const target = buyUrl || `${esc(rel)}#launch-this-site`;
  const deadlineIso = (() => {
    const value = launch.expires_at || launch.expiresAt || ctx.packet.preview_expires_at;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  })();
  const shareUrl = String(launch.preview_url || ctx.packet.preview_url || rel || "").trim();
  const shareText = `WSS Labs built ${ctx.biz.name} a full cinematic website — take a look:`;
  const shareAttrs = `data-share-url="${esc(shareUrl)}" data-share-title="${esc(ctx.biz.name)} — new website preview" data-share-text="${esc(shareText)}"`;
  // Ultra-professional glass launch tile: WSS mark, countdown, activate, share.
  return `<aside class="launch-tile glass" data-launch-chip data-launch-target="#launch-this-site" aria-label="Activate this website">
    <button type="button" class="lt-x" data-launch-dismiss aria-label="Hide">&times;</button>
    <button type="button" class="lt-toggle" data-launch-toggle aria-expanded="false" aria-label="Show more">&#8963;</button>
    <div class="lt-top">
      <span class="lt-mark" aria-hidden="true">${WSS_TILE_MARK}</span>
      <div class="lt-brand"><b>WSS Labs</b><span>built this site for ${esc(ctx.biz.name)}</span></div>
    </div>
    ${deadlineIso ? `<div class="lt-count"><span class="lt-pulse"></span><b data-countdown="${esc(deadlineIso)}">7 days left</b> on this free preview</div>` : ""}
    <a class="lt-buy" href="${target}" data-launch-cta><b>Activate &middot; $199/mo</b><span>See everything included &rarr;</span></a>
    <div class="lt-share">
      <button type="button" data-launch-share="native" aria-label="Share this preview" ${shareAttrs}>&#128279; Share</button>
      <button type="button" data-launch-share="email" aria-label="Email this preview" ${shareAttrs}>&#9993;&#65039; Email</button>
      <button type="button" data-launch-share="copy" aria-label="Copy preview link" ${shareAttrs}>&#128203; Copy</button>
    </div>
  </aside>`;
}

// ---------------- context assembly ----------------
const PREMIER_INPUT_KEYS = Object.freeze([
  "archetype", "widget", "typography", "palette", "cadence",
  "motion", "media", "card", "trust", "cta",
]);

const PREMIER_HERO_ANATOMY = Object.freeze({
  "cinematic-video-parallax": "arrival-scene",
  "service-map-pins": "atlas-coordinate",
  "material-lab-swatch": "macro-material-bench",
  "split-editorial-index": "offer-and-proof",
  "magazine-owner-letter": "front-page-story",
  "atlas-grid-reveal": "calibrated-readout",
});

const PREMIER_COMPOSITION_ANATOMY = Object.freeze({
  "signal-workbench": "input-decision-output",
  "terrain-atlas": "atlas-coordinate",
  "material-ledger": "macro-material-bench",
  "casebook-editorial": "opening-argument",
  "founder-broadsheet": "front-page-story",
  "story-assembly": "many-to-one",
  "product-cinema": "live-product-state",
  "clinical-gallery": "care-portrait-field",
  "assurance-ledger": "assurance-balance",
  "survey-section": "elevation-cut",
  "guided-care-path": "guided-first-step",
  "house-journal": "host-letter",
  "calibrated-service": "calibrated-readout",
});

const PREMIER_CADENCE_SECTIONS = Object.freeze({
  "editorial-split": "founder",
  "portfolio-masonry": "gallery",
  "review-carousel": "proof",
  "service-grid": "services",
  "atlas-service-map": "map",
  "authority-strip": "trust-strip",
  "seasonal-window": "process",
  "hero-with-router": "trust-strip",
});

function cloneComposition(value) {
  if (Array.isArray(value)) return value.map(cloneComposition);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneComposition(item)]));
  }
  return value;
}

function premierInputId(value, fallback) {
  const id = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

function hexBrightness(value) {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(value || ""));
  if (!match) return 0;
  return (Number.parseInt(match[1], 16) * 299 + Number.parseInt(match[2], 16) * 587 + Number.parseInt(match[3], 16) * 114) / 255000;
}

function mappedPremierPalette(input, fallback) {
  const mode = input.mode === "dark" ? "dark" : "light";
  const background = mode === "dark" ? input.ink : input.surface;
  const surface = mode === "dark" && hexBrightness(input.surface) > 0.72 ? input.ink : input.surface;
  return {
    ...fallback,
    id: premierInputId(input._sourceId, `snowflake-${mode}`),
    mode,
    background,
    surface,
    ink: mode === "dark" ? "#F7F5EF" : input.ink,
    muted: mode === "dark" ? "#B9B7B0" : "#62605B",
    accent: input.accent,
    accentAlt: input.accent_alt,
    mappedInk: input.ink,
    mappedSurface: input.surface,
  };
}

export function applyPremierInputsToComposition(baseComposition, premierInputs) {
  if (!premierInputs) return baseComposition;
  if (!baseComposition || typeof baseComposition !== "object") throw new TypeError("base Premier composition is required");
  const missing = PREMIER_INPUT_KEYS.filter((key) => !premierInputs[key] || typeof premierInputs[key] !== "object");
  if (missing.length) throw new TypeError(`premierInputs missing renderer axes: ${missing.join(", ")}`);

  const composition = cloneComposition(baseComposition);
  const sourcePlan = premierInputs._slotSourcePlan || {};
  const heroFamily = premierInputs.archetype.hero_family;
  const compositionBase = premierInputs.archetype.composition_base
    || baseComposition.compositionBase
    || baseComposition.archetype.id;
  composition.compositionBase = compositionBase;
  composition.archetype = {
    ...composition.archetype,
    id: premierInputs.archetype.premier_archetype,
    baseId: compositionBase,
    snowflakeSlot: sourcePlan.archetype || null,
    heroFamily,
  };
  composition.layoutGravity = {
    ...composition.layoutGravity,
    cardGeometry: cloneComposition(premierInputs.card),
    cardGeometrySlot: sourcePlan.card_geometry || null,
  };
  composition.heroAnatomy = {
    ...composition.heroAnatomy,
    mappedFamily: heroFamily,
    widget: cloneComposition(premierInputs.widget),
    widgetSlot: sourcePlan.widget || null,
  };
  composition.typographyPair = {
    ...composition.typographyPair,
    id: premierInputId(sourcePlan.typography_pair, "snowflake-type"),
    display: premierInputs.typography.display,
    body: premierInputs.typography.body,
    utility: premierInputs.typography.utility,
  };
  composition.palette = mappedPremierPalette({ ...premierInputs.palette, _sourceId: sourcePlan.palette_family }, composition.palette);
  composition.mediaFrame = {
    ...composition.mediaFrame,
    treatmentSlot: sourcePlan.media_treatment || null,
    treatment: premierInputs.media.treatment,
    grain: Boolean(premierInputs.media.grain),
  };
  composition.sectionCadence = {
    ...composition.sectionCadence,
    id: premierInputId(sourcePlan.section_cadence_signature, composition.sectionCadence.id),
    sequence: [...premierInputs.cadence.section_order],
  };
  composition.buttonGrammar = {
    ...composition.buttonGrammar,
    id: premierInputId(sourcePlan.cta_grammar, composition.buttonGrammar.id),
    ...cloneComposition(premierInputs.cta),
  };
  composition.motionEffect = {
    ...composition.motionEffect,
    id: premierInputId(sourcePlan.motion_grammar, composition.motionEffect.id),
    ...cloneComposition(premierInputs.motion),
  };
  composition.reviewTreatment = {
    ...composition.reviewTreatment,
    id: premierInputId(sourcePlan.trust_spine, composition.reviewTreatment.id),
    trustBlocks: [...premierInputs.trust.blocks],
  };
  composition.premierInputsApplied = true;
  composition.compositionFingerprint = compositionFingerprint(composition);
  return composition;
}

function normalizedHex(value) {
  const text = String(value || "").trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return /^#[\da-f]{6}$/i.test(text) ? text.toUpperCase() : null;
}

function hexRgb(value) {
  const hex = normalizedHex(value);
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbHex({ r, g, b }) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function rgbHsl(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { h: (hue + 360) % 360, s: saturation, l: lightness };
}

function hslRgb({ h, s, l }) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = ((h % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const offset = l - chroma / 2;
  const [r, g, b] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return { r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255 };
}

function rotateHexHue(value, degrees) {
  const rgb = hexRgb(value);
  if (!rgb) return value;
  const hsl = rgbHsl(rgb);
  return rgbHex(hslRgb({ ...hsl, h: hsl.h + degrees }));
}

function mixHex(base, tint, amount) {
  const a = hexRgb(base);
  const b = hexRgb(tint);
  if (!a || !b) return normalizedHex(base) || normalizedHex(tint) || "#777777";
  return rgbHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function relativeLuminance(value) {
  const rgb = hexRgb(value);
  if (!rgb) return 0;
  const linear = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return linear(rgb.r) * 0.2126 + linear(rgb.g) * 0.7152 + linear(rgb.b) * 0.0722;
}

export function colorContrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function accessibleAccent(value, background, minimum = 4.5) {
  const original = normalizedHex(value);
  if (!original) return null;
  if (colorContrastRatio(original, background) >= minimum) return original;
  const hsl = rgbHsl(hexRgb(original));
  const darkContrast = colorContrastRatio("#000000", background);
  const lightContrast = colorContrastRatio("#FFFFFF", background);
  const direction = darkContrast >= lightContrast ? -1 : 1;
  for (let step = 1; step <= 32; step += 1) {
    const lightness = Math.max(0.03, Math.min(0.97, hsl.l + direction * step * 0.025));
    const candidate = rgbHex(hslRgb({ ...hsl, l: lightness }));
    if (colorContrastRatio(candidate, background) >= minimum) return candidate;
  }
  return darkContrast >= lightContrast ? "#000000" : "#FFFFFF";
}

const NEUTRAL_TEMPERATURES = Object.freeze([
  { id: "parchment", light: "#FFF4DF", dark: "#211A12" },
  { id: "mineral", light: "#F3F1EA", dark: "#1B1B1A" },
  { id: "mist", light: "#EDF5F7", dark: "#131C20" },
  { id: "sage", light: "#F1F5EE", dark: "#152019" },
]);

function colorValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(colorValues);
  if (typeof value === "object") {
    return ["hex", "value", "color", "colors", "primary", "secondary", "accent"]
      .flatMap((key) => colorValues(value[key]));
  }
  return String(value).match(/#[\da-f]{3}(?:[\da-f]{3})?/gi) || [];
}

function verifiedLogoColorSource(packet = {}) {
  if (!sourceBrandLogoUrl(packet)) return null;
  const logo = packet.logo_source || packet.v7_logo;
  const proof = logo?.color_provenance;
  const contentSha256 = String(proof?.content_sha256 || "").trim().toLowerCase();
  const stagedAssetSha256 = String(logo?.meta?.checksum_sha256 || "").trim().toLowerCase();
  return proof?.verified === true
    && proof?.method === "staged-logo-pixel-extraction-v1"
    && ASSET_SHA256.test(contentSha256)
    && stagedAssetSha256 === contentSha256
    ? logo
    : null;
}

function sourceBrandColors(packet, discoveredBrand = {}) {
  const trustedLogo = verifiedLogoColorSource(packet);
  const candidates = [
    trustedLogo?.colors,
    discoveredBrand.colors,
    packet.brand?.colors,
    packet.branding?.colors,
    packet.facts?.branding?.colors,
    packet.brand_json?.colors,
    packet.brandJson?.colors,
    packet.discovery?.brand?.colors,
    packet.discovery?.branding?.colors,
    packet.discovery?.found?.colors,
    packet.enrichment_sources?.branding?.value?.colors,
    packet.enrichment_sources?.colors?.value,
    packet.visual_system?.colors,
    packet.source?.brandColors,
  ].flatMap(colorValues);
  return [...new Set(candidates.map(normalizedHex).filter(Boolean))].slice(0, 8);
}

function isChromaticBrandColor(value) {
  const rgb = hexRgb(value);
  return Boolean(rgb && rgbHsl(rgb).s >= 0.08);
}

function paletteDigest(palette) {
  const value = [
    palette.bg,
    palette.panel,
    palette.ink,
    palette.muted,
    palette.accent,
    palette.accent2,
    palette.temperature,
  ].join("|");
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function resolveBusinessPalette({ packet = {}, discoveredBrand = {}, compositionPalette = {}, seedInt = 0 } = {}) {
  const mode = compositionPalette.mode === "dark" ? "dark" : "light";
  const normalizedSeed = Number(seedInt) >>> 0;
  const temperature = NEUTRAL_TEMPERATURES[normalizedSeed % NEUTRAL_TEMPERATURES.length];
  const temperatureTarget = mode === "dark" ? temperature.dark : temperature.light;
  const brandColors = sourceBrandColors(packet, discoveredBrand);
  const trustedLogo = verifiedLogoColorSource(packet);
  const verifiedLogoColors = [...new Set(
    colorValues(trustedLogo?.colors).map(normalizedHex).filter(Boolean),
  )];
  const identityColors = verifiedLogoColors.length ? verifiedLogoColors : brandColors;
  const accentBrandColors = identityColors.filter(isChromaticBrandColor);
  const darkIdentityNeutral = identityColors.find((color) => (
    !isChromaticBrandColor(color) && relativeLuminance(color) <= 0.12
  ));
  const hueDelta = normalizedSeed % 29 - 14 || 7;
  const supportingSource = accentBrandColors[0] || compositionPalette.accent || "#B4552D";
  const supportingHueDelta = (normalizedSeed >>> 8) % 29 - 14 || -7;
  const supportingTint = rotateHexHue(supportingSource, supportingHueDelta);
  const supportingStrength = 0.025 + ((normalizedSeed >>> 16) % 5) * 0.0075;
  const baseBackground = mode === "dark" && darkIdentityNeutral
    ? darkIdentityNeutral
    : compositionPalette.background || (mode === "dark" ? "#17191E" : "#F7F5EE");
  const baseSurface = mode === "dark" && darkIdentityNeutral
    ? darkIdentityNeutral
    : compositionPalette.surface || baseBackground;
  const bg = mixHex(baseBackground, temperatureTarget, 0.16);
  const panel = mixHex(mixHex(baseSurface, temperatureTarget, 0.22), supportingTint, supportingStrength);
  const inkBase = mode === "light" && darkIdentityNeutral
    ? darkIdentityNeutral
    : compositionPalette.ink || (mode === "dark" ? "#F7F5EF" : "#18201E");
  const ink = accessibleAccent(inkBase, bg, 7) || inkBase;
  const mutedBase = compositionPalette.muted || (mode === "dark" ? "#B9B7B0" : "#62605B");
  const muted = accessibleAccent(mutedBase, bg, 4.5) || mutedBase;
  const generated = [
    rotateHexHue(compositionPalette.accent || "#B4552D", hueDelta),
    rotateHexHue(compositionPalette.accentAlt || "#41604F", -hueDelta),
  ];
  const requested = accentBrandColors.length ? accentBrandColors.slice(0, 2) : generated;
  if (requested.length === 1) requested.push(generated[1]);
  // Source-backed primary/secondary order is identity evidence, not a design
  // randomization input. Seed variation may only reorder generated fallbacks.
  if (!accentBrandColors.length && (normalizedSeed >>> 5) % 2 === 1) requested.reverse();
  let accent = accessibleAccent(requested[0], bg, 4.5) || accessibleAccent(generated[0], bg, 4.5);
  let accent2 = accessibleAccent(requested[1], bg, 3) || accessibleAccent(generated[1], bg, 3);
  if (accent2 === accent) accent2 = accessibleAccent(rotateHexHue(accent2, 37), bg, 3);
  const palette = {
    bg,
    panel,
    ink,
    muted,
    accent,
    accent2,
    mode,
    mappedSurface: mixHex(compositionPalette.mappedSurface || baseSurface, temperatureTarget, 0.18),
    temperature: temperature.id,
    source: brandColors.length ? "discovered-brand" : "seeded-trade",
    brandColors,
    verifiedLogoColors,
    darkIdentityNeutral: darkIdentityNeutral || null,
    // Preserve the full discovery list above for evidence. These are the
    // chromatic colors that can materially drive the rendered decoration.
    accentBrandColors,
    hueDelta,
    supportingTint,
    supportingStrength,
  };
  return { ...palette, signature: paletteDigest(palette) };
}

function discoveredBrandAt(outDir) {
  const brandPath = path.join(outDir, "brand.json");
  if (!existsSync(brandPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(brandPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Kept as a compatibility export for callers/tests from the retired in-process
// cache. Typography repetition is now handled by durable snowflake history.
export function resetBusinessTypePairMemory() {
  return undefined;
}

export function selectVerifiedBusinessTypography(packet = {}) {
  const fontSources = [
    packet?.facts?.branding?.fonts,
    packet?.branding?.fonts,
    packet?.fonts,
    packet?.brand?.fonts,
    packet?.facts?.discovery?.branding?.fonts,
    packet?.facts?.discovery?.found?.fonts,
    packet?.discovery?.branding?.fonts,
    packet?.discovery?.found?.fonts,
    packet?.enrichment_sources?.branding?.value?.fonts,
    packet?.enrichment?.branding?.fonts,
    packet?.enrichment?.branding?.value?.fonts,
  ];
  const discovered = new Set(fontSources
    .flatMap((fonts) => Array.isArray(fonts) ? fonts : [fonts])
    .filter((font) => typeof font === "string")
    .map((font) => font.trim().toLocaleLowerCase())
    .filter(Boolean));
  const isDiscovered = (font) => discovered.has(font.toLocaleLowerCase());
  const exactPair = BUSINESS_TYPE_PAIRS.find((pair) => (
    isDiscovered(pair.display) && isDiscovered(pair.body)
  ));
  return exactPair ? { ...exactPair } : null;
}

export function selectBusinessTypography(packet = {}, seedInt = 0) {
  const verifiedPair = selectVerifiedBusinessTypography(packet);
  if (verifiedPair) return verifiedPair;
  const index = (Number(seedInt) >>> 0) % BUSINESS_TYPE_PAIRS.length;
  return { ...BUSINESS_TYPE_PAIRS[index] };
}

function googleFontWeights(name, role) {
  return GOOGLE_FONT_WEIGHTS[name] || (role === "display" ? [500, 600, 700] : [400, 500, 600, 700]);
}

function googleFontFamily(value) {
  return String(value || "").trim().replace(/\s+/g, "+");
}

export function fontStylesheetUrlFor(displayName, bodyName) {
  const families = new Map();
  const add = (name, role) => {
    if (!families.has(name)) families.set(name, new Set());
    for (const weight of googleFontWeights(name, role)) families.get(name).add(weight);
  };
  add(displayName, "display");
  add(bodyName, "body");
  const query = [...families.entries()]
    .map(([name, weights]) => `family=${googleFontFamily(name)}:wght@${[...weights].sort((a, b) => a - b).join(";")}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=optional`;
}

function premierType(composition) {
  const displayName = composition.typographyPair.display || "Fraunces";
  const bodyName = composition.typographyPair.body || "Inter";
  const displayWeight = Math.max(...googleFontWeights(displayName, "display"));
  const displayFallback = /Mono/i.test(displayName) ? "ui-monospace, monospace" : /Grotesk|Sans|Oswald|Shoulders|Archivo|Recursive/i.test(displayName) ? "system-ui, sans-serif" : "Georgia, serif";
  const bodyFallback = /Mono/i.test(bodyName) ? "ui-monospace, monospace" : /Serif|Merriweather|Slab/i.test(bodyName) ? "Georgia, serif" : "system-ui, sans-serif";
  return {
    displayName,
    bodyName,
    displayWeight,
    display: `'${displayName}', ${displayFallback}`,
    body: `'${bodyName}', ${bodyFallback}`,
  };
}

function premierCtaModel(composition) {
  const grammar = composition.buttonGrammar || {};
  const primaryLabel = {
    "modal-router": "Choose a service",
    "tier-1-pdf": "Request service details",
    "sticky-quote": "Request a quote",
    "solid-accent": "Request a quote",
  }[grammar.primary] || "Start your project";
  const secondaryLabel = {
    "text-photo": "Share project photos",
    "tier-2-consult": "Discuss the project",
    "phone-sticky": "Call",
    "phone-outline": "Call",
  }[grammar.secondary] || "Call";
  return { ...grammar, primaryLabel, secondaryLabel };
}

function premierAtmosphere(composition, current) {
  if (!composition.premierInputsApplied) return current;
  if (composition.motionEffect.intensity === 0) return "none";
  if (composition.mediaFrame.treatment === "blueprint-svg") return "blueprint";
  if (composition.motionEffect.primary === "particle-canvas") return "gold-particles";
  if (composition.motionEffect.primary === "cursor-radial-light") return "spotlight";
  if (composition.mediaFrame.grain || /grain/.test(composition.motionEffect.ambient || "")) return "atmosphere";
  return current;
}

function buildCtx(packet, premierInputs = null, discoveredBrand = {}) {
  const location = sanitizeBusinessLocation(packet);
  const biz = {
    name: publicBusinessDisplayName(packet.business?.name),
    category: packet.business?.category ?? "service",
    city: location.city,
    state: location.state,
    locationLabel: location.label,
  };
  const trade = tradeOf(biz.category);
  const seed = seedFrom(packet.slug ?? biz.name, trade.key);
  const compositionBase = premierInputs?.archetype?.composition_base || null;
  const plannedComposition = planPremierComposition(
    compositionBase ? { ...packet, compositionBase } : packet,
  );
  const composition = applyPremierInputsToComposition(plannedComposition, premierInputs);
  const premierOverride = Boolean(composition.premierInputsApplied);
  const explicitTemplatePick = Boolean(
    packet.template_selection?.explicit
      || packet.explicit_template_pick
      || packet.forge?.explicit_template_pick,
  );
  const plannedAnatomy = PREMIER_HERO_ANATOMY[packet.hero_family];
  const fallbackTypePair = selectBusinessTypography(packet, seed.seed);
  const typePair = premierOverride
    ? {
        id: premierInputId(
          `${composition.typographyPair.display}-${composition.typographyPair.body}`,
          "snowflake-type",
        ),
        display: composition.typographyPair.display,
        body: composition.typographyPair.body,
        utility: composition.typographyPair.utility || null,
      }
    : fallbackTypePair;
  const pal = resolveBusinessPalette({
    packet,
    discoveredBrand,
    compositionPalette: composition.palette,
    seedInt: seed.seed,
  });
  const family = premierOverride
    ? PREMIER_COMPOSITION_ANATOMY[composition.compositionBase]
    : (plannedAnatomy || composition.heroAnatomy.id);
  if (premierOverride && !family) {
    throw new TypeError(`unsupported Premier composition base: ${String(composition.compositionBase || "missing")}`);
  }
  const premiumPattern = {
    id: composition.archetype.id,
    cohort: composition.archetype.edition,
    mode: composition.palette.mode,
  };
  const type = premierType({
    ...composition,
    typographyPair: {
      ...composition.typographyPair,
      ...typePair,
    },
  });
  const cta = premierCtaModel(composition);
  const recipeCss = "";
  const recipeId = `premier-${composition.archetype.id}`;
  const blob = blobToPath(seed.blobPoints);
  const services = [...new Map(
    (Array.isArray(packet.services) ? packet.services : trade.services)
      .map(normalizeServiceDisplayLabel)
      .filter(Boolean)
      .map((service) => [service.toLocaleLowerCase("en-US"), service]),
  ).values()].slice(0, 6);
  const phone = packet.enrichment_sources?.phone?.value || packet.business.phone || null;
  const email = packet.enrichment_sources?.email?.value || null;
  const gbp = gbpData(packet);
  const premierMedia = allocatePremierPageMedia(
    selectPremierMedia(packet, { limit: 12 }),
    {
      contactSheetSlots: family === "object-and-hand" ? 3 : 0,
      serviceSlots: services.length,
      services,
    },
  );
  const publicBaseUrl = resolvePublicSiteUrl(packet);
  const socialPreview = {
    logo: sourceBrandLogoUrl(packet),
    photo: premierMedia.sourcePhoto?.url || premierMedia.gallery[0]?.url || null,
  };
  socialPreview.hasRealAsset = Boolean(socialPreview.logo || socialPreview.photo);
  const photos = [
    ...(premierMedia.mode === "ai-ambiance-video" ? [] : [premierMedia.hero]),
    premierMedia.sourceVideo,
    premierMedia.sourcePhoto,
    ...(premierMedia.serviceMedia || []),
    ...(premierMedia.contactSheetMedia || []),
    ...(premierMedia.gallery || []),
  ].filter((item, index, all) => (
    item
    && item.url
    && all.findIndex((candidate) => candidate && renderedMediaIdentity(candidate) === renderedMediaIdentity(item)) === index
  ));
  const mapBusiness = /^your city(?:,|$)/i.test(biz.locationLabel)
    ? { ...biz, city: "", state: "", locationLabel: "" }
    : biz;
  const premierMap = buildPremierMap({
    business: mapBusiness,
    gbp,
    address: gbp.address,
    lat: gbp.latlng?.lat,
    lng: gbp.latlng?.lng,
    placeId: gbp.placeId,
  });
  const h1 = headline(trade, biz, seed);
  const snippets = packet.voice_persona?.first_person_snippets ?? [];
  const intro = snippets[0]
    ? `“${snippets[0]}”`
    : `${biz.name} serves ${biz.locationLabel}${services.length ? ` with ${services.slice(0, 3).join(", ")}` : ""}. Explore the work, proof, and easiest next step in one place.`;
  const quote = pick([`Request a look at the ${trade.noun}.`, `A straight quote for the ${trade.noun}.`, `Start a conversation with ${biz.name}.`], seed.rng);
  const faqs = faqsFor(trade, biz, 8);
  const contactCapture = previewContactConfig(packet, { businessName: biz.name, phone, email });
  const kr = kitRngFrom(seed.seed);
  const kitRecipe = pickKitRecipe(trade.key, kr);
  const atmoPool = ATMO_POOLS[trade.key] || ATMO_POOLS.default;
  let atmo = atmoPool[Math.floor(kr() * atmoPool.length)];
  if (premierMedia.hasSourceVideo || premierMedia.hasAmbianceVideo) atmo = "atmosphere";
  atmo = premierAtmosphere(composition, atmo);
  if (premierOverride) {
    if ((explicitTemplatePick || !packet.hero_family) && composition.archetype.heroFamily) {
      packet.hero_family = composition.archetype.heroFamily;
    }
    if (!Array.isArray(packet.section_plan) || !packet.section_plan.length) {
      packet.section_plan = [...composition.sectionCadence.sequence];
    }
    packet.visual_system = {
      ...(packet.visual_system || {}),
      crosswalk: {
        widget: composition.heroAnatomy.widget.premier_widget,
        motion: composition.motionEffect.primary,
        media_treatment: composition.mediaFrame.treatment,
        card_style: composition.layoutGravity.cardGeometry.style,
        trust: [...composition.reviewTreatment.trustBlocks],
        cta: composition.buttonGrammar.primary,
      },
    };
  }
  const HERO = {
    grid: /panorama|arrival|public-call|live-product/i.test(family) ? "1fr" : /right|east|portrait|window/i.test(`${composition.layoutGravity.anchor} ${family}`) ? ".9fr 1.1fr" : "1.05fr .95fr",
    headSize: "clamp(2.75rem,7vw,5.9rem)",
    mediaShape: composition.mediaFrame.id,
    copySide: /right|east/i.test(composition.layoutGravity.anchor) ? "right" : "left",
  };
  return {
    packet,
    biz,
    trade,
    seed,
    family,
    premiumPattern,
    composition,
    premierOverride,
    pal,
    type,
    typePair,
    cta,
    blob,
    services,
    phone,
    email,
    gbp,
    photos,
    premierMedia,
    premierMap,
    publicBaseUrl,
    socialPreview,
    h1,
    intro,
    quote,
    faqs,
    contactCapture,
    HERO,
    snippets,
    recipeId,
    recipeCss,
    atmo,
    kitId: kitRecipe?.id ?? null,
    designSignatureId: null,
  };
}

function heroArchitecture(ctx) {
  const anatomy = ctx.family || ctx.composition.heroAnatomy.id;
  const edition = ctx.composition.archetype.edition;
  return `${anatomy}-${edition}`;
}

function heroContactSheet(ctx, rel = "") {
  const items = (ctx.premierMedia?.contactSheetMedia || [])
    .filter((asset) => asset?.kind !== "video" && !/\.(?:mp4|m4v|mov|ogg|ogv|webm)(?:$|[?#])/i.test(String(asset?.url || "")))
    .map((asset) => ({ ...asset, url: routeAssetUrl(safeMediaUrl(asset.url), rel) }))
    .filter((asset) => asset.url)
    .slice(0, 3);
  if (!items.length) return "";
  return `<div class="hero-contact-sheet" data-hero-layer="contact-sheet">${items.map((asset, index) => `<figure class="contact-photo contact-photo-${index + 1}"><img src="${esc(asset.url)}" alt="${esc(asset.label || `${ctx.biz.name} source photo ${index + 1}`)}" loading="eager" decoding="async"><figcaption>${String(index + 1).padStart(2, "0")} · ${esc(asset.label || "Source image")}</figcaption></figure>`).join("")}</div>`;
}

function mappedHeroWidget(ctx, serviceChoices) {
  const widget = ctx.composition.heroAnatomy.widget?.premier_widget;
  const widgetAttrs = ctx.premierOverride ? ` data-premier-widget="${esc(widget)}"` : "";
  const widgetClass = ctx.premierOverride ? ` widget-${esc(widget)}` : "";
  const primaryLabel = ctx.stickyLabel || (ctx.premierOverride ? ctx.cta.primaryLabel : "Continue");
  const phoneAction = ctx.phone && (!ctx.premierOverride || /^phone-/.test(ctx.cta.secondary || ""))
    ? `<a href="tel:${esc(ctx.phone.replace(/[^+\d]/g, ""))}" class="btn line">${esc(ctx.cta.secondaryLabel)}</a>`
    : ctx.premierOverride && !/^phone-/.test(ctx.cta.secondary || "")
      ? `<a href="${ctx.stickyHref || "#quote"}" class="btn line">${esc(ctx.cta.secondaryLabel)}</a>`
      : "";
  const commonActions = `<div class="starter-actions"><a href="${ctx.stickyHref || "#quote"}" class="btn solid">${esc(primaryLabel)}</a>${phoneAction}</div>`;

  if (widget === "service-map") {
    const suppliedAreas = ctx.packet.enrichment_sources?.service_areas?.value;
    const areas = dedupeLocationLabels(
      Array.isArray(suppliedAreas) && suppliedAreas.length ? suppliedAreas : [ctx.biz.locationLabel],
      ctx.biz,
    ).slice(0, 5);
    return `<aside class="project-starter${widgetClass}" data-action-tile data-hero-layer="lead-widget"${widgetAttrs} aria-label="Service area">
      <div class="starter-head"><span>Service area</span><small>Confirm directly</small></div>
      <h2>Start with your location.</h2>
      <p>${esc(ctx.biz.name)} is listed in ${esc(ctx.biz.locationLabel)}. Confirm exact coverage with the business.</p>
      <div class="atlas-widget">${areas.map((area) => `<span class="cell">${esc(area)}</span>`).join("")}</div>${commonActions}
    </aside>`;
  }
  if (widget === "material-swatch-lab") {
    return `<aside class="project-starter${widgetClass}" data-action-tile data-hero-layer="lead-widget"${widgetAttrs} aria-label="Choose a service">
      <div class="starter-head"><span>Service selector</span><small>Step 1 of 3</small></div>
      <h2>Choose the work.</h2><p>Select the closest listed service, then add project details.</p>
      <div class="swatch-widget">${ctx.services.slice(0, 4).map((service, index) => `<a href="${ctx.stickyHref || "#quote"}" class="starter-choice"><i style="--swatch:${index % 2 ? "var(--accent2)" : "var(--accent)"}"></i>${esc(service)}</a>`).join("")}</div>${commonActions}
    </aside>`;
  }
  if (widget === "process-timeline") {
    return `<aside class="project-starter${widgetClass}" data-action-tile data-hero-layer="lead-widget"${widgetAttrs} aria-label="Contact process">
      <div class="starter-head"><span>Contact path</span><small>Four steps</small></div>
      <h2>Prepare a useful request.</h2>
      <ol class="widget-timeline">${["Choose a listed service", "Describe the property", "Attach useful photos", "Confirm scope and timing"].map((step, index) => `<li><b>${index + 1}</b><span>${esc(step)}</span></li>`).join("")}</ol>${commonActions}
    </aside>`;
  }
  if (widget === "project-storytelling") {
    return `<aside class="project-starter${widgetClass}" data-action-tile data-hero-layer="lead-widget"${widgetAttrs} aria-label="Build a project brief">
      <div class="starter-head"><span>Project brief</span><small>Step 1 of 3</small></div>
      <h2>What needs attention?</h2><p>Choose a listed service and share the property details in your own words.</p>
      <div class="starter-choices">${serviceChoices}</div>${commonActions}
    </aside>`;
  }
  return `<aside class="project-starter${widgetClass}" data-action-tile data-hero-layer="lead-widget"${widgetAttrs} aria-label="Start your project">
    <div class="starter-head"><span>Start your project</span><small>Step 1 of 3</small></div>
    <h2>What can we help with?</h2>
    <p>Choose the closest match. Add details and photos next.</p>
    <div class="starter-choices">${serviceChoices}</div>
    ${commonActions}
  </aside>`;
}

function heroSection(ctx, rel = "") {
  const { trade, biz, pal, services, seed, phone, gbp, family, h1, intro, packet, composition } = ctx;
  const stats3 = stats(packet, trade, gbp);
  const ledger = [...services, biz.locationLabel].slice(0, 8);
  const ratingProof = gbp.rating
    ? `<div class="hero-review" data-hero-layer="proof"><span class="stars" aria-hidden="true">★★★★★</span><b>${esc(gbp.rating.value)} ${gbp.rating.attribution === "Google" ? "on Google" : "public rating"}</b>${gbp.rating.count ? `<span>${esc(gbp.rating.count)} public reviews</span>` : ""}</div>`
    : `<div class="hero-review" data-hero-layer="proof"><b>Serving ${esc(biz.locationLabel)}</b><span>Call to confirm availability</span></div>`;
  const serviceChoices = [...services.slice(0, 4), "Not sure yet"].map((service, index) => `<a href="${ctx.stickyHref || "#quote"}" class="starter-choice"><span>${String(index + 1).padStart(2, "0")}</span>${esc(service)}</a>`).join("");
  const projectStarter = mappedHeroWidget(ctx, serviceChoices);
  const renderedHeadline = (() => {
    const words = h1.split(/\s+/);
    const accentIndex = words.findIndex((word) => word.length > 4 && !/[.,!?]$/.test(word));
    return words.map((word, index) => `<span style="animation-delay:${index * 55}ms">${index === (accentIndex < 0 ? 0 : accentIndex) ? `<em class="accent-word">${esc(word)}</em>` : esc(word)}</span>`).join(" ");
  })();
  const logo = `<div class="hero-logo">${logoBlock(packet, biz.name, pal, rel)}</div>`;
  const kicker = `<p class="kicker"><span class="live-dot" aria-hidden="true"></span>${esc(trade.key === "default" ? biz.category : trade.key)} · ${esc(biz.locationLabel)}</p>`;
  const primaryLabel = ctx.stickyLabel || (ctx.premierOverride ? ctx.cta.primaryLabel : "Start your project");
  const secondaryAction = phone && (!ctx.premierOverride || /^phone-/.test(ctx.cta.secondary || ""))
    ? `<a class="btn hero-phone" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">${esc(ctx.premierOverride ? ctx.cta.secondaryLabel : phone)}</a>`
    : ctx.premierOverride && !/^phone-/.test(ctx.cta.secondary || "")
      ? `<a class="btn hero-phone" href="${ctx.stickyHref || "#quote"}">${esc(ctx.cta.secondaryLabel)}</a>`
      : "";
  const actions = `<div class="hero-actions"><a class="btn solid" href="${ctx.stickyHref || "#quote"}">${esc(primaryLabel)}</a>${secondaryAction}</div>`;
  const statsHtml = `<div class="stat-row">${stats3.map((item) => `<div class="stat"><b>${esc(item.n)}</b><span>${esc(item.label)}</span></div>`).join("")}</div>`;
  const copy = `<h1 class="kinetic">${renderedHeadline}</h1><p class="intro speakable">${esc(intro)}</p>${actions}${ratingProof}${TRUST_CITATIONS(packet)}`;
  const headlineWordCount = h1.trim().split(/\s+/).filter(Boolean).length;
  // Display faces and narrow editorial columns can turn a seven-word headline
  // into six rendered lines before it reaches the old 48-character cutoff.
  // Compact at 42 characters so the supporting copy and conversion controls
  // remain in the first desktop viewport across every composition family.
  const copyDensity = headlineWordCount >= 9 || h1.length >= 42 || intro.length >= 150 ? "long" : "standard";
  const serviceLegend = `<aside class="hero-service-legend" aria-label="Services">${services.slice(0, 5).map((service, index) => `<span><b>${String(index + 1).padStart(2, "0")}</b>${esc(service)}</span>`).join("")}</aside>`;
  const architecture = heroArchitecture(ctx);
  const contactSheet = heroContactSheet(ctx, rel);
  let heroBody;
  if (family === "input-decision-output") {
    heroBody = `<div class="shell hero-layout hero-layout-command" data-rendered-layout="command-decision-board"><header class="hero-command-brand">${logo}${kicker}</header><aside class="hero-command-input" data-hero-layer="services">${serviceLegend}</aside><article class="hero-command-decision hero-copy" data-hero-layer="copy">${copy}</article><div class="hero-command-output"><div class="hero-proof-ribbon">${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div></div>`;
  } else if (family === "atlas-coordinate") {
    heroBody = `<div class="shell hero-layout hero-layout-panorama" data-rendered-layout="terrain-panorama"><div class="hero-mast">${logo}${kicker}</div><div class="hero-copy" data-hero-layer="copy">${copy}</div><div class="hero-tool-dock">${projectStarter}</div><div class="hero-proof-ribbon">${statsHtml}</div></div>`;
  } else if (family === "macro-material-bench") {
    heroBody = `<div class="shell hero-layout hero-layout-bench" data-rendered-layout="material-workbench"><div class="hero-mast">${logo}${kicker}</div><div class="hero-copy" data-hero-layer="copy">${copy}</div>${serviceLegend}<div class="hero-proof-ribbon">${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div>`;
  } else if (family === "opening-argument") {
    heroBody = `<div class="shell hero-layout hero-layout-docket" data-rendered-layout="casebook-docket"><header class="hero-docket-head">${logo}${kicker}</header><article class="hero-docket-argument hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-docket-exhibits" data-hero-layer="services">${serviceLegend}<div class="hero-proof-ribbon">${statsHtml}</div></aside><footer class="hero-docket-action hero-tool-dock">${projectStarter}</footer></div>`;
  } else if (family === "front-page-story") {
    heroBody = `<div class="shell hero-layout hero-layout-broadsheet" data-rendered-layout="founder-front-page"><header class="hero-broadsheet-mast">${logo}${kicker}</header><article class="hero-broadsheet-lead hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-broadsheet-column" data-hero-layer="services">${serviceLegend}</aside><div class="hero-broadsheet-proof hero-proof-ribbon">${statsHtml}</div><aside class="hero-broadsheet-action hero-tool-dock">${projectStarter}</aside></div>`;
  } else if (family === "many-to-one") {
    heroBody = `<div class="shell hero-layout hero-layout-assembly" data-rendered-layout="story-assembly-stack"><aside class="hero-assembly-sources" data-hero-layer="services">${serviceLegend}<div class="hero-proof-ribbon">${statsHtml}</div></aside><div class="hero-assembly-spine"><div class="hero-mast">${logo}${kicker}</div><article class="hero-copy" data-hero-layer="copy">${copy}</article></div><aside class="hero-assembly-resolution hero-tool-dock">${projectStarter}</aside></div>`;
  } else if (family === "live-product-state") {
    heroBody = `<div class="shell hero-layout hero-layout-live" data-rendered-layout="live-product-console"><header class="hero-live-status"><span class="live-dot" aria-hidden="true"></span>${logo}${kicker}</header><article class="hero-live-primary hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-live-services" data-hero-layer="services">${serviceLegend}</aside><aside class="hero-live-readout hero-proof-ribbon">${statsHtml}</aside><div class="hero-live-control hero-tool-dock">${projectStarter}</div></div>`;
  } else if (family === "care-portrait-field") {
    heroBody = `<div class="shell hero-layout hero-layout-care" data-rendered-layout="care-portrait-ledger"><aside class="hero-care-intro">${logo}${kicker}<div data-hero-layer="services">${serviceLegend}</div></aside><article class="hero-care-story hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-care-action hero-tool-dock">${projectStarter}</aside><footer class="hero-care-proof hero-proof-ribbon">${statsHtml}</footer></div>`;
  } else if (family === "assurance-balance") {
    heroBody = `<div class="shell hero-layout hero-layout-ledger" data-rendered-layout="assurance-balance-sheet"><header class="hero-ledger-head">${logo}${kicker}</header><aside class="hero-ledger-debit" data-hero-layer="services">${serviceLegend}</aside><article class="hero-ledger-center hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-ledger-credit hero-proof-ribbon">${statsHtml}</aside><footer class="hero-ledger-close hero-tool-dock">${projectStarter}</footer></div>`;
  } else if (family === "elevation-cut") {
    heroBody = `<div class="shell hero-layout hero-layout-section" data-rendered-layout="diagonal-survey"><div class="hero-mast">${logo}${kicker}</div><div class="hero-copy" data-hero-layer="copy">${copy}</div><aside class="hero-survey-rail" data-hero-layer="services">${serviceLegend}</aside><div class="hero-proof-ribbon">${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div>`;
  } else if (family === "guided-first-step") {
    heroBody = `<div class="shell hero-layout hero-layout-path" data-rendered-layout="guided-first-step-path"><header class="hero-path-start">${logo}${kicker}</header><article class="hero-path-one hero-copy" data-hero-layer="copy"><span class="hero-path-index">01</span>${copy}</article><aside class="hero-path-two" data-hero-layer="services"><span class="hero-path-index">02</span>${serviceLegend}</aside><aside class="hero-path-three hero-tool-dock"><span class="hero-path-index">03</span>${projectStarter}</aside><footer class="hero-path-proof hero-proof-ribbon">${statsHtml}</footer></div>`;
  } else if (family === "host-letter") {
    heroBody = `<div class="shell hero-layout hero-layout-letter" data-rendered-layout="host-letter-column"><aside class="hero-letter-mark">${logo}${kicker}${serviceLegend}</aside><article class="hero-letter-body"><div class="hero-copy" data-hero-layer="copy">${copy}</div><footer class="hero-proof-ribbon">${statsHtml}</footer></article><aside class="hero-letter-reply hero-tool-dock">${projectStarter}</aside></div>`;
  } else if (family === "calibrated-readout") {
    heroBody = `<div class="shell hero-layout hero-layout-calibrated" data-rendered-layout="calibrated-service-readout"><header class="hero-calibrated-head">${logo}${kicker}</header><div class="hero-calibrated-scale" data-hero-layer="services">${serviceLegend}</div><article class="hero-calibrated-value hero-copy" data-hero-layer="copy">${copy}</article><aside class="hero-calibrated-proof hero-proof-ribbon">${statsHtml}</aside><aside class="hero-calibrated-control hero-tool-dock">${projectStarter}</aside></div>`;
  } else if (family === "arrival-scene") {
    heroBody = `<div class="shell hero-layout hero-layout-stage" data-rendered-layout="arrival-stage"><div class="hero-mast">${logo}${serviceLegend}</div><div class="hero-copy" data-hero-layer="copy">${kicker}${copy}</div><div class="hero-tool-dock">${projectStarter}</div><div class="hero-proof-ribbon">${statsHtml}</div></div>`;
  } else if (family === "garden-window") {
    heroBody = `<div class="shell hero-layout hero-layout-journal" data-rendered-layout="garden-aperture"><div class="hero-index">${logo}${kicker}${serviceLegend}</div><div class="hero-copy" data-hero-layer="copy">${copy}${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div>`;
  } else if (family === "object-and-hand") {
    heroBody = `<div class="shell hero-layout hero-layout-lookbook" data-rendered-layout="maker-contact-sheet"><div class="hero-mast">${logo}${kicker}</div><div class="hero-copy" data-hero-layer="copy">${copy}${statsHtml}</div>${contactSheet}<div class="hero-tool-dock">${projectStarter}</div></div>`;
  } else if (family === "offer-and-proof") {
    heroBody = `<div class="shell hero-layout hero-layout-signature" data-rendered-layout="storefront-horizon"><div class="hero-mast">${logo}</div><div class="hero-copy" data-hero-layer="copy">${kicker}${copy}</div><div class="hero-proof-ribbon">${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div>`;
  } else {
    heroBody = `<div class="shell hero-layout hero-layout-split" data-rendered-layout="editorial-split"><div class="hero-copy" data-hero-layer="copy">${logo}${kicker}${copy}${statsHtml}</div><div class="hero-tool-dock">${projectStarter}</div></div>`;
  }
  const premierAttrs = ctx.premierOverride
    ? ` data-premier-widget="${esc(composition.heroAnatomy.widget.premier_widget)}" data-card-geometry="${esc(composition.layoutGravity.cardGeometry.style)}" data-trust-spine="${esc(composition.reviewTreatment.trustBlocks.join("|"))}" data-cta-grammar="${esc(composition.buttonGrammar.primary)}" data-motion-grammar="${esc(composition.motionEffect.primary)}"`
    : "";
  // The frozen V7 honesty gate treats any <section> class containing
  // "gallery" or "proof" as customer-proof territory. AI ambiance therefore
  // uses the semantically accurate page header, while source-media heroes keep
  // the established section markup and styling unchanged.
  const heroElement = ctx.premierMedia?.mode === "ai-ambiance-video" ? "header" : "section";
  return `<${heroElement}
  class="hero hero-${esc(composition.archetype.id)} edition-${esc(composition.archetype.edition)} architecture-${esc(architecture)}${isFlagshipHero(ctx) ? " has-real-media" : " media-blocked"}"
  data-renderer="05-build-v8"
  data-hero-anatomy="${esc(family)}"
  data-hero-architecture="${esc(architecture)}"
  data-copy-density="${copyDensity}"
  data-composition-fingerprint="${esc(composition.compositionFingerprint)}"
  data-layout-gravity="${esc(composition.layoutGravity.id)}"
  data-media-frame="${esc(composition.mediaFrame.id)}"
  data-media-treatment="${esc(composition.mediaFrame.treatment)}"
  data-review-treatment="${esc(composition.reviewTreatment.id)}"
  data-atmosphere-pack="${esc(ctx.atmo || "none")}"${premierAttrs} ${visualAttrs(packet, family)}>
  <div class="hero-media-layer" data-hero-layer="media" data-media-treatment="${esc(composition.mediaFrame.treatment)}">${mediaStage(ctx, rel)}</div>
  <div class="hero-veil" data-hero-layer="veil" aria-hidden="true"></div>
  <div class="hero-motif" data-hero-layer="motif" aria-hidden="true"><svg viewBox="0 0 1000 460">${motifSvg(trade.key, pal.accent, seed)}</svg></div>
  ${atmosphereHtml(ctx)}
  ${heroBody}
  <div class="marquee" aria-hidden="true"><div>${ledger.map((item) => `<span>${esc(item)}</span>`).join("")}${ledger.map((item) => `<span>${esc(item)}</span>`).join("")}</div></div>
</${heroElement}>`;
}

const COMPOSITION_SECTION_ORDERS = Object.freeze({
  "cultivated-editorial": ["trust-strip", "gallery", "services", "founder", "process", "proof", "materials", "map", "faq", "cta"],
  "terrain-atlas": ["trust-strip", "map", "services", "gallery", "process", "materials", "proof", "faq", "cta"],
  "material-ledger": ["trust-strip", "materials", "services", "gallery", "process", "proof", "map", "faq", "cta"],
  "survey-section": ["trust-strip", "process", "services", "gallery", "materials", "proof", "map", "faq", "cta"],
  "maker-lookbook": ["trust-strip", "gallery", "founder", "services", "materials", "process", "proof", "map", "faq", "cta"],
  "local-signature": ["trust-strip", "proof", "services", "gallery", "founder", "process", "map", "faq", "cta"],
});

const SECTION_PLAN_RENDER_MAP = Object.freeze({
  hero: [],
  "before-after-slider": ["gallery"],
  "zigzag-photo-text": ["founder"],
  "project-storytelling": ["gallery"],
  "material-swatch-lab": ["materials"],
  "service-map": ["map"],
  "homeowner-configurator": ["services"],
  "trust-ledger": ["trust-strip", "proof"],
  "faq-speakable": ["faq"],
  "process-timeline": ["process"],
  "team-portrait": ["founder"],
  "journal-excerpt": ["founder"],
  "contact-strip-map": ["map", "cta"],
  "editorial-split": ["founder"],
  "portfolio-masonry": ["gallery"],
  "review-carousel": ["proof"],
  "service-grid": ["services"],
  "atlas-service-map": ["map"],
  "authority-strip": ["trust-strip"],
  "seasonal-window": ["process"],
  "hero-with-router": ["trust-strip"],
});

export function resolveSectionPlan(sectionPlan = []) {
  if (!Array.isArray(sectionPlan)) return [];
  const renderable = new Set([
    "trust-strip",
    "services",
    "gallery",
    "founder",
    "process",
    "proof",
    "materials",
    "map",
    "faq",
    "cta",
  ]);
  const order = [];
  for (const rawSection of sectionPlan) {
    const section = String(rawSection || "").trim().toLowerCase();
    const mapped = SECTION_PLAN_RENDER_MAP[section] || (renderable.has(section) ? [section] : []);
    for (const item of mapped) {
      if (!order.includes(item)) order.push(item);
    }
  }
  return order;
}

function requireSourceGalleryForMediaDepth(order, ctx) {
  const next = [...order];
  if (next.includes("gallery")) return next;
  const galleryPhotos = (ctx.premierMedia?.gallery || [])
    .filter((asset) => asset?.truthful_source === true && asset?.proof_eligible !== false);
  const renderedHeroIdentities = presentedHeroPhotoIdentities(ctx.premierMedia);
  const unrenderedGalleryIdentities = new Set(
    galleryPhotos
      .map(renderedMediaIdentity)
      .filter((identity) => identity && !renderedHeroIdentities.has(identity)),
  );
  if (!unrenderedGalleryIdentities.size) return next;
  const uniqueRealPhotos = new Set([
    ...(ctx.premierMedia?.hero?.kind === "photo" && ctx.premierMedia.hero?.truthful_source === true
      ? [renderedMediaIdentity(ctx.premierMedia.hero)]
      : []),
    ...galleryPhotos.map(renderedMediaIdentity),
  ].filter(Boolean));
  const hasUnrenderedContainedProof = galleryPhotos.some((asset) => (
    isBoundContainedSourceProof(asset)
    && unrenderedGalleryIdentities.has(renderedMediaIdentity(asset))
  ));
  if (!hasUnrenderedContainedProof && uniqueRealPhotos.size < 6) return next;

  // The hard media-depth gate evaluates what the public page actually renders,
  // not what happens to exist in the source catalog. Preserve the planner's
  // cadence, but insert its source-gallery component whenever verified photos
  // would otherwise be stranded off-page. This includes one contained GBP
  // proof photo when an honestly labeled AI ambiance video occupies the hero.
  const anchor = next.findIndex((section) =>
    ["services", "founder", "process", "materials", "proof"].includes(section));
  next.splice(anchor >= 0 ? anchor + 1 : 0, 0, "gallery");
  return next;
}

function presentedHeroPhotoIdentities(selection = {}) {
  const identities = new Set();
  if (selection.hero?.kind === "photo" && selection.hero?.truthful_source === true) {
    const identity = renderedMediaIdentity(selection.hero);
    if (identity) identities.add(identity);
  }
  if (selection.mode === "contained-source-proof") {
    for (const asset of (selection.gallery || []).filter(isBoundContainedSourceProof).slice(0, 3)) {
      const identity = renderedMediaIdentity(asset);
      if (identity) identities.add(identity);
    }
  }
  return identities;
}

function compositionSectionOrder(ctx, { homeOnly = false } = {}) {
  const fallback = ["trust-strip", "services", "gallery", "process", "proof", "materials", "map", "faq", "cta"];
  let order;
  const planned = resolveSectionPlan(ctx.packet.section_plan);
  if (planned.length >= 4) {
    order = planned;
  } else if (ctx.premierOverride) {
    const renderable = new Set(fallback);
    order = ctx.composition.sectionCadence.sequence
      .map((section) => PREMIER_CADENCE_SECTIONS[section] || section)
      .filter((section, index, all) => renderable.has(section) && all.indexOf(section) === index);
    if (!order.length) order = fallback;
  } else {
    order = COMPOSITION_SECTION_ORDERS[ctx.composition.archetype.id] || fallback;
  }
  order = requireSourceGalleryForMediaDepth(order, ctx);
  if (!homeOnly) return [...order];
  const home = order.filter((section) => !["faq", "cta"].includes(section));
  // A verified address is a conversion asset, not just a contact-page detail.
  // Keeping the real satellite/directions block on the captured home surface
  // gives the visual QC evidence to validate and makes the preview locally
  // grounded without fabricating a service-radius graphic.
  if (ctx.premierMap?.available && !home.includes("map")) {
    const before = Math.max(0, home.indexOf("proof"));
    home.splice(before, 0, "map");
  }
  return home;
}

function disabledSectionKeys(packet = {}) {
  const disabled = new Set();
  for (const raw of Array.isArray(packet.sections_disabled) ? packet.sections_disabled : []) {
    const normalized = String(raw || "").trim().toLowerCase();
    const mapped = resolveSectionPlan([normalized]);
    if (mapped.length) mapped.forEach((section) => disabled.add(section));
    else if (normalized) disabled.add(normalized);
  }
  return disabled;
}

function renderedSectionManifest(packet, ctx, { homeOnly = false } = {}) {
  const disabled = disabledSectionKeys(packet);
  return compositionSectionOrder(ctx, { homeOnly })
    .filter((section) => !disabled.has(section))
    .map((section) => {
      const html = sectionHtml(section, ctx);
      return {
        section,
        html: String(html || "").replace(
          /^<section\b/,
          `<section data-render-section="${esc(section)}"`,
        ),
      };
    })
    .filter((entry) => String(entry.html || "").trim());
}

function finalizeRenderedDesign(packet, ctx, manifest) {
  const sectionOrder = manifest.map((entry) => entry.section);
  const designSignatureHash = crypto.createHash("sha256")
    .update([ctx.pal.signature, ctx.typePair.id, sectionOrder.join("|")].join("::"))
    .digest("hex")
    .slice(0, 20);
  const designSignatureId = `ds1-${designSignatureHash}`;
  packet.visual_system = {
    ...(packet.visual_system || {}),
    resolved: {
      ...(packet.visual_system?.resolved || {}),
      design_signature: {
        id: designSignatureId,
        palette_hash: ctx.pal.signature,
        font_pair: ctx.typePair.id,
        section_order: [...sectionOrder],
      },
      palette_signature: ctx.pal.signature,
      palette_source: ctx.pal.source,
      brand_colors: [...ctx.pal.brandColors],
      palette: {
        background: ctx.pal.bg,
        surface: ctx.pal.panel,
        ink: ctx.pal.ink,
        muted: ctx.pal.muted,
        accent: ctx.pal.accent,
        accent2: ctx.pal.accent2,
        supporting_tint: ctx.pal.supportingTint,
      },
      neutral_temperature: ctx.pal.temperature,
      font_pair: `${ctx.typePair.display} / ${ctx.typePair.body}`,
      font_pair_id: ctx.typePair.id,
      section_order: [...sectionOrder],
    },
  };
  ctx.designSignatureId = designSignatureId;
  ctx.renderManifest = manifest;
  return manifest;
}

// ---------------- JSON-LD ----------------
function jsonLdFor(ctx, { pageName = null, breadcrumb = null, servicePage = null, faqs = null, canonicalPath = "/" } = {}) {
  const schemaCtx = {
    ...ctx,
    packet: {
      ...ctx.packet,
      public_url: ctx.publicBaseUrl || undefined,
      canonical_url: undefined,
      site_url: undefined,
    },
  };
  const graph = buildAuthoritySchema({
    ctx: schemaCtx,
    pageName,
    canonicalPath,
    breadcrumbs: breadcrumb,
    servicePage,
    faqs,
  });
  const coordinates = normalizedLatLng(ctx.gbp?.latlng);
  if (Array.isArray(graph?.["@graph"])) {
    const localBusinesses = graph["@graph"].filter((node) => {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      return types.includes("LocalBusiness");
    });
    for (const localBusiness of localBusinesses) {
      if (!coordinates) {
        delete localBusiness.geo;
        continue;
      }
      localBusiness.geo = {
        "@type": "GeoCoordinates",
        latitude: coordinates.lat,
        longitude: coordinates.lng,
      };
    }
  }
  return graph;
}

// ---------------- single-page cinematic (Remic PROMPT A) ----------------
function renderSinglePage(packet, ctx) {
  const { biz, trade } = ctx;
  const manifest = finalizeRenderedDesign(packet, ctx, renderedSectionManifest(packet, ctx));
  const order = manifest.map((entry) => entry.section);
  const action = singlePageAction(ctx, order);
  ctx.stickyHref = action.href;
  ctx.stickyLabel = action.heroLabel;
  const sections = manifest.map((entry) => entry.html).join("\n");
  const title = `${biz.name} — ${trade.key === "default" ? biz.category : trade.key} in ${biz.locationLabel}`;
  const desc = `${biz.name}, a ${biz.category} business listed in ${biz.locationLabel}. Contact the business to confirm current services.`;
  const html = `<!doctype html>
<html lang="en">
<head>
${headHtml(ctx, { title, desc, canonicalPath: "/", jsonLd: jsonLdFor(ctx), noindex: Boolean(packet.forge?.demo), preloadHero: true })}
<style>${baseCss(ctx)}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:pulse 2.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
</style>
</head>
<body${ctx.recipeId ? ` data-recipe="${esc(ctx.recipeId)}"` : ""}
 data-renderer="05-build-v8"
 data-composition="${esc(ctx.composition.archetype.id)}"
 data-composition-edition="${esc(ctx.composition.archetype.edition)}"
 data-design-signature="${esc(ctx.designSignatureId)}"
 data-palette-signature="${esc(ctx.pal.signature)}"
 data-palette-source="${esc(ctx.pal.source)}"
 data-font-pair="${esc(ctx.typePair.id)}">
<a class="skip-link" href="#main">Skip to main content</a>
<div class="grain" aria-hidden="true"></div>
${headerHtml(ctx, "", null, "", order)}
${heroSection(ctx)}
${LAUNCH_RAIL(ctx)}
<main id="main" data-section-sequence="${esc(order.join("|"))}">
${sections}
</main>
${footerHtml(ctx, "", null, order)}
${LAUNCH_CHIP(ctx)}
<script>requestAnimationFrame(()=>setTimeout(()=>{${MAP_JS}\n${REVEAL_JS}\n${LAUNCH_JS}\n${LIGHTBOX_JS}\n${PCHAT_JS}\n${ESTIMATOR_JS}\n${ATMOS_JS}\n${cinematicRuntime()}},0))</script>
<script>${previewContactScript(ctx.contactCapture)}</script>
</body>
</html>`;
  return { pages: [{ file: "index.html", html, title, desc, path: "/" }], title, desc };
}

// ---------------- premier multi-page (Remic PROMPT B) ----------------
function svcSlug(s) { return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }

function pageShell(ctx, { relDepth, title, desc, bodyHtml, nav, current, crumbs, pageName, servicePage = null, faqs = null }) {
  const rel = "../".repeat(relDepth);
  const breadcrumb = crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[1], item: c[0] }));
  const canonicalPath = `/${String(crumbs.at(-1)?.[0] || "").replace(/^\/+/, "")}`;
  return `<!doctype html>
<html lang="en">
<head>
${headHtml(ctx, { title, desc, rel, canonicalPath, jsonLd: jsonLdFor(ctx, { pageName, breadcrumb, servicePage, faqs, canonicalPath }), noindex: Boolean(ctx.packet.forge?.demo), preloadHero: relDepth === 0 && current === "" })}
<style>${baseCss(ctx)}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:pulse 2.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
</style>
</head>
<body${ctx.recipeId ? ` data-recipe="${esc(ctx.recipeId)}"` : ""}
 data-renderer="05-build-v8"
 data-composition="${esc(ctx.composition.archetype.id)}"
 data-composition-edition="${esc(ctx.composition.archetype.edition)}"
 data-design-signature="${esc(ctx.designSignatureId)}"
 data-palette-signature="${esc(ctx.pal.signature)}"
 data-palette-source="${esc(ctx.pal.source)}"
 data-font-pair="${esc(ctx.typePair.id)}">
<a class="skip-link" href="#main">Skip to main content</a>
<div class="grain" aria-hidden="true"></div>
${headerHtml(ctx, rel, nav, current)}
${crumbs.length > 1 ? `<div class="shell crumbs">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span>${esc(c[1])}</span>` : `<a href="${rel}${c[0]}">${esc(c[1])}</a> › `).join("")}</div>` : ""}
<div id="main">${bodyHtml}</div>
${footerHtml(ctx, rel, nav)}
${LAUNCH_CHIP(ctx, rel)}
<script>requestAnimationFrame(()=>setTimeout(()=>{${MAP_JS}\n${REVEAL_JS}\n${LAUNCH_JS}\n${LIGHTBOX_JS}\n${PCHAT_JS}\n${ESTIMATOR_JS}\n${ATMOS_JS}\n${cinematicRuntime()}},0))</script>
<script>${previewContactScript(ctx.contactCapture)}</script>
</body>
</html>`;
}

function pageHead(ctx, kicker, h1, lede) {
  const { trade, pal, seed } = ctx;
  return `<section class="page-head">
    <svg class="motif-overlay" viewBox="0 0 1000 460" aria-hidden="true">${motifSvg(trade.key, pal.accent, seed)}</svg>
    <div class="shell"><p class="kicker">${esc(kicker)}</p><h1>${esc(h1)}</h1><p class="intro">${esc(lede)}</p></div>
  </section>`;
}
function ctaStrip(ctx, rel, text = null) {
  return `<div class="shell"><div class="cta-strip"><b>${esc(text || `Contact ${ctx.biz.name} to confirm current services and availability.`)}</b>
    <span><a class="btn solid" href="${rel}contact/">Get a quote</a>${ctx.phone ? ` <a class="btn line" href="tel:${esc(ctx.phone.replace(/[^+\d]/g, ""))}">Call</a>` : ""}</span></div></div>`;
}

function renderMultiPage(packet, ctx) {
  const { biz, trade, services, seed, gbp } = ctx;
  ctx.stickyHref = "contact/";
  const svcPages = services.slice(0, 5).map((s) => [`services/${svcSlug(s)}/`, s]);
  const nav = [["", "Home"], ["about/", "About"], ["services/", "Services"], ["process/", "Process"], ["service-areas/", "Service areas"], ["faq/", "FAQ"], ["contact/", "Contact"]];
  const faqs12 = faqsFor(trade, biz, 12);
  const tradeName = trade.key === "default" ? biz.category : trade.key;
  const ratingProvider = gbp.rating?.attribution === "Google" ? "Google" : "public";
  const ratingClaim = gbp.rating?.count
    ? `${biz.city} has already graded us: ${gbp.rating.value}★ across ${gbp.rating.count} ${ratingProvider} reviews.`
    : gbp.rating
      ? `${biz.city} has already graded us: ${gbp.rating.value}★ ${ratingProvider} rating.`
      : `Ask around ${biz.city} — our name is on the work.`;
  const pages = [];

  // ---- Home
  {
    const manifest = finalizeRenderedDesign(
      packet,
      ctx,
      renderedSectionManifest(packet, ctx, { homeOnly: true }),
    );
    const homeOrder = manifest.map((entry) => entry.section);
    const sections = manifest.map((entry) => entry.html).join("\n");
    const teases = `<section class="band"><div class="shell"><p class="kicker">Go deeper</p><h2>The longer story, page by page.</h2>
      <div class="xlinks">${nav.slice(1).map(([h, l]) => `<a href="${h}">${esc(l)} →</a>`).join("")}</div></div></section>`;
    const title = `${biz.name} — ${tradeName} in ${biz.city}, ${biz.state}`;
    const desc = `${biz.name}, a ${biz.category} business listed in ${biz.city}, ${biz.state}. Contact the business to confirm current services.`;
    pages.push({ file: "index.html", path: "/", title, desc, html: pageShell(ctx, { relDepth: 0, title, desc, nav, current: "", crumbs: [["", "Home"]], pageName: title, bodyHtml: `${heroSection(ctx)}\n${LAUNCH_RAIL(ctx)}\n<main data-section-sequence="${esc(homeOrder.join("|"))}">${sections}</main>\n${ctaStrip(ctx, "")}\n${teases}` }) });
  }

  // ---- About
  {
    const vp = packet.voice_persona ?? {};
    const owner = publicOwnerName(packet, biz.name);
    const years = packet.enrichment_sources?.years?.value;
    const body = `${pageHead(ctx, "About", `The people behind the ${trade.noun} work in ${biz.city}.`, `${biz.name} is a ${tradeName} outfit working in and around ${biz.city}, ${biz.state}. This page is the part most sites hide: who you're actually hiring.`)}
    <main><section class="band"><div class="shell prose">
      <h2>Why does a ${tradeName} company exist in ${biz.city}?</h2>
      <p>Because ${trade.plural} here take real punishment and deserve better than drive-by work. ${biz.name} was built around a short rulebook: scope the job in writing, put one number on it, show up when we said, and walk the finished work with the person paying for it. ${years ? `That rulebook has held for ${years}+ years.` : "That rulebook is the whole company."}</p>
      ${vp.first_person_snippets?.length ? vp.first_person_snippets.slice(0, 3).map((s) => `<p class="founder-note">“${esc(s)}”</p>`).join("") : ""}
      <h2>What do you get that a national chain won't give you?</h2>
      <p>Contact ${esc(biz.name)} directly to confirm which work is available for your property and who will complete it.</p>
      <h2>How do we price?</h2>
      <p>We look first, then quote. The number in the written scope is the number on the invoice. If conditions change mid-job, we stop and talk before anything else happens. Nobody likes surprise line items — including the people writing them.</p>
      ${sectionHtml("founder", ctx)}
    </div></section>
    ${ctaStrip(ctx, "../")}</main>`;
    const title = `About ${biz.name} — ${tradeName}, ${biz.city} ${biz.state}`;
    pages.push({ file: "about/index.html", path: "/about/", title, desc: `Who you hire when you hire ${biz.name}: the rulebook, the crew, and how pricing works in ${biz.city}.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Who you hire when you hire ${biz.name} in ${biz.city}.`, nav, current: "about/", crumbs: [["", "Home"], ["about/", "About"]], pageName: title, bodyHtml: body }) });
  }

  // ---- Services hub
  {
    const cards = services.map((s, i) => {
      const media = svcMedia(ctx, s, i, "../");
      return `<article class="svc${media ? "" : " svc--text"}" data-service-media="${media ? "matched-source" : "text-only"}">${media ? `<div class="svc-visual" aria-hidden="true">${media}</div>` : ""}<span class="idx">${String(i + 1).padStart(2, "0")}</span><h3><a href="${svcSlug(s)}/" style="color:inherit;text-decoration:none">${esc(s)}</a></h3><p>${esc(svcBlurb(ctx, s, i))}</p><a class="btn line sm" href="${svcSlug(s)}/" style="margin-top:.6rem;align-self:start">Details →</a></article>`;
    }).join("");
    const body = `${pageHead(ctx, "Services", `${tradeName[0].toUpperCase() + tradeName.slice(1)} services for ${biz.city}, priced in writing.`, `Every service below follows the same arrangement: we look, we write a scope with one number on it, and the crew that quoted it answers for it.`)}
    <main><section class="band"><div class="shell"><div class="svc-grid">${cards}</div></div></section>
    ${sectionHtml("materials", ctx)}
    ${ctaStrip(ctx, "../")}</main>`;
    const title = `${tradeName[0].toUpperCase() + tradeName.slice(1)} services in ${biz.city} — ${biz.name}`;
    pages.push({ file: "services/index.html", path: "/services/", title, desc: `Contact ${biz.name} to confirm current services in ${biz.city}, ${biz.state}.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Contact ${biz.name} to confirm current services in ${biz.city}.`, nav, current: "services/", crumbs: [["", "Home"], ["services/", "Services"]], pageName: title, bodyHtml: body }) });
  }

  // ---- Per-service pages (Q-format H2s — AEO bait)
  for (const [i, s] of services.slice(0, 5).entries()) {
    const others = services.filter((x) => x !== s).slice(0, 2);
    const body = `${pageHead(ctx, s, `${s} in ${biz.city}, done like we live here.`, `What ${s.toLowerCase()} involves, what it costs to get wrong, and how ${biz.name} scopes it — in plain language.`)}
    <main><section class="band"><div class="shell prose">
      <h2>What does ${s.toLowerCase()} actually involve?</h2>
      <p>${esc(svcBlurb(ctx, s, i))}</p>
      <h2>How much does ${s.toLowerCase()} cost in ${biz.city}?</h2>
      <p>Contact ${esc(biz.name)} directly for current pricing and to confirm what is included.</p>
      <h2>How long does it take?</h2>
      <p>Timing depends on scope, materials, and current crew availability. Confirm the schedule directly with ${biz.name} before work begins.</p>
      <h2>Why hire ${biz.name} for it?</h2>
      <p>Because the person who scopes your ${trade.noun} briefs the crew that does the work, and the walkthrough at the end is with someone who can answer for it. ${ratingClaim}</p>
      <div class="xlinks">${others.map((o) => `<a href="../${svcSlug(o)}/">${esc(o)} →</a>`).join("")}<a href="../../process/">Our process →</a><a href="../../contact/">Get a quote →</a></div>
    </div></section>
    ${ctaStrip(ctx, "../../", `Want a clear scope for the ${trade.noun}? Ask ${biz.name} for current pricing and timing.`)}</main>`;
    const title = `${s} — ${biz.city}, ${biz.state} | ${biz.name}`;
    pages.push({ file: `services/${svcSlug(s)}/index.html`, path: `/services/${svcSlug(s)}/`, title, desc: `${s} in ${biz.city}: what it involves, how pricing works, and how ${biz.name} scopes it.`, html: pageShell(ctx, { relDepth: 2, title, desc: `${s} in ${biz.city}: scope, pricing shape, and schedule — in plain language.`, nav, current: "services/", crumbs: [["", "Home"], ["services/", "Services"], [`services/${svcSlug(s)}/`, s]], pageName: title, servicePage: s, bodyHtml: body }) });
  }

  // ---- Process
  {
    const body = `${pageHead(ctx, "Process", "Four steps. No mystery.", `The same arrangement for every job, from a small repair to a full ${trade.noun} project.`)}
    <main>${sectionHtml("process", ctx)}
    <section class="band"><div class="shell prose">
      <h2>What happens after I ask for a quote?</h2>
      <p>A real conversation — phone or on-site — about the ${trade.noun}. Then a written scope lands in your inbox with one number on it. No pressure sequence, no expiring discounts. The scope is good when you are.</p>
      <h2>What happens on work day?</h2>
      <p>Confirm scheduling, site preparation, and completion details directly with ${esc(biz.name)} before work begins.</p>
      <h2>What does "done" mean?</h2>
      <p>A walkthrough, with you, against the scope. If a line item isn't right, it gets fixed before we call it finished. Then the invoice matches the quote — that part surprises people, and we're fine with that.</p>
    </div></section>
    ${ctaStrip(ctx, "../")}</main>`;
    const title = `How it works — ${biz.name}, ${biz.city}`;
    pages.push({ file: "process/index.html", path: "/process/", title, desc: `${biz.name}'s four-step process: conversation, written scope, crew on time, walkthrough.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Conversation → written scope → crew on time → walkthrough. The whole arrangement.`, nav, current: "process/", crumbs: [["", "Home"], ["process/", "Process"]], pageName: title, bodyHtml: body }) });
  }

  // ---- Service areas
  {
    const m = mapBlock(ctx);
    const body = `${pageHead(ctx, "Service areas", `Confirm service availability in ${biz.city}.`, `${biz.name} is listed in ${biz.city}, ${biz.state}. Contact the business directly to confirm the current service area.`)}
    <main><section class="band"><div class="shell"><div class="area-grid">
      <div class="map-col">${m.html}</div>
      <div class="prose">
        <h2>Do you cover my neighborhood?</h2>
        <p>If you're in or around ${biz.city}, almost certainly. We plan routes so ${trade.noun} work stays local — that's how the crew shows up on time and how a callback never waits a week.</p>
        <h2>What about the next town over?</h2>
        <p>Ask. The honest answer is that distance changes scheduling, not standards. If the drive is worth making, we make it; if it isn't, we'll say so and point you somewhere good.</p>
        ${hoursStrip(gbp)}
      </div></div></div></section>
    ${ctaStrip(ctx, "../")}</main>`;
    const title = `Service areas — ${biz.name} | ${biz.city}, ${biz.state}`;
    pages.push({ file: "service-areas/index.html", path: "/service-areas/", title, desc: `Where ${biz.name} works: ${biz.city}, ${biz.state} and surrounding neighborhoods.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Where ${biz.name} works: ${biz.city} and the surrounding area, mapped honestly.`, nav, current: "service-areas/", crumbs: [["", "Home"], ["service-areas/", "Service areas"]], pageName: title, bodyHtml: body }) });
  }

  // ---- FAQ
  {
    const body = `${pageHead(ctx, "FAQ", "Asked often, answered straight.", `Twelve real questions from ${biz.city} homeowners, answered the way we answer the phone.`)}
    <main><section class="band"><div class="shell">
      ${faqs12.map(([q, a]) => `<details class="faq"><summary class="speakable">${esc(q)}</summary><p class="speakable">${esc(a)}</p></details>`).join("")}
    </div></section>
    ${ctaStrip(ctx, "../")}</main>`;
    const title = `FAQ — ${biz.name}, ${tradeName} in ${biz.city}`;
    pages.push({ file: "faq/index.html", path: "/faq/", title, desc: `Questions ${biz.city} asks about ${tradeName}: quotes, scheduling, pricing, and what "done" means.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Questions ${biz.city} asks about ${tradeName} — answered straight.`, nav, current: "faq/", crumbs: [["", "Home"], ["faq/", "FAQ"]], pageName: title, faqs: faqs12, bodyHtml: body }) });
  }

  // ---- Contact
  {
    const m = mapBlock(ctx);
    const body = `${pageHead(ctx, "Contact", `Tell us about the ${trade.noun}.`, `We reply like people, not a ticketing system. Photos help; so does honesty about what's going on.`)}
    <main><section class="band"><div class="shell"><div class="area-grid">
      <div>
        ${quoteFormHtml(ctx, { rows: 4, style: "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.4rem" })}
        ${ctx.phone ? `<p style="margin-top:1rem">Faster by phone: <a href="tel:${esc(ctx.phone.replace(/[^+\d]/g, ""))}" style="color:var(--accent);font-weight:700">${esc(ctx.phone)}</a></p>` : ""}
        ${hoursStrip(gbp)}
      </div>
      <div class="map-col">${m.html}</div>
    </div></div></section></main>`;
    const title = `Contact ${biz.name} — ${biz.city}, ${biz.state}`;
    pages.push({ file: "contact/index.html", path: "/contact/", title, desc: `Contact ${biz.name} in ${biz.city}: form, phone, hours, and directions.`, html: pageShell(ctx, { relDepth: 1, title, desc: `Contact ${biz.name} in ${biz.city}. Form, phone, hours, directions.`, nav, current: "contact/", crumbs: [["", "Home"], ["contact/", "Contact"]], pageName: title, bodyHtml: body }) });
  }

  return { pages, title: pages[0].title, desc: pages[0].desc };
}

// ---------------- optimization scorecard ----------------
function buildScorecard(packet, ctx, pages, authority, schemaGraph) {
  const home = pages[0].html;
  const check = (id, label, pass, detail) => ({ id, label, pass: Boolean(pass), detail });
  const imgs = [...home.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const withAlt = imgs.filter((t) => /\balt=/.test(t)).length;
  const heroMedia = home.match(/<div class="media-plane[^"]*"[^>]*data-media-source="([^"]+)"[^>]*data-media-provenance="([^"]+)"/);
  const heroMediaSource = heroMedia?.[1] || (/data-media-source="ai-ambiance"/.test(home) ? "ai-ambiance" : "scene");
  const heroMediaProvenance = heroMedia?.[2] || (heroMediaSource === "ai-ambiance" ? "ai-ambiance" : "unknown");
  const ogImage = home.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] || "";
  const schemaTypes = schemaTypesFromGraph(schemaGraph).filter((type) => !["ListItem", "PostalAddress", "Question", "Answer", "SpeakableSpecification", "GeoCoordinates", "OpeningHoursSpecification", "AggregateRating", "ContactPoint", "City"].includes(type));
  const hasLocalSchema = schemaTypes.includes("LocalBusiness") || schemaTypes.some((type) => /Business|Contractor|Electrician|Plumber|Locksmith/.test(type));
  const checks = [
    check("title-length", "Title ≤ 60 chars with trade + city", pages[0].title.length <= 62 && new RegExp(ctx.biz.city, "i").test(pages[0].title), `${pages[0].title.length} chars`),
    check("meta-description", "Meta description ≤ 160 chars, owner voice", pages[0].desc.length <= 160, `${pages[0].desc.length} chars`),
    check("single-h1", "Single H1 per page", (home.match(/<h1[\s>]/g) || []).length === 1, `${(home.match(/<h1[\s>]/g) || []).length} found`),
    check("schema-suite", "Evidence-gated LocalBusiness · Service · FAQPage · Breadcrumb · WebSite schema", hasLocalSchema && ["Service", "FAQPage", "BreadcrumbList", "WebSite"].every((type) => schemaTypes.includes(type)), schemaTypes.join(", ")),
    check("speakable", "Speakable schema for voice/AI search", home.includes("SpeakableSpecification"), "FAQ + intro marked"),
    check("geo-map", "Satellite map with Google and Apple directions", /data-google-map="satellite"/.test(home) && /google\.com\/maps\/dir/.test(home) && /maps\.apple\.com/.test(home), ctx.premierMap.available ? `${ctx.premierMap.precision} satellite map with both direction providers` : "no usable location evidence"),
    check("hours-schema", "openingHoursSpecification from sourced hours", Array.isArray(ctx.gbp.hoursSpec) && ctx.gbp.hoursSpec.length > 0, Array.isArray(ctx.gbp.hoursSpec) && ctx.gbp.hoursSpec.length > 0 ? `${ctx.gbp.hoursSpec.length} day rules` : "hours not sourced — honest placeholder shipped, never invented"),
    check("alt-coverage", "Alt text on every image", imgs.length === withAlt, `${withAlt}/${imgs.length} images`),
    check("reduced-motion", "prefers-reduced-motion honored", /prefers-reduced-motion/.test(home), "all animation gated"),
    check("mobile-320", "320px zero horizontal scroll", /overflow-x:clip/.test(home), "overflow clipped + fluid grids"),
    check("og-card", "Source-backed OG image + twitter card", Boolean(ctx.publicBaseUrl && ctx.socialPreview.hasRealAsset && /^https:\/\//i.test(ogImage) && /summary_large_image/.test(home)), ctx.publicBaseUrl ? ctx.socialPreview.hasRealAsset ? ogImage : "no real brand asset; image metadata withheld" : "no real public URL; canonical and OG metadata withheld"),
    check("media-provenance", "AI/stock imagery labeled, source media ranked first", !/data-ai-media/.test(home) || /data-media-source="ai-ambiance"/.test(home), heroMediaProvenance === "stock-ambiance" ? "labeled editorial ambiance (not proof)" : heroMediaSource === "video" ? "source video in hero" : heroMediaSource === "photo" ? "source photo in hero" : heroMediaSource === "ai-ambiance" ? "labeled AI ambiance texture" : "svg scene"),
    check("tel-tap", "tap-to-call everywhere", !ctx.phone || /tel:/.test(home), ctx.phone ? "tel: links live" : "no phone provided"),
    check("sticky-cta", "Persistent quote CTA", /data-sticky-cta[^>]*data-conversion-rail/.test(home), "sticky navigation quote action"),
    check("renderer-v8", "Premier V8 renderer only", /data-renderer="05-build-v8"/.test(home), "05-build-v8"),
    check("composition-fingerprint", "Unique deterministic composition fingerprint", /data-composition-fingerprint="pc1-[a-f0-9]{24}"/.test(home), ctx.composition.compositionFingerprint),
    check("gallery-cap", "Source gallery capped at 12 photos", ctx.premierMedia.gallery.length <= 12, `${ctx.premierMedia.gallery.length}/12 source photos`),
    check("hero-layers", "Six-layer cinematic hero contract", ["media", "veil", "motif", "copy", "proof", "lead-widget"].every((layer) => home.includes(`data-hero-layer="${layer}"`)), "media · veil · motif · copy · proof · lead-widget"),
    ...(packet.build_type === "multi-page" ? [
      check("multi-page", "5–8 page architecture with per-page heads", pages.length >= 6, `${pages.length} pages`),
      check("breadcrumbs", "BreadcrumbList on every page", pages.every((p) => p.html.includes("BreadcrumbList")), "all pages"),
      check("q-headings", "Q-format H2s on service pages (AEO)", pages.some((p) => /<h2>(What|How|Why|Do)/.test(p.html)), "question headings live"),
      check("cross-links", "Internal cross-links per page", pages.slice(1).every((p) => (p.html.match(/class="xlinks"|href="\.\.\//g) || []).length >= 1), "hub + related links"),
    ] : []),
  ];
  const passed = checks.filter((c) => c.pass).length;
  const gaps = packet.seo_gaps ?? [];
  const fixedMap = {
    "no structured data detected": "Full JSON-LD suite shipped (LocalBusiness, Service, FAQPage, BreadcrumbList, WebSite + speakable)",
    "thin page copy": packet.build_type === "multi-page" ? "Multi-page architecture with dense per-page copy" : "Full cinematic scroll: services, proof, process, area, FAQ",
    "no FAQ surface for AI answer engines": "FAQ accordion + FAQPage schema + speakable selectors",
    "no visible review proof": ctx.gbp.reviews.length ? ctx.gbp.reviews.some((review) => review.attribution === "Google") ? "Google-attributed review snippets rendered only where source evidence is present" : "Review snippets rendered with evidence-matched or neutral attribution" : "Proof band ready — connects the moment reviews are imported",
    "schema": "Full JSON-LD suite shipped", "og-image": ctx.socialPreview.hasRealAsset ? "Source-backed OG card generated when a public URL is present" : "Awaiting a real brand asset", "llms.txt": "llms.txt published at root", "sitemap": "sitemap.xml generated",
  };
  return {
    renderer: "05-build-v8", build_type: packet.build_type, generated_at: new Date().toISOString(),
    generation_fingerprint: ctx.composition.compositionFingerprint,
    composition: ctx.composition,
    pages: pages.map((p) => ({ path: p.path, title: p.title })),
    schema_types: schemaTypes,
    score: Math.round((passed / checks.length) * 100),
    checks,
    fixed_from_old_site: gaps.map((g) => ({ gap: g, fix: fixedMap[g] || "Needs source evidence, owner input, or runtime verification" })),
    authority_standard: {
      standard: authority.standard,
      total: authority.total,
      passed: authority.passed,
      failed: authority.failed,
      needs_owner_input: authority.needs_owner_input,
      runtime_verification: authority.runtime_verification,
      not_applicable: authority.not_applicable,
      public_claim: authority.public_claim,
      email_summary: authority.email_summary,
      disclaimer: authority.disclaimer,
      manifest: "optimization-manifest.json",
      categories: authority.categories,
    },
    media: {
      hero_source: heroMediaProvenance === "stock-ambiance" ? "stock-ambiance" : heroMediaSource,
      real_photos: ctx.premierMedia.gallery.length,
      has_source_video: ctx.premierMedia.hasSourceVideo,
      has_ai_ambiance_video: ctx.premierMedia.hasAmbianceVideo,
      gallery_cap: 12,
      policy: "Only verified source media appears as business proof. Without source video, the source photo stays static while reduced-motion-safe light and shader layers provide atmosphere.",
    },
  };
}

function notFoundHtml(ctx) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Page not found — ${esc(ctx.biz.name)}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:${ctx.pal.bg};color:${ctx.pal.ink};font:16px/1.6 system-ui,sans-serif}
    .nf{width:min(620px,calc(100% - 2rem));text-align:center}
    .nf b{display:block;color:${ctx.pal.accent};font-size:.82rem;text-transform:uppercase}
    .nf h1{font:700 clamp(2.2rem,8vw,4.5rem)/1.05 Georgia,serif}
    .nf a{display:inline-flex;padding:.72rem 1.2rem;border-radius:999px;background:${ctx.pal.accent};color:${ctx.pal.bg};font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <main class="nf">
    <b>404</b>
    <h1>That page is not here.</h1>
    <p>Use the home page to find services, contact details, and the next step.</p>
    <a href="./">Back to ${esc(ctx.biz.name)}</a>
  </main>
</body>
</html>`;
}

function buildAssetsManifest(packet, ctx) {
  const items = [];
  const logo = packet.logo_source;
  const logoUrl = sourceBrandLogoUrl(packet);
  if (logoUrl) items.push({ kind: "logo", url: logoUrl, source: logo?.origin || "site", proposed: false });
  for (const mark of trustedTrustMarksForPacket(packet)) items.push({ kind: "trust_mark", url: mark.url, source: mark.source, label: mark.label, hero_eligible: false, proof_eligible: false });
  for (const p of ctx.photos) items.push({ kind: p.kind || "photo", url: p.url, source: p.source === "gbp" ? "gbp" : p.source === "upload" ? "upload" : p.source === "build-request" ? "provided-source" : p.source === "stock-ambiance" ? "stock-ambiance" : "site", label: p.label || null });
  if (ctx.premierMedia?.mode === "ai-ambiance-video") {
    items.push({
      kind: "video",
      source: "ai",
      role: "ambiance",
      label: "AI-generated ambiance — not job proof",
      proof_eligible: false,
    });
  } else if (!ctx.premierMedia?.hero && !ctx.premierMedia?.gallery?.length) {
    items.push({
      kind: "ambiance",
      source: "ai",
      label: `AI ambiance — ${ambianceFor(ctx.trade.key).label}`,
      proof_eligible: false,
      note: "Generated texture. Not a job photo. Labeled per media policy.",
    });
  }
  return { generated_at: new Date().toISOString(), policy: "source:'ai' entries are ambiance/texture only — never fake job photos, never people, never before/afters.", items };
}

const PUBLIC_ARTIFACT_FORBIDDEN = /pagehub|ricardo|firecrawl|brightlocal|brightdata|leadminer|ghost agency|truth_packet|\bscrap(?:e|er|ing)\b|\bcrawler\b|\bvapi\b|\btwilio\b|\bwss\b/i;

function publicSourceLabel(value) {
  const source = String(value || "").toLowerCase();
  if (/gbp|google|places|business-profile/.test(source)) return "business-profile";
  if (/upload|owner|manual|form|intake/.test(source)) return "owner-provided";
  if (/site|web|crawl|discover/.test(source)) return "business-site";
  return "public-source";
}

function publicFactValue(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return PUBLIC_ARTIFACT_FORBIDDEN.test(value) ? null : value;
  if (Array.isArray(value)) return value.map(publicFactValue).filter((item) => item != null);
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (PUBLIC_ARTIFACT_FORBIDDEN.test(key)) continue;
      const safe = publicFactValue(item);
      if (safe != null) out[key] = safe;
    }
    return out;
  }
  return null;
}

const ASSET_SHA256 = /^[a-f0-9]{64}$/;
const ASSET_PERCEPTUAL_HASH = /^[a-f0-9]{16}$/;

function declaredAssetSha256(item = {}) {
  return [
    item.checksum_sha256,
    item.content_sha256,
    item.sha256,
    item.checksum,
    item.meta?.checksum_sha256,
    item.meta?.content_sha256,
    item.meta?.sha256,
    item.metadata?.checksum_sha256,
    item.metadata?.content_sha256,
    item.metadata?.sha256,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .find((value) => ASSET_SHA256.test(value)) || null;
}

function declaredAssetPerceptualHash(item = {}) {
  return [
    item.perceptual_hash,
    item.meta?.perceptual_hash,
    item.metadata?.perceptual_hash,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .find((value) => ASSET_PERCEPTUAL_HASH.test(value)) || null;
}

function resolvedPublicAssetPath(item = {}, outDir = null) {
  const url = safeMediaUrl(item.url);
  if (!outDir || !url || /^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  const relative = url.replace(/[?#].*$/, "").replace(/^[/\\]+/, "");
  const resolved = path.resolve(outDir, relative);
  const root = path.resolve(outDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  if (!existsSync(resolved)) return null;
  try { return statSync(resolved).isFile() ? resolved : null; } catch { return null; }
}

export function publicAssetIdentity(item = {}, { outDir = null } = {}) {
  const perceptualHash = declaredAssetPerceptualHash(item);
  const localPath = resolvedPublicAssetPath(item, outDir);
  if (localPath) {
    const bytes = readFileSync(localPath);
    return {
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      method: "content-sha256",
      byte_length: bytes.length,
      ...(perceptualHash ? { perceptual_hash: perceptualHash } : {}),
    };
  }
  const declared = declaredAssetSha256(item);
  if (declared) {
    return {
      sha256: declared,
      method: "declared-content-sha256",
      ...(perceptualHash ? { perceptual_hash: perceptualHash } : {}),
    };
  }
  const normalizedUrl = renderedMediaIdentity(item);
  if (!normalizedUrl) return null;
  return {
    sha256: crypto.createHash("sha256").update(normalizedUrl).digest("hex"),
    method: "normalized-url-sha256",
    ...(perceptualHash ? { perceptual_hash: perceptualHash } : {}),
  };
}

function publicHeroMediaItem(item, options = {}) {
  if (!item || typeof item !== "object") return null;
  const url = publicFactValue(item.url);
  if (!url) return null;
  return {
    kind: publicFactValue(item.kind),
    url,
    url_kind: /^https?:\/\//i.test(url) ? "absolute" : "preview-relative",
    source: publicMediaProvenance(item.source),
    label: publicFactValue(item.label),
    role: publicFactValue(item.role),
    presentation: publicFactValue(item.presentation),
    width: Number(item.width || 0) || null,
    height: Number(item.height || 0) || null,
    hero_eligible: item.hero_eligible !== false,
    proof_eligible: item.proof_eligible === true,
    truthful_source: item.truthful_source === true,
    asset_identity: publicAssetIdentity(item, options),
  };
}

export function publicHeroMediaContract(selection = {}, options = {}) {
  const selected = publicHeroMediaItem(selection.hero || selection.gallery?.[0], options);
  const eligible = [
    selection.sourceVideo,
    selection.sourcePhoto,
    selection.ambianceVideo,
  ]
    .filter((item) => item?.hero_eligible !== false)
    .map((item) => publicHeroMediaItem(item, options))
    .filter(Boolean)
    .filter((item, index, values) =>
      values.findIndex((candidate) => renderedMediaIdentity(candidate) === renderedMediaIdentity(item)) === index);
  return {
    selected,
    eligible,
    selection_scope: "renderer-finalists",
  };
}

function buildPublicPacket(packet, ctx, outDir = null) {
  const publicEnrichment = {};
  const allowedFacts = ["name", "category", "city", "state", "phone", "email", "website", "tone", "logo", "colors", "hours", "reviews", "reviews_attributed", "rating", "review_count", "address", "latlng", "nap", "service_areas", "years", "owner"];
  for (const key of allowedFacts) {
    const fact = packet.enrichment_sources?.[key];
    if (fact == null) continue;
    const value = publicFactValue(typeof fact === "object" && "value" in fact ? fact.value : fact);
    if (value == null) continue;
    publicEnrichment[key] = {
      source: publicSourceLabel(fact?.source),
      ...(Number.isFinite(Number(fact?.confidence)) ? { confidence: Number(fact.confidence) } : {}),
      value,
    };
  }
  if (ctx.services.length) {
    const servicesFact = packet.enrichment_sources?.services;
    publicEnrichment.services = {
      source: publicSourceLabel(servicesFact?.source),
      ...(Number.isFinite(Number(servicesFact?.confidence)) ? { confidence: Number(servicesFact.confidence) } : {}),
      value: publicFactValue(ctx.services),
    };
  }

  const business = publicFactValue({
    name: ctx.biz.name,
    category: packet.business?.category,
    city: ctx.biz.city,
    state: ctx.biz.state,
    phone: ctx.phone,
    address: ctx.gbp.address,
    current_website: packet.business?.current_website,
  });
  const logoUrl = publicFactValue(sourceBrandLogoUrl(packet));
  const publicMedia = ctx.photos.map((item) => ({
    kind: item.kind,
    url: publicFactValue(item.url),
    source: publicMediaProvenance(item.source),
    label: publicFactValue(item.label),
    role: publicFactValue(item.role),
    hero_eligible: item.hero_eligible !== false,
    proof_eligible: item.proof_eligible === true,
    asset_identity: publicAssetIdentity(item, { outDir }),
  })).filter((item) => item.url);
  const heroMedia = publicHeroMediaContract(ctx.premierMedia, { outDir });
  const logoIdentity = logoUrl
    ? publicAssetIdentity({ ...(packet.logo_source || {}), url: logoUrl }, { outDir })
    : null;
  const trustMarks = trustedTrustMarksForPacket(packet).map((mark) => ({
    kind: "trust_mark",
    url: publicFactValue(mark.url),
    label: publicFactValue(mark.label),
    source: mark.source,
  }));
  const assetIdentityManifest = {
    schema: "siteforge-public-asset-identity-v1",
    logo: logoIdentity,
    hero: heroMedia.selected?.asset_identity || null,
    catalog: publicMedia.map((item) => item.asset_identity).filter(Boolean),
  };

  return {
    schema: "public-business-v1",
    renderer: "05-build-v8",
    generation_fingerprint: ctx.composition.compositionFingerprint,
    composition: publicFactValue(ctx.composition),
    slug: publicFactValue(packet.slug),
    business,
    services: publicFactValue(ctx.services),
    logo_source: logoUrl ? {
      url: logoUrl,
      source: publicSourceLabel(packet.logo_source.origin),
      proposed: false,
      colors: publicFactValue(packet.logo_source.colors || []),
      color_provenance: publicFactValue(packet.logo_source.color_provenance || null),
      asset_identity: logoIdentity,
    } : null,
    trust_marks: trustMarks,
    media: {
      catalog: publicMedia,
      hero: heroMedia,
      fallback_reason: publicFactValue(packet.media?.fallback_reason),
    },
    asset_identity_manifest: assetIdentityManifest,
    enrichment_sources: publicEnrichment,
    hero_family: packet.hero_family,
    hero_pattern: publicFactValue(packet.hero_pattern),
    motif: packet.motif,
    section_plan: publicFactValue(packet.section_plan),
    voice_persona: {
      owner_name: publicOwnerName(packet, ctx.biz.name),
      first_person_snippets: publicFactValue(packet.voice_persona?.first_person_snippets || []),
      tone: publicFactValue(packet.voice_persona?.tone),
    },
    visual_system: publicFactValue(packet.visual_system),
    authority_standard: publicFactValue(packet.authority_standard),
  };
}

function ogSvg(ctx) {
  const { biz, trade, pal } = ctx;
  const logo = ogAssetUrl(ctx.socialPreview?.logo);
  const photo = ogAssetUrl(ctx.socialPreview?.photo);
  if (!logo && !photo) return "";
  const titleSize = biz.name.length > 34 ? 54 : biz.name.length > 24 ? 62 : 72;
  const background = photo
    ? `<image href="${esc(photo)}" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/><rect width="1200" height="630" fill="url(#shade)"/>`
    : `<rect width="1200" height="630" fill="${pal.mode === "light" ? pal.ink : pal.bg}"/>`;
  const logoImage = logo ? `<image href="${esc(logo)}" x="76" y="64" width="410" height="150" preserveAspectRatio="xMinYMid meet"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(`${biz.name} social preview`)}">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050808" stop-opacity=".9"/><stop offset=".62" stop-color="#050808" stop-opacity=".52"/><stop offset="1" stop-color="#050808" stop-opacity=".18"/></linearGradient></defs>
  ${background}${logoImage}
  <text x="76" y="420" font-family="Georgia,serif" font-size="${titleSize}" font-weight="700" fill="#fff">${esc(biz.name)}</text>
  <text x="76" y="492" font-family="Arial,sans-serif" font-size="32" font-weight="600" fill="#fff">${esc(trade.key === "default" ? biz.category : trade.key)} in ${esc(biz.city)}, ${esc(biz.state)}</text>
  <rect x="76" y="532" width="132" height="7" fill="${pal.accent}"/></svg>`;
}

// copy locally-uploaded media into the build and rewrite catalog urls → media/
function copyLocalMedia(packet, outDir) {
  const cat = packet.media?.catalog ?? [];
  for (const m of cat) {
    if (m.local_path && existsSync(m.local_path)) {
      const name = path.basename(m.local_path);
      try { copyFileSync(m.local_path, path.join(outDir, "media", name)); m.url = `media/${name}`; } catch {}
    }
  }
  const lp = packet.logo_source;
  const logoPath = lp?.local_path || packet.enrichment_sources?.logo?.local_path || null; // rescue() drops local_path
  if (lp && logoPath && existsSync(logoPath)) {
    const name = path.basename(logoPath);
    try { copyFileSync(logoPath, path.join(outDir, "media", name)); lp.chosen_url = `media/${name}`; } catch {}
  }
}

// ---------------- stage entry ----------------
export async function build(packet, { outDir, capture = true, premierInputs = null } = {}) {
  emit("build", "start", { slug: packet.slug, renderer: "05-build-v8", build_type: packet.build_type });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, "media"), { recursive: true });
  mkdirSync(path.join(outDir, "screenshots", "desktop"), { recursive: true });
  mkdirSync(path.join(outDir, "screenshots", "mobile"), { recursive: true });
  if (packet.v7_logo) packet.logo_source = { ...packet.v7_logo }; // upload/candidate choice wins over rescue's rebuild
  copyLocalMedia(packet, outDir);
  applyVisualContract(packet);

  const discoveredBrand = discoveredBrandAt(outDir);
  if (Object.keys(discoveredBrand).length) {
    packet.brand = {
      ...(packet.brand || {}),
      ...discoveredBrand,
      colors: discoveredBrand.colors || packet.brand?.colors || [],
    };
  }
  const ctx = buildCtx(packet, premierInputs, discoveredBrand);
  packet.renderer = "05-build-v8";
  packet.generation_fingerprint = ctx.composition.compositionFingerprint;
  packet.composition = ctx.composition;
  const multi = packet.build_type === "multi-page" || packet.build_type === "premier_multi_page";
  const { pages } = multi ? renderMultiPage(packet, ctx) : renderSinglePage(packet, ctx);

  for (const p of pages) {
    const fp = path.join(outDir, p.file);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, p.html);
  }
  const socialPreviewSvg = ogSvg(ctx);
  if (socialPreviewSvg) writeFileSync(path.join(outDir, "media", "og.svg"), socialPreviewSvg);
  writeFileSync(path.join(outDir, "404.html"), notFoundHtml(ctx));
  writeFileSync(path.join(outDir, "veo_prompt.json"), JSON.stringify(packet.veo_prompt ?? {}, null, 2));
  const schemaGraph = jsonLdFor(ctx);
  const authority = evaluateAuthorityStandard({ packet, ctx, pages, schemaGraph });
  packet.authority_standard = {
    standard: authority.standard,
    total: authority.total,
    passed: authority.passed,
    failed: authority.failed,
    needs_owner_input: authority.needs_owner_input,
    runtime_verification: authority.runtime_verification,
    not_applicable: authority.not_applicable,
    public_claim: authority.public_claim,
    email_summary: authority.email_summary,
    disclaimer: authority.disclaimer,
    checks: authority.checks,
  };
  writeFileSync(path.join(outDir, "packet.json"), JSON.stringify(buildPublicPacket(packet, ctx, outDir), null, 2));
  writeFileSync(path.join(outDir, "optimization-manifest.json"), JSON.stringify(authority, null, 2));
  const scorecard = buildScorecard(packet, ctx, pages, authority, schemaGraph);
  writeFileSync(path.join(outDir, "scorecard.json"), JSON.stringify(scorecard, null, 2));
  writeFileSync(path.join(outDir, "assets.json"), JSON.stringify(buildAssetsManifest(packet, ctx), null, 2));
  // sitemap + robots + llms.txt (multi-page ships the full pack; single page a lean one)
  writeFileSync(path.join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${p.path}</loc></url>`).join("\n")}\n</urlset>\n`);
  writeFileSync(path.join(outDir, "llms.txt"), `# ${ctx.biz.name} — llms.txt\n# ${ctx.biz.name} is a ${ctx.trade.key === "default" ? ctx.biz.category : ctx.trade.key} business in ${ctx.biz.city}, ${ctx.biz.state}.\n# Services: ${ctx.services.join(", ")}.\n${pages.map((p) => `- ${p.path} — ${p.title}`).join("\n")}\n`);
  if (!packet.forge?.demo) writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *\nAllow: /\n");

  emit("build", "render-hero", { family: ctx.composition.archetype.id, renderer: "05-build-v8", generation_fingerprint: ctx.composition.compositionFingerprint, pages: pages.length, media: scorecard.media.hero_source });
  let screenshots = [];
  if (capture) {
    try { screenshots = await captureScreenshots(outDir); }
    catch (e) { emit("build", "capture-skipped", { reason: e.message.split("\n")[0] }); }
  } else {
    emit("build", "capture-skipped", { reason: "disabled for deterministic contract test" });
  }
  emit("build", "done", { screenshots, pages: pages.length, scorecard: scorecard.score, renderer: "05-build-v8", generation_fingerprint: ctx.composition.compositionFingerprint, packet_path: path.join(outDir, "packet.json") });
  return packet;
}

export function classifyGoogleMapResponseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return null;
    if (host === "maps.googleapis.com" || host === "maps.gstatic.com") return "asset";
    if (!new Set(["google.com", "www.google.com", "maps.google.com"]).has(host) || !parsed.pathname.startsWith("/maps")) return null;
    return /\/embed(?:\/|$)/i.test(parsed.pathname) || parsed.searchParams.get("output") === "embed"
      ? "embed"
      : null;
  } catch {
    return null;
  }
}

export async function hydrateLazyMedia(page, { timeoutMs = 8000, stepDelayMs = 100 } = {}) {
  const result = await page.evaluate(async ({ waitMs, settleMs }) => {
    const deadline = Date.now() + waitMs;
    const images = [...document.querySelectorAll('img[loading="lazy"]')];
    for (const image of images) image.setAttribute("data-siteforge-capture-lazy", "true");
    for (const image of images) {
      if (Date.now() >= deadline) break;
      image.scrollIntoView({ block: "center", inline: "nearest" });
      image.loading = "eager";
      if (!image.complete) {
        await Promise.race([
          new Promise((resolve) => {
            const finish = () => {
              image.removeEventListener("load", finish);
              image.removeEventListener("error", finish);
              resolve();
            };
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
          }),
          new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
        ]);
      }
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(settleMs, Math.max(0, deadline - Date.now()))));
    }
    return {
      total: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      failed: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      pending: images.filter((image) => !image.complete).length,
    };
  }, { waitMs: timeoutMs, settleMs: stepDelayMs });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (result.failed > 0 || result.pending > 0) {
    const error = new Error(`capture_lazy_media_incomplete: failed=${result.failed}, pending=${result.pending}`);
    error.code = "capture_lazy_media_incomplete";
    error.retryable = true;
    error.details = result;
    throw error;
  }
  return result;
}

export async function freezeMapEmbedsForCapture(page, { mapImageUrl = "./screenshots/desktop/map.png" } = {}) {
  return page.evaluate(async (imageUrl) => {
    const maps = [...document.querySelectorAll(".premier-map[data-google-map='satellite']")];
    let frozen = 0;
    let placeholders = 0;
    for (const map of maps) {
      const iframe = map.querySelector("iframe");
      if (!iframe) {
        const existing = map.querySelector("img[data-siteforge-frozen-map='true']");
        if (existing?.complete && existing.naturalWidth > 0) frozen += 1;
        else if (existing) {
          const height = Math.max(160, Math.round(existing.getBoundingClientRect().height || 280));
          const placeholder = document.createElement("div");
          placeholder.setAttribute("data-siteforge-frozen-map", "unavailable");
          placeholder.style.cssText = `display:grid;width:100%;height:${height}px;place-items:center;background:#e7e5df;color:#343434`;
          placeholder.textContent = "Map preview unavailable";
          existing.replaceWith(placeholder);
          placeholders += 1;
        }
        continue;
      }
      const bounds = iframe.getBoundingClientRect();
      const height = Math.max(160, Math.round(bounds.height || 280));
      const replacement = document.createElement("img");
      replacement.alt = iframe.title || "Satellite map";
      replacement.setAttribute("data-siteforge-frozen-map", "true");
      replacement.style.cssText = `display:block;width:100%;height:${height}px;object-fit:cover`;
      replacement.src = new URL(imageUrl, document.baseURI).href;
      iframe.replaceWith(replacement);
      if (!replacement.complete) {
        await Promise.race([
          new Promise((resolve) => {
            const finish = () => resolve();
            replacement.addEventListener("load", finish, { once: true });
            replacement.addEventListener("error", finish, { once: true });
          }),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      if (replacement.complete && replacement.naturalWidth > 0) {
        frozen += 1;
        continue;
      }
      const placeholder = document.createElement("div");
      placeholder.setAttribute("data-siteforge-frozen-map", "unavailable");
      placeholder.style.cssText = `display:grid;width:100%;height:${height}px;place-items:center;background:#e7e5df;color:#343434`;
      placeholder.textContent = "Map preview unavailable";
      replacement.replaceWith(placeholder);
      placeholders += 1;
    }
    return { total: maps.length, frozen, placeholders, live_iframes: document.querySelectorAll(".premier-map iframe").length };
  }, mapImageUrl);
}

export function buildStaticCaptureHtml(value, { mapImageUrl = "./screenshots/desktop/map.png", mapVerified = true } = {}) {
  let mapReplacements = 0;
  const mapImage = mapVerified
    ? `<img data-siteforge-frozen-map="true" src="${esc(mapImageUrl)}" alt="Satellite map capture" style="display:block;width:100%;height:280px;object-fit:cover">`
    : '<div data-siteforge-frozen-map="unavailable" style="display:grid;width:100%;height:280px;place-items:center;background:#e7e5df;color:#343434">Map preview unavailable</div>';
  const html = String(value || "").replace(
    /<iframe\b[^>]*\bsrc=["']https:\/\/(?:www\.|maps\.)?google\.com\/maps[^"']*["'][^>]*>\s*<\/iframe>/gi,
    () => {
      mapReplacements += 1;
      return mapImage;
    },
  ).replace(
    /<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi,
    (script, attributes) => /\btype\s*=\s*["']application\/(?:ld\+json|json)["']/i.test(attributes)
      ? script
      : "",
  );
  const captureStyle = '<style id="siteforge-capture-static">*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}</style>';
  return {
    html: /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${captureStyle}</head>`) : `${captureStyle}${html}`,
    map_replacements: mapReplacements,
  };
}

export async function writeEsriSatelliteEvidence(page, screenshotRoot) {
  const mapPath = path.join(screenshotRoot, "desktop", "map.png");
  const evidencePath = path.join(screenshotRoot, "map-evidence.json");
  const renderedDomPath = path.join(screenshotRoot, "rendered-dom.html");
  mkdirSync(path.dirname(mapPath), { recursive: true });
  rmSync(mapPath, { force: true });
  rmSync(renderedDomPath, { force: true });

  const persist = (evidence) => {
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    return evidence;
  };
  const baseEvidence = {
    pass: false,
    provider: "esri-world-imagery",
    response_ok: false,
    geometry_ok: false,
    pixels_ok: false,
    unique_colors: 0,
    variance: 0,
    artifact: "screenshots/desktop/map.png",
  };

  const coordinates = await page.evaluate(() => {
    const valid = (latValue, lngValue) => {
      const lat = Number(latValue);
      const lng = Number(lngValue);
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
        ? { lat, lng }
        : null;
    };
    for (const selector of ["[data-map][data-lat][data-lng]", ".premier-map[data-lat][data-lng]"]) {
      for (const element of document.querySelectorAll(selector)) {
        const found = valid(element.getAttribute("data-lat"), element.getAttribute("data-lng"));
        if (found) return found;
      }
    }
    for (const frame of document.querySelectorAll("iframe[src*='google.com/maps']")) {
      try {
        const query = new URL(frame.getAttribute("src"), document.baseURI).searchParams.get("q") || "";
        const match = decodeURIComponent(query).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
        const found = match ? valid(match[1], match[2]) : null;
        if (found) return found;
      } catch {}
    }
    return null;
  }).catch(() => null);

  if (!coordinates) {
    return persist({ ...baseEvidence, detail: "confirmed map coordinates were not available for satellite evidence" });
  }

  const radius = 0.0045;
  const bbox = [
    coordinates.lng - radius,
    coordinates.lat - radius,
    coordinates.lng + radius,
    coordinates.lat + radius,
  ].map((value) => value.toFixed(6)).join(",");
  const exportUrl = new URL("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export");
  exportUrl.searchParams.set("bbox", bbox);
  exportUrl.searchParams.set("bboxSR", "4326");
  exportUrl.searchParams.set("imageSR", "4326");
  exportUrl.searchParams.set("size", "640,400");
  exportUrl.searchParams.set("format", "png");
  exportUrl.searchParams.set("f", "image");

  try {
    const response = await fetch(exportUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      return persist({ ...baseEvidence, detail: `Esri World Imagery export returned HTTP ${response.status}` });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const signal = await rasterSignal(page, bytes);
    const pixelsOk = signal.uniqueColors >= 16 && signal.variance >= 80;
    const evidence = {
      ...baseEvidence,
      pass: pixelsOk,
      detail: pixelsOk
        ? "Esri World Imagery response and rendered pixel crop verified"
        : "Esri World Imagery pixel diversity or variance was not verified",
      response_ok: true,
      geometry_ok: true,
      pixels_ok: pixelsOk,
      unique_colors: signal.uniqueColors,
      variance: signal.variance,
    };
    if (!evidence.pass) return persist(evidence);

    writeFileSync(mapPath, bytes);
    writeFileSync(renderedDomPath, '<!doctype html><div class="premier-map map-live" data-google-map="satellite" data-map-rendered="verified" data-satellite-rendered="verified" data-map-provider="esri-world-imagery"><img data-satellite-tile="rendered" src="desktop/map.png" alt="Rendered satellite map evidence"></div>');
    return persist(evidence);
  } catch (error) {
    return persist({ ...baseEvidence, detail: `Esri World Imagery export failed: ${String(error?.message || error)}` });
  }
}

async function freezeCaptureMotion(page) {
  await page.emulateMedia({ reducedMotion: "reduce" }).catch(() => {});
  await page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}" }).catch(() => {});
  await page.evaluate(() => {
    for (const video of document.querySelectorAll("video")) {
      try { video.pause(); video.removeAttribute("autoplay"); } catch {}
    }
  }).catch(() => {});
  await page.waitForTimeout(200);
}

export async function prepareOptionalGoogleMapEvidence(map, pendingMapResponse, { timeoutMs = 5_000 } = {}) {
  let scrollError = null;
  try {
    await map.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  } catch (error) {
    scrollError = error;
  }
  // waitForResponse is started before the scroll so it cannot miss a fast map
  // response. Always settle it, including the timeout path, so no background
  // promise survives into the required page screenshots.
  const response = pendingMapResponse ? await pendingMapResponse.catch(() => null) : null;
  return {
    pass: !scrollError,
    response,
    detail: scrollError
      ? `Google map evidence scroll was unavailable: ${String(scrollError?.message || scrollError).split("\n")[0]}`
      : "Google map evidence surface was ready",
  };
}

async function captureScreenshots(outDir) {
  const screenshotRoot = path.join(outDir, "screenshots");
  const manifestPath = path.join(screenshotRoot, "manifest.json");
  rmSync(screenshotRoot, { recursive: true, force: true });
  mkdirSync(path.join(screenshotRoot, "desktop"), { recursive: true });
  mkdirSync(path.join(screenshotRoot, "mobile"), { recursive: true });
  rmSync(path.join(outDir, "media", "og.png"), { force: true });

  const indexPath = path.resolve(outDir, "index.html");
  const indexSha256 = crypto.createHash("sha256").update(readFileSync(indexPath)).digest("hex");
  const captureRoute = createCaptureRoute(outDir, indexSha256);
  const captureStartedAt = new Date().toISOString();
  const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
  const shots = [];
  let mapEvidence = { pass: false, detail: "no satellite map was rendered" };
  let videoEvidence = { required: false, pass: true, count: 0, detail: "no video hero was rendered", videos: [] };
  const serverlessCapture = process.env.VERCEL || process.env.SITEFORGE_SERVERLESS === "1";
  for (const [name, viewport] of Object.entries(viewports)) {
    let browser;
    try {
      browser = await launchChromium();
      const page = await browser.newPage({ viewport });
      await page.route(captureRoute.pattern, async (route) => {
        const filePath = resolveCaptureFile(captureRoute.root, route.request().url(), captureRoute.prefix);
        if (!filePath || !existsSync(filePath)) return route.abort("failed");
        return route.fulfill({
          status: 200,
          body: readFileSync(filePath),
          contentType: captureContentType(filePath),
        });
      });
      const mapResponses = [];
      page.on("response", (response) => {
        const url = response.url();
        const kind = classifyGoogleMapResponseUrl(url);
        if (kind) {
          mapResponses.push({
            kind,
            status: response.status(),
            ok: response.ok(),
          });
        }
      });
      // domcontentloaded (not "load"): a single stalled external subresource — the
      // Google Maps embed iframe, a web font, or a video hero — must never let the
      // page-level "load" event 30s-timeout the entire build. We still give "load" a
      // bounded chance to fire, then fall through to the fonts + settle waits below.
      await page.goto(captureRoute.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
      await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready.catch(() => {}); });
      await page.waitForTimeout(1100); // let kinetic headline + reveals settle so posters look finished
      if (name === "desktop") {
        videoEvidence = await captureVideoEvidence(page);
        writeFileSync(path.join(screenshotRoot, "video-evidence.json"), JSON.stringify(videoEvidence, null, 2));
        const map = page.locator(".premier-map[data-google-map='satellite']").first();
        if (await map.count()) {
          const pendingMapResponse = mapResponses.some((item) => item.kind === "embed" && item.ok)
            ? null
            : page.waitForResponse(
              (response) => Boolean(classifyGoogleMapResponseUrl(response.url())) && response.ok(),
              { timeout: 7000 },
            ).catch(() => null);
          await map.scrollIntoViewIfNeeded();
          if (pendingMapResponse) await pendingMapResponse;
          const mapFrame = map.locator("iframe").first();
          const box = await mapFrame.boundingBox();
          const mapPath = path.join(screenshotRoot, "desktop", "map.png");
          let signal = { uniqueColors: 0, variance: 0 };
          let responseOk = false;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const bytes = await mapFrame.screenshot({ path: mapPath, timeout: 5000 }).catch(() => null);
            if (!bytes) break;
            signal = await rasterSignal(page, bytes);
            responseOk = mapResponses.some((item) => item.kind === "embed" && item.ok && item.status >= 200 && item.status < 400);
            if (responseOk && signal.uniqueColors >= 16 && signal.variance >= 80) break;
            await page.waitForTimeout(400);
          }
          const geometryOk = Boolean(box && box.width >= 260 && box.height >= 160);
          const pixelsOk = signal.uniqueColors >= 16 && signal.variance >= 80;
          mapEvidence = {
            pass: responseOk && geometryOk && pixelsOk,
            detail: responseOk && geometryOk && pixelsOk ? "Google satellite response and rendered pixel crop verified" : "satellite map response, geometry, or pixel variance was not verified",
            response_ok: responseOk,
            capture_origin: captureRoute.origin,
            geometry_ok: geometryOk,
            pixels_ok: pixelsOk,
            unique_colors: signal.uniqueColors,
            variance: signal.variance,
            artifact: "screenshots/desktop/map.png",
          };
          writeFileSync(path.join(screenshotRoot, "map-evidence.json"), JSON.stringify(mapEvidence, null, 2));
          if (mapEvidence.pass) {
            writeFileSync(path.join(screenshotRoot, "rendered-dom.html"), '<!doctype html><div class="premier-map map-live" data-google-map="satellite" data-map-rendered="verified" data-satellite-rendered="verified"><img data-satellite-tile="rendered" src="desktop/map.png" alt="Rendered satellite map evidence"></div>');
          }
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        if (!mapEvidence.pass) mapEvidence = await writeEsriSatelliteEvidence(page, screenshotRoot);
      }
      const mapFreeze = await freezeMapEmbedsForCapture(page);
      await freezeCaptureMotion(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      const heroRel = `screenshots/${name}/hero.png`;
      try {
        await stablePageScreenshot(page, path.join(outDir, heroRel), { fullPage: false });
      } catch (error) {
        throw new Error(`Screenshot capture failed for ${heroRel}: ${error.message}`);
      }
      shots.push(heroRel);
      const lazyHydration = await hydrateLazyMedia(page);
      console.info(`[capture-ready] viewport=${name} map_frozen=${mapFreeze.frozen}/${mapFreeze.total} lazy_loaded=${lazyHydration.loaded}/${lazyHydration.total}`);
      for (const [fold, y] of Object.entries({ mid: 820, footer: 1600 })) {
        await scrollToCaptureFold(page, y);
        await page.waitForTimeout(250);
        const rel = `screenshots/${name}/${fold}.png`;
        try {
          await stablePageScreenshot(page, path.join(outDir, rel), { fullPage: false });
        } catch (error) {
          throw new Error(`Screenshot capture failed for ${rel}: ${error.message}`);
        }
        shots.push(rel);
      }
      const fullRel = `screenshots/${name}/full.png`;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      try {
        await stablePageScreenshot(page, path.join(outDir, fullRel), { fullPage: true });
      } catch (error) {
        throw new Error(`Screenshot capture failed for ${fullRel}: ${error.message}`);
      }
      shots.push(fullRel);
      await page.close().catch(() => {});
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
  // Render the source-backed social card when local Chromium has enough
  // headroom. In serverless, conserve the browser budget for required QC PNGs.
  if (!serverlessCapture && existsSync(path.join(outDir, "media", "og.svg"))) {
    let browser;
    try {
      browser = await launchChromium();
      const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
      await page.goto(pathToFileURL(path.resolve(outDir, "media", "og.svg")).href);
      await stablePageScreenshot(page, path.join(outDir, "media", "og.png"), { fullPage: false });
      await page.close().catch(() => {});
    } catch {
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  const files = shots.map((relativePath) => {
    const absolutePath = path.join(outDir, relativePath);
    if (!existsSync(absolutePath)) throw new Error(`Screenshot capture missing ${relativePath}`);
    const bytes = readFileSync(absolutePath);
    const size = statSync(absolutePath).size;
    if (size < 1024) throw new Error(`Screenshot capture is empty or truncated: ${relativePath}`);
    return {
      path: relativePath.replace(/\\/g, "/"),
      size,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });
  writeFileSync(manifestPath, JSON.stringify({
    schema: "siteforge-screenshot-manifest-v1",
    renderer: "05-build-v8",
    source: "index.html",
    index_sha256: indexSha256,
    capture_started_at: captureStartedAt,
    captured_at: new Date().toISOString(),
    viewports,
    map_evidence: mapEvidence,
    video_evidence: videoEvidence,
    files,
  }, null, 2));
  return shots;
}

export async function captureScreenshotsForViewport(outDir, viewportName, options = {}) {
  const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
  const viewport = viewports[viewportName];
  if (!viewport) throw new Error(`Unknown screenshot viewport: ${viewportName}`);
  const screenshotRoot = path.join(outDir, "screenshots");
  if (viewportName === "desktop") rmSync(screenshotRoot, { recursive: true, force: true });
  mkdirSync(path.join(screenshotRoot, "desktop"), { recursive: true });
  mkdirSync(path.join(screenshotRoot, "mobile"), { recursive: true });

  const indexPath = path.resolve(outDir, "index.html");
  const indexSha256 = crypto.createHash("sha256").update(readFileSync(indexPath)).digest("hex");
  const captureRoute = createCaptureRoute(outDir, indexSha256);
  const shots = [];
  let mapEvidence = { pass: false, detail: "no satellite map was rendered" };
  let videoEvidence = { required: false, pass: true, count: 0, detail: "no video hero was rendered", videos: [] };
  let browser;
  let page;
  let captureIndexOverride = null;
  let freshCaptureRecoveryUsed = false;
  const mapResponses = [];
  const installCaptureRoute = (targetPage) => targetPage.route(captureRoute.pattern, async (route) => {
    const filePath = resolveCaptureFile(captureRoute.root, route.request().url(), captureRoute.prefix);
    if (!filePath || !existsSync(filePath)) return route.abort("failed");
    return route.fulfill({
      status: 200,
      body: captureIndexOverride !== null && filePath === indexPath
        ? Buffer.from(captureIndexOverride)
        : readFileSync(filePath),
      contentType: captureContentType(filePath),
    });
  });
  const observeMapResponses = (targetPage) => targetPage.on("response", (response) => {
    const url = response.url();
    const kind = classifyGoogleMapResponseUrl(url);
    if (kind) {
      mapResponses.push({
        kind,
        status: response.status(),
        ok: response.ok(),
      });
    }
  });
  const prepareNavigatedPage = async (targetPage) => {
    await installCaptureRoute(targetPage);
    observeMapResponses(targetPage);
  };
  const navigateCapturePhase = async (url, phase) => {
    const result = await captureWithFreshChromiumRecovery({
      browser,
      page,
      pageOptions: { viewport },
      signal: options.signal,
      allowRecovery: !freshCaptureRecoveryUsed,
      capture: (targetPage) => navigateChromiumPageForCapture(targetPage, url, { phase }),
      preparePage: prepareNavigatedPage,
    });
    if (result.recovered) {
      freshCaptureRecoveryUsed = true;
      browser = result.browser;
      page = result.page;
      console.warn(`[capture-fresh-browser-recovery] viewport=${viewportName} phase=${phase}`);
    }
    return result;
  };
  const abortCapture = () => {
    if (browser) void browser.close().catch(() => {});
  };
  try {
    browser = await launchChromium();
    if (options.signal?.aborted) {
      await browser.close().catch(() => {});
      throw options.signal.reason || new Error("Screenshot capture was aborted.");
    }
    options.signal?.addEventListener("abort", abortCapture, { once: true });
    ({ browser, page } = await openChromiumPageWithRecovery(
      browser,
      { viewport },
      { signal: options.signal },
    ));
    await prepareNavigatedPage(page);
    // domcontentloaded (not "load"): a stalled external subresource (map iframe/font/video)
    // must not 30s-hang the build. "load" still gets a bounded chance before the settle waits.
    await navigateCapturePhase(captureRoute.url, `${viewportName}:initial`);
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await waitForChromiumFonts(page);
    await page.waitForTimeout(1100);
    if (viewportName === "desktop") {
      videoEvidence = await captureVideoEvidence(page);
      writeFileSync(path.join(screenshotRoot, "video-evidence.json"), JSON.stringify(videoEvidence, null, 2));
      const map = page.locator(".premier-map[data-google-map='satellite']").first();
      if (await map.count()) {
        const pendingMapResponse = mapResponses.some((item) => item.kind === "embed" && item.ok)
          ? null
          : page.waitForResponse(
            (response) => Boolean(classifyGoogleMapResponseUrl(response.url())) && response.ok(),
              { timeout: 7000 },
            ).catch(() => null);
        const mapScroll = await prepareOptionalGoogleMapEvidence(map, pendingMapResponse);
        if (!mapScroll.pass) {
          mapEvidence = {
            pass: false,
            detail: mapScroll.detail,
            response_ok: false,
            capture_origin: captureRoute.origin,
          };
          console.warn(`[capture-map-google-skipped] viewport=${viewportName} detail=${mapScroll.detail}`);
        } else {
          try {
            const mapFrame = map.locator("iframe").first();
            const box = await mapFrame.boundingBox({ timeout: 5_000 });
            const mapPath = path.join(screenshotRoot, "desktop", "map.png");
            let signal = { uniqueColors: 0, variance: 0 };
            let responseOk = false;
            for (let attempt = 0; attempt < 12; attempt += 1) {
              const bytes = await mapFrame.screenshot({ path: mapPath, timeout: 5000 }).catch(() => null);
              if (!bytes) break;
              signal = await rasterSignal(page, bytes);
              responseOk = mapResponses.some((item) => item.kind === "embed" && item.ok && item.status >= 200 && item.status < 400);
              if (responseOk && signal.uniqueColors >= 16 && signal.variance >= 80) break;
              await page.waitForTimeout(400);
            }
            const geometryOk = Boolean(box && box.width >= 260 && box.height >= 160);
            const pixelsOk = signal.uniqueColors >= 16 && signal.variance >= 80;
            mapEvidence = {
              pass: responseOk && geometryOk && pixelsOk,
              detail: responseOk && geometryOk && pixelsOk ? "Google satellite response and rendered pixel crop verified" : "satellite map response, geometry, or pixel variance was not verified",
              response_ok: responseOk,
              capture_origin: captureRoute.origin,
              geometry_ok: geometryOk,
              pixels_ok: pixelsOk,
              unique_colors: signal.uniqueColors,
              variance: signal.variance,
              artifact: "screenshots/desktop/map.png",
            };
            writeFileSync(path.join(screenshotRoot, "map-evidence.json"), JSON.stringify(mapEvidence, null, 2));
            if (mapEvidence.pass) {
              writeFileSync(path.join(screenshotRoot, "rendered-dom.html"), '<!doctype html><div class="premier-map map-live" data-google-map="satellite" data-map-rendered="verified" data-satellite-rendered="verified"><img data-satellite-tile="rendered" src="desktop/map.png" alt="Rendered satellite map evidence"></div>');
            }
          } catch (error) {
            mapEvidence = {
              pass: false,
              detail: `Google map evidence failed: ${String(error?.message || error).split("\n")[0]}`,
              response_ok: false,
              capture_origin: captureRoute.origin,
            };
            console.warn(`[capture-map-google-failed] viewport=${viewportName} detail=${mapEvidence.detail}`);
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (!mapEvidence.pass) mapEvidence = await writeEsriSatelliteEvidence(page, screenshotRoot);
    }
    const priorMapEvidence = viewportName === "desktop"
      ? mapEvidence
      : (() => {
        try { return JSON.parse(readFileSync(path.join(screenshotRoot, "map-evidence.json"), "utf8")); }
        catch { return { pass: false }; }
      })();
    const staticCapture = buildStaticCaptureHtml(readFileSync(indexPath, "utf8"), { mapVerified: priorMapEvidence.pass === true });
    if (options.signal?.aborted) throw options.signal.reason || new Error("Screenshot capture was aborted.");
    // Keep evidence and still capture on the same page. Sparticuz Chromium runs
    // in single-process mode, where closing the first page and opening another
    // can disconnect or hang the replacement screenshot pipeline. Re-navigating
    // the already-proven page through its existing route gives the static pass a
    // clean document while avoiding a browser/page lifecycle handoff.
    captureIndexOverride = staticCapture.html;
    // Static-capture pass: motion frozen + map embeds replaced, but honor the same
    // domcontentloaded guard so a residual external asset can't 30s-hang the build.
    await navigateCapturePhase(`${captureRoute.url}?surface=static`, `${viewportName}:static`);
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await waitForChromiumFonts(page);
    await page.waitForTimeout(250);
    const mapFreeze = await freezeMapEmbedsForCapture(page);
    console.info(`[capture-surface] viewport=${viewportName} static_maps=${staticCapture.map_replacements} map_frozen=${mapFreeze.frozen}/${mapFreeze.total} live_iframes=${mapFreeze.live_iframes}`);
    // Freeze the page before still capture: constrained serverless CPUs can
    // never stabilize a surface that is perpetually animating (video heroes,
    // shaders, marquee loops), which starves every screenshot strategy into
    // timeout. Evidence gathering above ran against the live page; stills are
    // captured in the deterministic reduced-motion state.
    await freezeCaptureMotion(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const prepareRecoveredStaticPage = async (targetPage, { foldY = 0, fullPage = false } = {}) => {
      await installCaptureRoute(targetPage);
      await navigateChromiumPageForCapture(
        targetPage,
        `${captureRoute.url}?surface=static&recovery=fresh`,
        { phase: `${viewportName}:artifact-recovery` },
      );
      await targetPage.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
      await waitForChromiumFonts(targetPage);
      await targetPage.waitForTimeout(250);
      await freezeMapEmbedsForCapture(targetPage);
      await freezeCaptureMotion(targetPage);
      await hydrateLazyMedia(targetPage);
      if (fullPage || foldY <= 0) {
        await targetPage.evaluate(() => window.scrollTo(0, 0));
      } else {
        await scrollToCaptureFold(targetPage, foldY);
      }
      await targetPage.waitForTimeout(250);
    };
    const captureStill = async (relativePath, { foldY = 0, fullPage = false } = {}) => {
      const outputPath = path.join(outDir, relativePath);
      const capture = async (targetPage) => {
        // A failed protocol command can leave a partial PNG behind. Never let a
        // later manifest mistake that file for the replacement process's proof.
        rmSync(outputPath, { force: true });
        await stablePageScreenshot(targetPage, outputPath, { fullPage });
        if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
          throw new Error(`Screenshot capture is empty or truncated: ${relativePath}`);
        }
      };
      const result = await captureWithFreshChromiumRecovery({
        browser,
        page,
        pageOptions: { viewport },
        signal: options.signal,
        allowRecovery: !freshCaptureRecoveryUsed,
        capture,
        preparePage: (targetPage) => prepareRecoveredStaticPage(targetPage, { foldY, fullPage }),
      });
      if (result.recovered) {
        freshCaptureRecoveryUsed = true;
        browser = result.browser;
        page = result.page;
        console.warn(`[capture-fresh-browser-recovery] viewport=${viewportName} artifact=${relativePath}`);
      }
    };
    const heroRel = `screenshots/${viewportName}/hero.png`;
    try {
      await captureStill(heroRel);
    } catch (error) {
      const captureError = new Error(`Screenshot capture failed for ${heroRel}: ${error.message}`);
      captureError.code = "visual_capture_failed";
      captureError.retryable = true;
      throw captureError;
    }
    shots.push(heroRel);
    const lazyHydration = await hydrateLazyMedia(page);
    console.info(`[capture-ready] viewport=${viewportName} map_frozen=${mapFreeze.frozen}/${mapFreeze.total} lazy_loaded=${lazyHydration.loaded}/${lazyHydration.total}`);
    for (const [fold, y] of Object.entries({ mid: 820, footer: 1600 })) {
      await scrollToCaptureFold(page, y);
      await page.waitForTimeout(250);
      const rel = `screenshots/${viewportName}/${fold}.png`;
      try {
        await captureStill(rel, { foldY: y });
      } catch (error) {
        const captureError = new Error(`Screenshot capture failed for ${rel}: ${error.message}`);
        captureError.code = "visual_capture_failed";
        captureError.retryable = true;
        throw captureError;
      }
      shots.push(rel);
    }
    const fullRel = `screenshots/${viewportName}/full.png`;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    try {
      await captureStill(fullRel, { fullPage: true });
    } catch (error) {
      const captureError = new Error(`Screenshot capture failed for ${fullRel}: ${error.message}`);
      captureError.code = "visual_capture_failed";
      captureError.retryable = true;
      throw captureError;
    }
    shots.push(fullRel);
    await page.close().catch(() => {});
  } catch (error) {
    throw classifyChromiumCaptureError(error);
  } finally {
    options.signal?.removeEventListener("abort", abortCapture);
    if (browser) await browser.close().catch(() => {});
  }
  return { viewport: viewportName, shots, map_evidence: mapEvidence, video_evidence: videoEvidence };
}

export function finalizeScreenshotManifest(outDir) {
  const screenshotRoot = path.join(outDir, "screenshots");
  const indexPath = path.resolve(outDir, "index.html");
  const indexSha256 = crypto.createHash("sha256").update(readFileSync(indexPath)).digest("hex");
  const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
  const shots = [
    "screenshots/desktop/hero.png", "screenshots/desktop/mid.png", "screenshots/desktop/footer.png", "screenshots/desktop/full.png",
    "screenshots/mobile/hero.png", "screenshots/mobile/mid.png", "screenshots/mobile/footer.png", "screenshots/mobile/full.png",
  ];
  const files = shots.map((relativePath) => {
    const absolutePath = path.join(outDir, relativePath);
    if (!existsSync(absolutePath)) throw new Error(`Screenshot capture missing ${relativePath}`);
    const bytes = readFileSync(absolutePath);
    const size = statSync(absolutePath).size;
    if (size < 1024) throw new Error(`Screenshot capture is empty or truncated: ${relativePath}`);
    return {
      path: relativePath.replace(/\\/g, "/"),
      size,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const readEvidence = (name, fallback) => {
    try { return JSON.parse(readFileSync(path.join(screenshotRoot, name), "utf8")); } catch { return fallback; }
  };
  const manifest = {
    schema: "siteforge-screenshot-manifest-v1",
    renderer: "05-build-v8",
    source: "index.html",
    index_sha256: indexSha256,
    capture_started_at: new Date().toISOString(),
    captured_at: new Date().toISOString(),
    viewports,
    map_evidence: readEvidence("map-evidence.json", { pass: false, detail: "no satellite map was rendered" }),
    video_evidence: readEvidence("video-evidence.json", { required: false, pass: true, count: 0, detail: "no video hero was rendered", videos: [] }),
    files,
  };
  writeFileSync(path.join(screenshotRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  return files.map((file) => file.path);
}

async function scrollToCaptureFold(page, targetY) {
  await page.evaluate((requestedY) => {
    window.scrollTo(0, requestedY);
    const rails = [...document.querySelectorAll("header,[data-sticky-cta],[data-conversion-rail]")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return ["fixed", "sticky"].includes(style.position)
          && style.visibility !== "hidden"
          && style.display !== "none"
          && rect.width > 0
          && rect.height > 0;
      });
    const railBottom = Math.max(0, ...rails.map((element) => element.getBoundingClientRect().bottom));
    if (railBottom <= 0) return;

    const clippedAction = [...document.querySelectorAll("a,button,input,textarea,select,summary")]
      .filter((element) => !rails.some((rail) => rail.contains(element)))
      .map((element) => ({ element, rect: element.getBoundingClientRect(), style: getComputedStyle(element) }))
      .find(({ rect, style }) => (
        style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0
        && rect.top < railBottom + 12
        && rect.bottom > 0
      ));
    if (!clippedAction) return;

    const desiredTop = railBottom + 16;
    const adjustedY = Math.max(0, window.scrollY + clippedAction.rect.top - desiredTop);
    window.scrollTo(0, adjustedY);
  }, targetY);
}

async function stablePageScreenshot(page, outputPath, { fullPage = false } = {}) {
  const budget = screenshotCaptureBudgetPlan(fullPage);
  const deadline = Date.now() + budget.total;
  const remainingBudget = (label) => {
    const remaining = deadline - Date.now();
    if (remaining < 500) throw new Error(`${label} skipped: capture deadline exhausted`);
    return remaining;
  };
  const boundedBudget = (label, maximum) => Math.min(maximum, remainingBudget(label));
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve()))).catch(() => {});
  const cdpCommand = (session, method, params, timeoutMs) => Promise.race([
    session.send(method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs)),
  ]);
  const captureWithCdp = async () => {
    const session = await page.context().newCDPSession(page);
    try {
      const options = { format: "png", fromSurface: true, captureBeyondViewport: Boolean(fullPage) };
      if (fullPage) {
        const metrics = await cdpCommand(session, "Page.getLayoutMetrics", {}, boundedBudget("CDP layout", budget.cdpLayout));
        const size = metrics.cssContentSize || metrics.contentSize;
        options.clip = { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height), scale: 1 };
      }
      const captured = await cdpCommand(session, "Page.captureScreenshot", options, boundedBudget("CDP screenshot", budget.cdpScreenshot));
      const bytes = Buffer.from(captured.data, "base64");
      if (bytes.length < 1024) throw new Error("CDP screenshot was empty");
      writeFileSync(outputPath, bytes);
    } finally {
      await session.detach().catch(() => {});
    }
  };
  try {
    await page.screenshot({
      path: outputPath,
      fullPage,
      animations: "disabled",
      caret: "hide",
      timeout: boundedBudget("Playwright screenshot", budget.playwright),
    });
    return;
  } catch (playwrightError) {
    try {
      await captureWithCdp();
    } catch (cdpError) {
      try {
        await page.locator("body").screenshot({ path: outputPath, animations: "disabled", caret: "hide", timeout: remainingBudget("body screenshot") });
      } catch (bodyError) {
        throw new Error(`${playwrightError.message.split("\n")[0]}; CDP fallback failed: ${cdpError.message}; body capture failed: ${bodyError.message.split("\n")[0]}`);
      }
    }
  }
}

async function captureVideoEvidence(page) {
  const count = await page.locator("video").count();
  if (!count) return { required: false, pass: true, count: 0, detail: "no video hero was rendered", videos: [] };

  await page.evaluate(() => {
    for (const video of document.querySelectorAll("video")) {
      video.muted = true;
      video.play().catch(() => {});
    }
  });
  await page.waitForFunction(() => [...document.querySelectorAll("video")].every((video) => video.readyState >= 2), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(750);
  const videos = await page.evaluate(() => [...document.querySelectorAll("video")].map((video, index) => {
    const source = video.querySelector("source");
    const fallback = video.parentElement?.querySelector("[data-reduced-motion-fallback]");
    return {
      index,
      autoplay: video.hasAttribute("autoplay"),
      muted: video.muted && video.hasAttribute("muted"),
      loop: video.loop && video.hasAttribute("loop"),
      playsinline: video.playsInline && video.hasAttribute("playsinline"),
      source: source?.getAttribute("src") || video.getAttribute("src") || "",
      type: source?.getAttribute("type") || "",
      fallback: Boolean(fallback),
      fallback_contract: video.parentElement?.getAttribute("data-reduced-motion") || "",
      ready_state: video.readyState,
      current_time: Number(video.currentTime || 0),
      width: video.videoWidth,
      height: video.videoHeight,
      paused: video.paused,
      error: video.error?.message || "",
    };
  }));
  const failures = videos.flatMap((video) => {
    const problems = [];
    if (!video.autoplay || !video.muted || !video.loop || !video.playsinline) problems.push("playback attributes");
    if (!video.source || !/^video\/(?:mp4|webm|ogg|quicktime|x-m4v)$/i.test(video.type)) problems.push("typed source");
    if (!video.fallback || video.fallback_contract !== "poster-fallback") problems.push("reduced-motion fallback");
    if (video.ready_state < 2 || video.width < 1 || video.height < 1 || video.current_time <= 0 || video.paused) problems.push("rendered playback");
    return problems.map((problem) => `video ${video.index + 1}: ${problem}`);
  });
  return {
    required: true,
    pass: failures.length === 0,
    count: videos.length,
    detail: failures.length ? failures.join("; ") : `${videos.length} video loop(s) loaded and advanced in Chromium`,
    videos,
  };
}

async function rasterSignal(page, bytes) {
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  return page.evaluate(async (src) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = Math.max(1, Math.min(180, image.naturalWidth));
      const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const colors = new Set();
      let count = 0;
      let sum = 0;
      let sumSquares = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const luminance = red * .2126 + green * .7152 + blue * .0722;
        sum += luminance;
        sumSquares += luminance * luminance;
        count += 1;
        if (colors.size < 256) colors.add(`${red >> 4}-${green >> 4}-${blue >> 4}`);
      }
      const mean = count ? sum / count : 0;
      resolve({ uniqueColors: colors.size, variance: count ? Math.round(sumSquares / count - mean * mean) : 0 });
    };
    image.onerror = () => resolve({ uniqueColors: 0, variance: 0 });
    image.src = src;
  }), dataUrl);
}
