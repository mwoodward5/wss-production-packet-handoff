"use strict";
const { decodePngToRgba } = require("../png-decode");

// lib/mirror-engine/brand-assets.js — content-addressed brand assets with
// SSRF defenses (change 4 of the pre-handler five).
//
// Byte-level idempotency is false while brand.logo is fetched from a mutable
// third-party URL at build time. Fix: fetch once, hash, carry the bytes into
// the build keyed by content hash; record logo_sha in the response and the
// manifest. The caller may pin logo_sha256 up front — mismatch is a hard
// brand_asset_rejected, never a soft fallback (a silently substituted wordmark
// would make the caller believe the engine honored the logo it was given).
//
// SSRF surface: this is a fetch-an-arbitrary-URL endpoint feature. Defenses:
// HTTPS only, DNS resolution checked against private/loopback/link-local
// ranges, redirects re-validated hop by hop, hard byte cap, content-sniffed
// MIME (never trust extension or Content-Type), third-party mark denylist on
// the final URL (Facebook blue is not a roofing company's brand).

const dns = require("node:dns").promises;
const net = require("node:net");
const { createHash } = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { isThirdPartyMark, decodeToRgba, decodeToRgb, rankColors, assignRoles, luminance, saturation, hexToHsl } = require("../capture-brand");
const { paletteFromLogo } = require("../logo-palette");

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15000;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd")) return true;
    if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7)); // v4-mapped
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function assertPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`ssrf: forbidden host ${host}`);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`ssrf: literal private address ${host}`);
    return;
  }
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new Error(`ssrf: ${host} does not resolve`);
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error(`ssrf: ${host} resolves to private address ${address}`);
  }
}

/** Magic-byte MIME sniff. Extension and Content-Type are attacker-controlled. */
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  const head = buf.toString("utf8", 0, Math.min(buf.length, 2048));
  if (/<svg[\s>]/i.test(head) && !/<script\b/i.test(head)) return { mime: "image/svg+xml", ext: "svg" };
  if (buf.length >= 6 && ["GIF87a", "GIF89a"].includes(buf.toString("ascii", 0, 6))) return { mime: "image/gif", ext: "gif" };
  return null;
}

/**
 * The one logo resolver refusal that means "there was no usable logo" rather
 * than "the supplied identity was false".  The lane may answer this exact
 * result with the frozen logo ladder.  Redirect denylist, provenance and hash
 * failures deliberately do not match.
 */
function isUnrecognizedLogoAssetFailure(result) {
  // A transport response is eligible only when the engine actually returned
  // its validation status.  Matching error text on a 500 is not proof that
  // the logo bytes alone caused the failure and must never erase the logo for
  // a retry.  Direct body objects remain supported for internal callers that
  // do not carry an HTTP wrapper.
  const hasHttpStatus = Boolean(
    result
    && typeof result === "object"
    && Object.prototype.hasOwnProperty.call(result, "status"),
  );
  if (hasHttpStatus && result.status !== 422) return false;
  const body = result && typeof result === "object" && result.body
    ? result.body
    : result;
  return Boolean(
    body
    && body.error === "brand_asset_rejected"
    && Array.isArray(body.detail)
    && body.detail.length === 1
    && body.detail[0]
    && body.detail[0].path === "/brand/logo"
    && body.detail[0].reason === "not_a_recognized_image",
  );
}

/**
 * A logo source whose domain is DEAD — it resolves to a private address (an
 * expired/parked domain pointed at a registrar or parking IP) or does not
 * resolve at all (NXDOMAIN) — has no logo to fetch. That is a "no usable
 * logo" downgrade, exactly like a URL serving non-image bytes, NOT a false
 * identity. The SSRF guard still refuses the fetch (assertPublicHost is
 * unchanged); this only classifies the resulting refusal so the lane can fall
 * back to the wordmark/monogram ladder instead of hard-failing the whole row.
 *
 * Deliberately narrow: only the two unambiguous dead-domain signals qualify.
 * "forbidden host" (localhost/.local/.internal), "literal private address",
 * "non-https URL", denylisted marks, redirect-to-foreign-mark, hash mismatch
 * and rendered-logo failures remain hard refusals.
 */
function isDeadDomainLogoFailure(result) {
  const hasHttpStatus = Boolean(
    result
    && typeof result === "object"
    && Object.prototype.hasOwnProperty.call(result, "status"),
  );
  if (hasHttpStatus && result.status !== 422) return false;
  const body = result && typeof result === "object" && result.body
    ? result.body
    : result;
  if (
    !body
    || body.error !== "brand_asset_rejected"
    || !Array.isArray(body.detail)
    || body.detail.length !== 1
    || !body.detail[0]
    || body.detail[0].path !== "/brand/logo"
  ) return false;
  const reason = String(body.detail[0].reason || "");
  return reason.startsWith("ssrf:")
    && (reason.includes("resolves to private address") || reason.includes("does not resolve"));
}

function normalizedPaletteHex(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "";
}

function normalizedPaletteSource(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    // A source page proves where the colour was observed; query strings and
    // fragments are tracking/session material, not render identity. Excluding
    // them keeps secrets out of the hash input and makes equivalent URLs stable.
    parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (parsed.port === "443") parsed.port = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

/**
 * Canonical identity of a verified origin URL that is written into the shipped
 * media manifest/bundle. Fragments never reach the server and credentials are
 * not accepted as durable public-media identity. Query strings are preserved:
 * signed/CDN query values can select different bytes even on the same path.
 */
function normalizedOriginPhotoUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (parsed.port === "443") parsed.port = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function originPhotoUrlsHash(photos = []) {
  const urls = (Array.isArray(photos) ? photos : [])
    .filter((photo) => photo && photo.ok === true)
    .map((photo) => normalizedOriginPhotoUrl(photo.originUrl))
    .filter(Boolean);
  return urls.length
    ? createHash("sha256").update(JSON.stringify({ schema: "origin-photo-urls@v1", urls })).digest("hex")
    : "";
}

function originVideoUrlHash(value) {
  const url = normalizedOriginPhotoUrl(value);
  return url
    ? createHash("sha256").update(JSON.stringify({ schema: "origin-hero-video-url@v1", url })).digest("hex")
    : "";
}

function sourcePacketHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const contract = String(value.contract || "").trim();
  const packetId = String(value.packet_id || "").trim().toLowerCase();
  const snapshotSha256 = String(value.snapshot_sha256 || "").trim().toLowerCase();
  if (contract !== "pagehub-build-packet"
    || !/^pagehub:[0-9a-f]{24}$/.test(packetId)
    || !/^[0-9a-f]{64}$/.test(snapshotSha256)
    || packetId !== `pagehub:${snapshotSha256.slice(0, 24)}`) return "";
  return createHash("sha256").update(JSON.stringify({
    schema: "brand-source-packet@v1",
    contract,
    packet_id: packetId,
    snapshot_sha256: snapshotSha256,
  })).digest("hex");
}

function photoBankHash(value) {
  const rows = value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.photos)
    ? value.photos
    : [];
  const photos = rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const url = normalizedOriginPhotoUrl(row.url);
    const sha256 = /^[0-9a-f]{64}$/i.test(String(row.sha256 || "").trim())
      ? String(row.sha256).trim().toLowerCase()
      : "";
    if (!url && !sha256) return [];
    const width = Number(row.width);
    const height = Number(row.height);
    return [{
      url,
      sha256,
      grade: ["hero", "gallery", "thumbnail"].includes(String(row.grade || "")) ? String(row.grade) : "",
      // pickHeroPhoto compares this literal; preserve case rather than making
      // two render-different inputs hash-equivalent.
      source: String(row.source || "").trim(),
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
      current_hero: Boolean(row.current_hero),
      identity_critical: Boolean(row.identity_critical),
      stock_caption_suspect: Boolean(row.stock_caption_suspect),
    }];
  });
  return photos.length
    ? createHash("sha256").update(JSON.stringify({ schema: "render-photo-bank@v1", photos })).digest("hex")
    : "";
}

function paletteHashInput(brand, out) {
  const siteAccent = normalizedPaletteHex(brand.site_accent);
  const siteAccentSource = normalizedPaletteSource(brand.site_accent_source);
  const normalized = {
    accent: normalizedPaletteHex(out.accent),
    primary: normalizedPaletteHex(out.primary),
    secondary_accent: normalizedPaletteHex(out.secondary_accent),
    site_accent: siteAccent && siteAccentSource ? siteAccent : "",
    site_accent_source: siteAccent && siteAccentSource ? siteAccentSource : "",
    accent_source: normalizedPaletteSource(brand.accent_source),
    accent_fallback_source: normalizedPaletteSource(brand.accent_fallback_source),
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

/**
 * SSRF-guarded fetch of one https URL with hop-by-hop redirect validation and
 * a byte cap. Returns { bytes, finalUrl }.
 */
async function guardedFetch(url) {
  let current = new URL(String(url));
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:") throw new Error(`ssrf: non-https URL ${current.href}`);
    await assertPublicHost(current.hostname);
    const res = await fetch(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (wss-mirror-engine brand fetch)" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`redirect without location from ${current.href}`);
      current = new URL(loc, current); // next hop re-validated at loop top
      continue;
    }
    if (!res.ok) throw new Error(`brand asset fetch ${res.status} from ${current.href}`);
    const lenHeader = Number(res.headers.get("content-length") || 0);
    if (lenHeader > MAX_BYTES) throw new Error(`brand asset exceeds ${MAX_BYTES} bytes (declared)`);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`brand asset exceeds ${MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return { bytes: Buffer.concat(chunks), finalUrl: current.href };
  }
  throw new Error(`too many redirects fetching ${url}`);
}

/**
 * Resolve the brand block into content-addressed assets.
 *
 * Returns { ok:true, mediaMode: "origin"|"housed",
 *           logo: {bytes, sha256, ext, mime, sourceUrl} | null,
 *           accent: "#rrggbb" | null, hashes: {logo_sha} }
 * or { ok:false, error:"brand_asset_rejected", detail }.
 *
 * Denylisted logo / accent_source is a HARD FAIL, not a wordmark fallback.
 * Denylisted accent_fallback_source / site_accent_source is ABSTENTION: the
 * fallback colour and its source are dropped (recorded in
 * dropped_colour_sources) and the build continues, because those fields only
 * fill a hole the logo measurement left — unprovable provenance means "no
 * measured site colour", never a dead build.
 */
async function resolveBrandAssets(brand = {}) {
  const detail = [];
  const out = { logo: null, accent: null, primary: null, hashes: {} };
  // HOTLINK-UNTIL-PAY (docs/standards/hotlink-until-pay.md). media_mode:"origin"
  // ships the prospect's OWN media as verified origin URLs instead of housed
  // bytes: the fetch, sniff and sha256 all still happen ONCE here (the truth law
  // is unchanged — a URL is only ever recorded for bytes we actually fetched and
  // hashed), but the photo/video entries carry {url, sha256, ext, mime} and no
  // bytes, so an unpaid prospect's build stores zero of their media. The LOGO
  // keeps its bytes in both modes: the accent measurement, favicon pass and the
  // logo_own_and_unique gate all read the bytes, and a logo is a few KB — the
  // cost this mode exists to avoid is their photo/video library, not their mark.
  // Default "housed" is exactly today's behaviour.
  const mediaMode = String(brand.media_mode || "").trim().toLowerCase() === "origin" ? "origin" : "housed";
  out.mediaMode = mediaMode;
  // Origin mode writes URLs while housed mode writes bytes. The same verified
  // photo SHA therefore produces different output in the two modes and must
  // never hit the same build memo entry.
  out.hashes.media_mode_sha = createHash("sha256")
    .update(JSON.stringify({ schema: "brand-media-mode@v1", media_mode: mediaMode }))
    .digest("hex");
  const sourcePacketSha = sourcePacketHash(brand.source_packet);
  if (sourcePacketSha) out.hashes.source_packet_sha = sourcePacketSha;
  // The bank does not add bytes, but its ordered flags decide which verified
  // photo becomes the hero wash and which becomes the full-contrast identity
  // band. The same photo SHAs with different ranking/flags are different sites.
  const photoBankSha = photoBankHash(brand.photo_bank);
  if (photoBankSha) out.hashes.photo_bank_sha = photoBankSha;
  // The client's SECOND brand colour (surfaces). Validated the same way as the
  // accent: a literal 6-digit hex or nothing at all.
  if (/^#[0-9a-f]{6}$/i.test(String(brand.primary || "").trim())) {
    out.primary = String(brand.primary).trim();
  }

  // The client's TYPEFACE, captured from their own site by lib/font-capture and
  // carried through untouched. A mirror in their logo and their colours set in
  // the donor's serif still reads as a template — the headline face is the part
  // a person notices. Absent means "we could not identify one", and the donor's
  // own typography stays rather than being replaced by a guess.
  if (brand.fonts && typeof brand.fonts === "object") {
    const display = String(brand.fonts.display || "").trim();
    const body = String(brand.fonts.body || "").trim();
    const href = String(brand.fonts.href || "").trim();
    if (display || body) {
      out.fonts = {
        ...(display ? { display } : {}),
        ...(body ? { body } : {}),
        ...(/^https:\/\/fonts\.googleapis\.com\//i.test(href) ? { href } : {}),
        provider: String(brand.fonts.provider || "") || "declared",
      };
      // Typography changes rendered CSS bytes, so the normalized fields that
      // drive that rewrite must participate in the engine's build hash. Keep
      // provider out: it is provenance metadata and does not change output.
      out.hashes.fonts_sha = createHash("sha256").update(JSON.stringify({
        display: out.fonts.display || "",
        body: out.fonts.body || "",
        href: out.fonts.href || "",
      })).digest("hex");
    }
  }

  // The contract-frozen logo ladder records the deliberate non-logo rung on
  // brand.mark. Carry it through beside fonts so the engine can distinguish a
  // chosen wordmark/monogram from a logo that was fetched but failed to render.
  // This never masks a bad logo: the denylist and fetch/hash failures below
  // remain hard failures whenever brand.logo was supplied.
  if (brand.mark && typeof brand.mark === "object" && !Array.isArray(brand.mark)) {
    const rung = String(brand.mark.rung || "").trim();
    const reason = String(brand.mark.reason || "").trim();
    const value = brand.mark.value;
    if (value && typeof value === "object" && !Array.isArray(value) && reason) {
      if (
        rung === "wordmark"
        && value.type === "wordmark"
        && String(value.text || "").trim()
        && /^(?:#[0-9a-f]{6})?$/i.test(String(value.color ?? ""))
      ) {
        out.mark = {
          rung,
          value: { type: "wordmark", text: String(value.text).trim(), color: String(value.color ?? "") },
          reason,
        };
      } else if (
        rung === "monogram"
        && value.type === "monogram"
        && String(value.initials || "").trim()
        && /^(?:#[0-9a-f]{6})?$/i.test(String(value.color ?? ""))
        && typeof value.background === "string"
      ) {
        out.mark = {
          rung,
          value: {
            type: "monogram",
            initials: String(value.initials).trim(),
            color: String(value.color ?? ""),
            background: value.background,
          },
          reason,
        };
      } else if (rung === "donor_default" && value.type === "donor_default") {
        out.mark = { rung, value: { type: "donor_default" }, reason };
      }
    }
    if (out.mark) {
      // brandOut.hashes already participates in the canonical build hash. Bind
      // the normalized fallback mark too, so changing its text/colour/rung can
      // never replay a memo for different rendered identity.
      out.hashes.mark_sha = createHash("sha256").update(JSON.stringify(out.mark)).digest("hex");
    }
  }

  // Denylist runs on the URL path basename BEFORE any fetch.
  //
  // A denylisted LOGO or accent_source stays a HARD FAIL — a third-party mark
  // must never ship as the client's identity, and a colour whose claimed
  // provenance page is denylisted must never ship as its palette either.
  //
  // The two colour-FALLBACK provenance fields are different in kind, and the
  // hard fail here is what killed a real build (measured 2026-08-31: a Phoenix
  // prospect died 422 brand_asset_rejected with BOTH /brand/accent_fallback_source
  // and /brand/site_accent_source denylisted — the lane fills both with the
  // prospect's own final URL, so any page the miner can land on that matches a
  // denylisted mark, a social-profile redirect or a platform host included,
  // refused the whole build). Those fields only ever FILL A HOLE the logo
  // measurement left, so the honest answer to unprovable provenance is
  // ABSTENTION — drop the fallback colour and its source, record the drop, and
  // let the build continue exactly as if the prospect had no measured site
  // colour. The fallback path exists precisely for missing data; it must
  // never 422.
  for (const [field, url] of [["logo", brand.logo], ["accent_source", brand.accent_source]]) {
    if (!url) continue;
    let probe = "";
    try {
      const u = new URL(url);
      // Match the HOST + path, not the basename alone and NOT the query. A
      // Facebook tracking pixel (facebook.com/tr?id=…) is caught by the host
      // test; the query is excluded because client-side params like
      // ?utm_source=google made a client's OWN homepage read as a third-party
      // "google" mark (path.basename saw the query) and falsely rejected the
      // build. The host + basename tests carry the whole denylist purpose.
      probe = decodeURIComponent(`${u.hostname}${u.pathname}`);
    } catch {
      detail.push({ path: `/brand/${field}`, reason: "unparseable_url", value: url });
      continue;
    }
    if (isThirdPartyMark(probe)) {
      detail.push({ path: `/brand/${field}`, reason: "third_party_mark_denylisted", value: probe.slice(0, 120) });
    }
  }
  const droppedColourSources = [];
  for (const [field, colourKey] of [["accent_fallback_source", "accent_fallback"], ["site_accent_source", "site_accent"]]) {
    const url = brand[field];
    if (!url) continue;
    let probe = "";
    try {
      probe = decodeURIComponent(`${new URL(url).hostname}${new URL(url).pathname}`);
    } catch {
      detail.push({ path: `/brand/${field}`, reason: "unparseable_url", value: url });
      continue;
    }
    if (isThirdPartyMark(probe)) {
      droppedColourSources.push({ path: `/brand/${field}`, reason: "third_party_mark_denylisted_colour_dropped", value: probe.slice(0, 120) });
      // Local rebind, not a mutation: the caller's request object keeps its
      // fields, and every later read here (fallback fill, site-chrome
      // arbitration, palette hash) sees the colour abstain.
      brand = { ...brand, [field]: "", [colourKey]: "" };
    }
  }
  if (droppedColourSources.length) out.dropped_colour_sources = droppedColourSources;
  if (detail.length) return { ok: false, error: "brand_asset_rejected", detail };

  if (brand.logo) {
    let fetched;
    try {
      fetched = await guardedFetch(brand.logo);
    } catch (e) {
      return { ok: false, error: "brand_asset_rejected", detail: [{ path: "/brand/logo", reason: String(e.message || e) }] };
    }
    // Re-run the denylist on the FINAL post-redirect URL (host + path, no
    // query, for the same reason as the pre-fetch probe).
    const finalUrl = new URL(fetched.finalUrl);
    const finalProbe = decodeURIComponent(`${finalUrl.hostname}${finalUrl.pathname}`);
    if (isThirdPartyMark(finalProbe)) {
      return { ok: false, error: "brand_asset_rejected", detail: [{ path: "/brand/logo", reason: "third_party_mark_denylisted_after_redirect", value: finalProbe.slice(0, 120) }] };
    }
    const sniffed = sniffImage(fetched.bytes);
    if (!sniffed) {
      return { ok: false, error: "brand_asset_rejected", detail: [{ path: "/brand/logo", reason: "not_a_recognized_image" }] };
    }
    const sha256 = createHash("sha256").update(fetched.bytes).digest("hex");
    if (brand.logo_sha256 && brand.logo_sha256 !== sha256) {
      return {
        ok: false, error: "brand_asset_rejected",
        detail: [{ path: "/brand/logo_sha256", reason: "content_hash_mismatch", expected: brand.logo_sha256, actual: sha256 }],
      };
    }
    out.logo = { bytes: fetched.bytes, sha256, ext: sniffed.ext, mime: sniffed.mime, sourceUrl: fetched.finalUrl };
    out.hashes.logo_sha = sha256;
  }

  // THE LOGO OUTRANKS THE SCRAPE. RiverCity proved why: their logo.svg holds
  // exactly #094463 + #1B7D9F (blue/teal), yet the harvester supplied accent
  // #E67E22 — an orange lifted from a CTA button on their page. The owner's
  // standing directive is "the palette MUST come from the logo's colors", so
  // when the logo is an SVG (colours declared as text — exact, no sampling)
  // its palette overrides whatever the caller scraped.
  if (out.logo && out.logo.ext === "svg") {
    const fromLogo = paletteFromLogo({ bytes: out.logo.bytes, contentType: out.logo.mime, url: out.logo.sourceUrl });
    if (fromLogo) {
      out.accent = fromLogo.accent;
      out.accent_origin = "declared_in_logo_svg";
      out.primary = fromLogo.primary;
      out.primary_origin = "declared_in_logo_svg";
      out.palette = fromLogo.colors;
    }
  }
  if (out.accent) {
    // set from the logo above — the scrape does not overwrite it
  } else if (brand.accent) {
    out.accent = brand.accent;
    out.accent_origin = "caller_supplied";
  } else if (out.logo) {
    // MEASURE the accent from the logo bytes we just fetched. Without this the
    // brand gate is unsatisfiable by the pipe alone: resolveBrandAssets only
    // passed an accent through, and from-genie deliberately supplies none, so
    // every Genie-driven build 422'd brand_required unless a human measured a
    // colour by hand. The engine owns measurement now — nothing is guessed,
    // and an unmeasurable logo still yields null (never a fallback hue).
    const measured = await measureAccent(out.logo.bytes, out.logo.ext);
    if (measured) {
      out.accent = measured.hex;
      out.accent_origin = `measured_from_logo(${measured.method}, share ${measured.share.toFixed(2)})`;
      out.palette = measured.palette;
    } else if (brand.accent_fallback) {
      // THE COLOUR THE MINER ALREADY PROVED, used ONLY when this runtime cannot
      // decode the bytes for itself.
      //
      // measureAccent decodes PNG in pure JS and shells out to ffmpeg for
      // everything else — and ffmpeg is not in the serverless runtime (this
      // file says so 80 lines down). So a JPEG or WebP mark measures null here
      // however good it is. Just Air LLC is the measured case: their record
      // already carried mirror_request.brand.accent = "#0c449a", measured from
      // the very same JPEG and ownership-gated by ownsLogo, the third-party
      // denylist and a magic-byte sniff — and the build threw it away, came
      // back accent:null, and the engine refused the whole mirror as
      // brand=unbranded for a colour that was sitting on the record.
      //
      // A SEPARATE KEY, deliberately. `brand.accent` above still OVERRIDES
      // measurement, which is what the from-genie and hand-driven callers rely
      // on; this one can only ever fill a hole measurement left. Nothing that
      // measures today changes behaviour, and an absent fallback still yields
      // null rather than a donor hue (TRUTH LAW).
      out.accent = brand.accent_fallback;
      out.accent_origin = "measured_by_miner_from_same_logo";
    } else {
      out.accent_origin = "unmeasurable";
    }
  }

  // THE LOGO'S SECOND COLOUR.
  //
  // A raster logo's full palette was measured and then thrown away: `primary`
  // was only ever set on the SVG path, so for every PNG/JPG mark the surface
  // and literal-hue passes ran with nothing and the donor kept its own second
  // colour. M & M Heating's mark is red AND blue; the mirror took the blue and
  // left the donor's gold everywhere else.
  //
  // The second colour is the highest-ranked palette entry that is genuinely a
  // DIFFERENT hue from the accent — not a lighter tint of it, which would just
  // repaint the page one colour.
  if (!out.primary && out.accent && Array.isArray(out.palette) && out.palette.length > 1) {
    const hueOf = (hex) => {
      const h = hexToHsl(hex);
      return h ? h : null;
    };
    const a = hueOf(out.accent);
    if (a) {
      const second = out.palette.find((hex) => {
        if (!hex || hex.toLowerCase() === String(out.accent).toLowerCase()) return false;
        const c = hueOf(hex);
        if (!c || c.s < 25) return false;                 // a neutral is not a brand colour
        // `delta` IS the circular hue distance: ((diff+540)%360)-180 maps the
        // difference into [-180,180) and abs() folds it. The first version
        // compared `180 - delta >= 40`, which ACCEPTS a same-hue tint
        // (delta 0 -> 180) and REFUSES red-vs-blue (delta 150 -> 30) — the
        // exact inversion of its own comment. Verified numerically 2026-08-12:
        // #C53F34 vs #0B5CAB measures delta 155.
        const delta = Math.abs(((c.h - a.h + 540) % 360) - 180);
        return delta >= 40;                                // a real hue apart, not a tint
      });
      if (second) {
        out.primary = second;
        out.primary_origin = "measured_from_logo(second_hue)";
      }
    }
  }

  // THE MIRROR WEARS WHAT THEIR SITE WEARS.
  //
  // THE INCIDENT (owner, 2026-08-12): Family Heating's own site is
  // blue-dominant, their logo contains a red, and the mirror opened
  // pinkish-red — "he is clearly more of a blue and off blue." The logo is the
  // sharper instrument for WHICH EXACT SHADE of a colour family the brand uses
  // (that is why it still outranks a scrape of the same hue), but when the
  // site's chrome and the logo genuinely disagree — different hue families,
  // both saturated — the site is the better witness for which family the
  // business actually dresses in. Their site is the outfit; the logo is the
  // lapel pin.
  //
  // brand.site_accent is the design brief's measured ACTION colour (computed
  // styles of their real buttons/links, deterministic, saturation-floored).
  // Decision rule, recorded in accent_decision either way:
  //   · no logo colour            -> site accent fills (origin site_chrome_only)
  //   · same hue family (<40°)    -> logo keeps the accent (sharper measurement
  //                                  of the same colour); no change
  //   · different families (>=40°, both >=25% saturation)
  //                               -> site accent becomes THE accent; the logo's
  //                                  colour steps down to secondary_accent, the
  //                                  donor's declared secondary PAINT role
  //                                  (applySecondaryToCss) — NOT brand.primary,
  //                                  because primary drives the page-wide
  //                                  surface tint and would repaint the paper
  //                                  in exactly the hue the owner just refused.
  // Contrast law is untouched: theme.buildThemePair enforces it over whichever
  // colour wins, exactly as before.
  {
    const SITE_MIN_SAT = 25;   // a neutral site chrome never dethrones a logo
    const HUE_FAMILY_GAP = 40; // same threshold the second-hue rule uses
    const site = /^#[0-9a-f]{6}$/i.test(String(brand.site_accent || "").trim())
      && /^https:\/\//i.test(String(brand.site_accent_source || ""))
      ? String(brand.site_accent).trim().toUpperCase() : "";
    if (site) {
      const s = hexToHsl(site);
      if (!out.accent) {
        if (s && s.s >= SITE_MIN_SAT) {
          out.accent = site;
          out.accent_origin = "site_chrome(no_logo_colour_measured)";
          out.accent_decision = {
            winner: "site_chrome", site, logo: null, hue_gap: null,
            why: "no colour could be measured from the logo; the site's own action colour is the only witness",
          };
        }
      } else {
        const a = hexToHsl(out.accent);
        // Circular hue distance, 0..180 — see the second-hue rule above for
        // why the folded form is the right one.
        const hueGap = s && a
          ? Math.abs(((s.h - a.h + 540) % 360) - 180)
          : null;
        const disagree = s && a && s.s >= SITE_MIN_SAT
          && (a.s < SITE_MIN_SAT || hueGap >= HUE_FAMILY_GAP);
        if (disagree) {
          const logoColour = out.accent;
          const logoOrigin = out.accent_origin || "unknown";
          // The demoted logo colour keeps a visible job ONLY if it is a real
          // brand colour itself; a near-neutral just steps aside.
          if (a.s >= SITE_MIN_SAT) {
            out.secondary_accent = logoColour;
            out.secondary_accent_origin = `demoted_logo_accent(${logoOrigin})`;
          }
          out.accent = site;
          out.accent_origin = `site_chrome_over_logo(site ${site} vs logo ${logoColour}, hue_gap ${hueGap}°)`;
          out.accent_decision = {
            winner: "site_chrome", site, logo: logoColour, hue_gap: hueGap,
            why: a.s < SITE_MIN_SAT
              ? `logo colour ${logoColour} is near-neutral (${a.s}% sat); the site's chrome is the brand`
              : `their site wears ${site}, the logo's dominant colour ${logoColour} is a different hue family (${hueGap}° apart) — the site chrome wins primary, the logo colour becomes the secondary paint role`,
          };
        } else {
          out.accent_decision = {
            winner: "logo", site, logo: out.accent, hue_gap: hueGap,
            why: !s || s.s < SITE_MIN_SAT
              ? `site chrome ${site} is near-neutral; the logo's colour stands`
              : `site chrome ${site} and logo colour ${out.accent} are the same hue family (${hueGap}° apart); the logo is the sharper measurement of the same colour`,
          };
        }
      }
    }
  }

  // Colour choices change CSS, favicons and signed release evidence. Bind the
  // normalized final palette and its accepted first-party source pages into the
  // same brand hash set used by buildHash. Fixed keys + upper-case hex make
  // object key order and case-equivalent colour inputs deterministic.
  const paletteIdentity = paletteHashInput(brand, out);
  if (paletteIdentity) {
    out.hashes.palette_sha = createHash("sha256")
      .update(JSON.stringify(paletteIdentity))
      .digest("hex");
  }

  // Prospect's own photos — the "unique image pull". Same defenses as the
  // logo (denylist, SSRF, sniff, content-address). A photo that fails any
  // gate is SKIPPED (the donor's generic imagery is a safe fallback), never
  // silently substituted with someone else's picture.
  //
  // In media_mode:"origin" the entry carries the VERIFIED URL (the final,
  // post-redirect href — the one that actually served the hashed bytes) and no
  // bytes: the engine writes a URL manifest instead of placing files. `url`
  // stays the ORIGINAL request URL because it is the join key the photo bank
  // and identity-band pickers match on; `originUrl` is what ships.
  out.photos = [];
  for (const url of brand.photos || []) {
    try {
      const u = new URL(url);
      const probe = decodeURIComponent(`${u.hostname}${u.pathname}`);
      if (isThirdPartyMark(probe)) { out.photos.push({ url, ok: false, reason: "third_party_mark" }); continue; }
      const fetched = await guardedFetch(url);
      const sniffed = sniffImage(fetched.bytes);
      if (!sniffed || sniffed.ext === "svg") { out.photos.push({ url, ok: false, reason: "not_a_photo" }); continue; }
      const sha256 = createHash("sha256").update(fetched.bytes).digest("hex");
      if (mediaMode === "origin") {
        out.photos.push({ url, ok: true, originUrl: fetched.finalUrl || url, sha256, ext: sniffed.ext, mime: sniffed.mime });
      } else {
        out.photos.push({ url, ok: true, bytes: fetched.bytes, sha256, ext: sniffed.ext, mime: sniffed.mime });
      }
    } catch (e) {
      out.photos.push({ url, ok: false, reason: String(e.message || e).slice(0, 120) });
    }
  }
  const placedShas = out.photos.filter((p) => p.ok).map((p) => p.sha256);
  if (placedShas.length) out.hashes.photos_sha = placedShas;
  if (mediaMode === "origin") {
    const originUrlsSha = originPhotoUrlsHash(out.photos);
    if (originUrlsSha) out.hashes.origin_photo_urls_sha = originUrlsSha;
  }

  // Prospect's own hero/background video — the live-video hero rung. Same
  // defenses as their photos: denylist, guarded fetch, MAGIC-BYTE sniff (a
  // <video src> that 404s into an HTML error page must never ship as a clip).
  // A video that fails any gate is SKIPPED — the donor's ladder falls to its
  // next rung; we never borrow another trade's footage.
  out.heroVideo = null;
  if (brand.hero_video && brand.hero_video.url) {
    try {
      const u = new URL(brand.hero_video.url);
      const probe = decodeURIComponent(`${u.hostname}${u.pathname}`);
      if (isThirdPartyMark(probe)) {
        out.heroVideo = { ok: false, reason: "third_party_mark" };
      } else {
        const fetched = await guardedFetch(brand.hero_video.url);
        const b = fetched.bytes;
        const isMp4 = b && b.length > 12 && b.slice(4, 8).toString("latin1") === "ftyp";
        const isWebm = b && b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
        if (!isMp4 && !isWebm) {
          out.heroVideo = { ok: false, reason: "not_a_video" };
        } else {
          const sha256 = createHash("sha256").update(b).digest("hex");
          out.heroVideo = {
            ok: true, sha256,
            // origin mode ships the verified URL in the manifest, not the
            // bytes; the donor's hero ladder stays on the WSS-owned clip until
            // the paid migration houses this one into the slot.
            ...(mediaMode === "origin" ? {} : { bytes: b }),
            ext: isMp4 ? "mp4" : "webm",
            mime: isMp4 ? "video/mp4" : "video/webm",
            sourceUrl: fetched.finalUrl || brand.hero_video.url,
          };
          out.hashes.hero_video = sha256;
          if (mediaMode === "origin") {
            const originUrlSha = originVideoUrlHash(out.heroVideo.sourceUrl);
            if (originUrlSha) out.hashes.origin_video_url_sha = originUrlSha;
          }
        }
      }
    } catch (e) {
      out.heroVideo = { ok: false, reason: String(e.message || e).slice(0, 120) };
    }
  }

  return { ok: true, ...out };
}

/**
 * Measure a brand accent from logo bytes.
 *
 * RGBA first so transparent pixels cannot vote (the bug that read #48704b
 * green out of logos containing no green). Then the sanity rule that saved
 * every case in the five-prospect run: the winner must actually look like a
 * brand colour — saturation >= 0.35 and luminance in [0.15, 0.85]. If the
 * top-ranked colour fails, walk the ranked palette for the first that passes.
 * Nothing qualifying -> null, and the caller decides (never a fallback hue).
 */
async function measureAccent(bytes, ext = "png") {
  const tmp = path.join(os.tmpdir(), `wss-accent-${createHash("sha1").update(bytes).digest("hex").slice(0, 12)}.${ext}`);
  try {
    fs.writeFileSync(tmp, bytes);
    let ranked = [];
    let method = "png-js";

    // PURE-JS PNG FIRST. Everything below this shells out to ffmpeg, which is on
    // a developer machine and is NOT in the serverless runtime — and no image
    // decoder is a dependency. So in production every decode failed and
    // measureAccent returned null for EVERY logo, which the miner reported as
    // `accent_unmeasurable` and we read as "this logo is greyscale". Measured
    // 2026-08-01: whitebirdfence.com's mark is #f78f1e at 63% share locally and
    // was rejected in production. Same shape as Chromium-in-a-lambda: a binary
    // that exists where we test and never where we run.
    try {
      const img = decodePngToRgba(bytes);
      if (img) ranked = rankColors(img.data, { channels: 4 });
    } catch {
      ranked = [];
    }

    if (!ranked.length) {
      method = "rgba";
      try {
        ranked = rankColors(await decodeToRgba(tmp), { channels: 4 });
      } catch {
        ranked = [];
      }
    }
    if (!ranked.length) {
      method = "rgb";
      try { ranked = rankColors(await decodeToRgb(tmp)); } catch { ranked = []; }
    }
    if (!ranked.length) return null;
    const plausible = ranked.find((c) => {
      const lum = luminance(c.r, c.g, c.b);
      return saturation(c.r, c.g, c.b) >= 0.35 && lum >= 0.15 && lum <= 0.85;
    });
    const pick = plausible || null;
    if (!pick) return null;
    return {
      hex: pick.hex,
      share: pick.share,
      method: plausible === ranked[0] ? method : `${method}+sanity-fallback`,
      palette: assignRoles(ranked).palette,
    };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* temp cleanup is best effort */ }
  }
}

/**
 * Transcode a photo to the format a donor slot requires.
 *
 * Slot filling used to demand an exact extension match, so a business whose
 * photos are all .webp filled zero .jpg slots — 7 of 8 real photos uploaded
 * and invisible. Vercel serves content-type by extension, so the bytes must
 * genuinely match the slot; ffmpeg converts rather than mislabels. Returns
 * null on failure and the caller simply skips the slot (donor imagery stays).
 */
async function transcodePhoto(bytes, fromExt, toExt) {
  const target = String(toExt).toLowerCase().replace("jpeg", "jpg");
  if (String(fromExt).toLowerCase().replace("jpeg", "jpg") === target) return bytes;
  const stamp = createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  const src = path.join(os.tmpdir(), `wss-photo-${stamp}.${fromExt}`);
  const dst = path.join(os.tmpdir(), `wss-photo-${stamp}.${target}`);
  try {
    fs.writeFileSync(src, bytes);
    await new Promise((resolve, reject) => {
      const args = ["-v", "error", "-y", "-i", src];
      if (target === "jpg") args.push("-q:v", "3");
      else if (target === "webp") args.push("-quality", "82");
      else if (target === "png") args.push("-compression_level", "6");
      args.push(dst);
      execFile("ffmpeg", args, { encoding: "buffer", maxBuffer: 96 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
    });
    const out = fs.readFileSync(dst);
    return out && out.length ? out : null;
  } catch {
    return null;
  } finally {
    for (const f of [src, dst]) { try { fs.unlinkSync(f); } catch { /* best effort */ } }
  }
}

module.exports = {
  resolveBrandAssets,
  measureAccent,
  transcodePhoto,
  guardedFetch,
  assertPublicHost,
  isPrivateIp,
  sniffImage,
  isUnrecognizedLogoAssetFailure,
  isDeadDomainLogoFailure,
  normalizedOriginPhotoUrl,
  originPhotoUrlsHash,
  originVideoUrlHash,
  sourcePacketHash,
  photoBankHash,
  MAX_BYTES,
};
