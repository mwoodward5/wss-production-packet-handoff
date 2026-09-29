"use strict";

// lib/line-proof-shots.js — the line's own before/after capture.
//
// The email's visuals gate is fail-closed: no before/after screenshots on the
// prospect, no send ("no_before_after_visuals" killed the first two sandbox
// batches that ever cleared the owner-lock). scripts/capture-proof-shots.js
// solved capture for hand-run batches; nothing wired it into the operator
// line, so every line send arrived at the gate empty-handed.
//
// Same rules as the script, unchanged:
//   · the object key derives from the URL we MEANT to shoot; the sidecar meta
//     records where the browser actually LANDED
//   · an "old" shot that landed off the prospect's own registrable domain is
//     REFUSED, not stored — a stored mismatch is a loaded gun for every later
//     send ("YOUR SITE TODAY" captioning a stranger's homepage)
//   · already-stored objects are kept (content-addressed keys make re-capture
//     a no-op, and the line may retry a batch)
//
// Chromium comes from lib/serverless-chromium, so this works on Vercel too —
// the same launcher the render gates use.
//
// ---------------------------------------------------------------------------
// WHOSE BROWSER, AND WHICH BUILD (2026-08-08)
// ---------------------------------------------------------------------------
// This used to launch its own chromium on the SEND path, once per prospect.
// Measured on the queued rows, that is 28–35s per send and 90s+ at the tail
// (dripfixplumbingde.com took 41,208ms — 1.7% under the 45s networkidle
// timeout — and it is shot twice, desktop and mobile). Against the send route's
// 210s budget that is six or seven sends per invocation, which is the ceiling
// the whole line hits at fifty a day.
//
// The render gate ALREADY has a browser open on this mirror. So capture takes
// one now: `browser` is injectable, and the caller that owns the browser keeps
// it — this closes only what it opened.
//
// And the shots are keyed to the BUILD, not just the URL. The object key is
// derived from the URL, which does not change when we rebuild, so "is this
// picture current?" had no answer and the only safe policy was to re-shoot our
// own mirror on every single send. The sidecar now records the build_hash the
// picture is OF, so an unchanged build reuses its shots (and its pixel digest,
// which the email needs to cache-bust) and a rebuilt one is re-shot. No
// build_hash supplied ⇒ no reuse, which is exactly the behaviour that was here
// before.

const {
  proofObjectPath,
  proofMetaPath,
  uploadProofShot,
  fetchProofShot,
  capturedShotBelongsTo,
  registrableDomain,
  normalizeProofIdentity,
  urlForVariant,
  publicProofUrl,
  suppressOurPanelsUrl,
} = require("./proof-storage");
const { launchChromium } = require("./serverless-chromium");
const { isApprovedPreviewUrl, previewHostOf } = require("./preview-host-guard");
const { createHash } = require("node:crypto");

const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
});

// ---------------------------------------------------------------------------
// VIDEO-HERO MIRRORS: MEDIA MAY NOT GATE THE AFTER SHOT (2026-09-02)
// ---------------------------------------------------------------------------
// Two landscaping rows (batch line_mtkw4rlq_c830312fdd — Gras Lawn, Landscape
// Improvements) were gate_passed with LIVE mirrors and still died on
// capture_incomplete:no_after_shot, every retry. Their donors ship 2–3MB hero
// MP4s, and this file's AFTER capture waited for networkidle: the clip kept
// the network busy past every timeout, the fallback RE-NAVIGATED with waitUntil
// "load" (which Chrome itself delays until the media's metadata arrives — a
// non-web-optimized MP4 only yields metadata after the whole file), and both
// attempts blew the budget the same way, deterministically. The BEFORE shot of
// the prospect's own site never had the problem; only OUR mirror did.
//
// The mirrors are DESIGNED to look right without the clip playing: the marked
// hero video paints its own hero colour/photograph beneath any frame, and the
// donor walker (plus the engine-side fail-safe net) hides a video whose source
// errors within ~1.5s so the site's own hero shows. So for OUR mirror the
// capture now (a) refuses to let media download at all — route interception
// aborts video/audio requests, and prefers-reduced-motion is emulated — and
// (b) waits for domcontentloaded plus a paint check (eager images settled,
// then two animation frames) instead of a network quiet that a streaming clip
// never grants.
//
// THE SAME PAINT CHECK NOW GATES THE BEFORE SHOT (2026-09-03). Phone/before
// shots were arriving GRAY/BLANK in the emails: the before lane's only paint
// strategy was a FIXED 1200ms settle on the far side of networkidle (or its
// "load" fallback — which fires before JS-rendered builders like Wix and
// Squarespace have painted a single pixel of content), and a slow-hydrating
// page was photographed mid-blank. The before lane keeps everything that made
// it honest about a STRANGER'S page — networkidle then load, no interception,
// no emulation, only its own load events speak for it — but the shutter no
// longer fires on a clock alone: the same first-paint gate the mirror uses
// (every eager image settled, then two animation frames) runs BEFORE the
// 1200ms settle, bounded by what is left of the variant's slice. A stranger's
// page that never settles is still shot, exactly as before — the gate may
// only WAIT, never refuse — and the miss is NAMED (capture_wait_degraded:
// paint_wait_timeout) on the result and the sidecar.
//
// AND THE MIRROR LANE GETS ITS OWN SECOND GATE: THE HERO SURFACE (same day,
// owner-verified in the delivered V3 email). The NEW-site PHONE shot rendered
// gray/blank while the OLD-site shot beside it was fine: on our mirror, first
// paint fires on CHROME paint — a client-rendered phone viewport can show an
// EMPTY eager-image list at domcontentloaded, so the shared gate opens before
// the hero video's poster and the hydrated content have painted anything. The
// mirror's content is video/poster-driven, so plain first-paint is not
// enough: after the first gate the mirror lane now waits for the hero surface
// itself to be REAL — a hero video frame decoded (readyState >= 2) or the
// poster/paint-under image decoded for actual pixels (complete &&
// naturalWidth > 0). A hero that never confirms within the variant's slice is
// still shot (fail-open — the gate may only WAIT, never refuse) after a
// bounded extra settle, and the miss is NAMED (capture_wait_degraded:
// mirror_paint_timeout) on the result and the sidecar.
const MIRROR_MEDIA_RESOURCE_TYPES = new Set(["media"]);
const MIRROR_MEDIA_URL_RE = /\.(?:mp4|m4v|webm|ogv|ogg|mov|mkv|avi|m4a)(?:[?#]|$)/i;
// The paint wait is bounded by the variant's own navigation timeout (the same
// envelope the "before" shot's two navigation attempts already share), so a
// mirror that will not settle costs its budget slice and no more.
const MIRROR_SETTLE_MS = 1_500;
// The fail-open settle a mirror earns when its hero surface never confirms:
// the gate already spent two frames trying, and this bounded extra beat (the
// 800–1200ms band) is the hero's last chance to paint before the shutter —
// the donor walker's error-stepdown ramp runs on the same order (~1.5s), so a
// shot fired at least this late catches the paint-under, not the swap frame.
const MIRROR_HERO_SETTLE_MS = 1_000;

// A page.evaluate has NO timeout in Playwright — an await that the renderer
// never answers (a starved renderer, a crashed target) would hold the whole
// capture open-ended. Every evaluate that cannot answer quickly is raced
// against this bound instead; the capture stays fail-open either way.
const CAPTURE_EVAL_BOUND_MS = 2_000;
// classifyBeforeNavigation reads the page's HTML over CDP; a wedged target
// must not turn a classification into a hang.
const CAPTURE_CONTENT_BOUND_MS = 8_000;
// An explicit shutter bound. Playwright's implicit default is finite but
// unnamed; the capture's own budget law wants the number on the page.
const CAPTURE_SCREENSHOT_MS = 15_000;

/** The sentinel a bounded await resolves with when the renderer never answered. */
const CAPTURE_BOUND_MISS = Symbol("capture_bound_timeout");

/** Race a page await that the renderer may never answer. Fail-open. */
async function withCaptureBound(work, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise((resolve) => {
        // A miss resolves with a SENTINEL, never undefined: a successful await
        // may legitimately resolve with undefined (a void promise does exactly
        // that), so the timeout cannot be detected by comparing values.
        timer = setTimeout(() => resolve(CAPTURE_BOUND_MISS), Math.max(1, Number(ms) || 1));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// HERO-AWARE FRAMING AND THE SHOT-QUALITY GUARDS (2026-09-05, audit A4)
// ---------------------------------------------------------------------------
// Audit A4 (console-arcade/audit-a4-email-shots.md) measured 13/34 degraded
// phone slots in the delivered V3 emails. The AFTER shots were HONEST captures
// of the top sliver of giant donor heroes: the shutter fired viewport-only on a
// hero whose content starts thousands of pixels down (Superior Fence h1 at
// y=1239 on the phone, y=2081 on desktop; Columbia y=3241; Hage's hero section
// measures 0x0 on the phone), and BOTH paint gates certified that invisible
// frame — `complete && naturalWidth > 0` is satisfied by an image laid out at
// 0x0 or parked 5000px below the fold, so no marker ever fired. Deterministic,
// not timing: local re-captures hours later matched the shipped pixels.
//
// Three guards, same laws as every gate above (fail-open, bounded, named):
//
//   1. VIEWPORT-AWARE GATE PREDICATES. A confirming image/video must now have a
//      non-zero rect INTERSECTING the capture viewport. A 0x0-laid-out poster or
//      a below-fold image may no longer certify either gate; such a page is
//      still shot (the gate may only WAIT, never refuse) with the miss NAMED.
//
//   2. HERO-AWARE FRAMING — the scroll mechanism, chosen deliberately over an
//      element/clip screenshot: the output stays EXACTLY the 1440x900 / 390x844
//      browser frame the email's phone bezel and every sidecar contract expect
//      (an element shot emits donor-dependent heights, down to 0px on the Hage
//      shape), and it frames to CONTENT whatever the hero's geometry — no
//      fixed-size assumptions. After the gates, an in-page locator finds the
//      hero CONTENT anchor (first laid-out h1, else the first hero-named
//      section with real height) and, when its top sits below 65% of the
//      viewport, scrolls it into the frame with 12% headroom. The scroll is
//      recorded on the sidecar as capture_framed_via — positive provenance,
//      not a degrade.
//
//   3. THE POST-SHOT BLANK CHECK. The shot's own pixels are measured with
//      audit A4's method — luminance stddev and the share of near-uniform 24px
//      tiles — runnable in the capture context by drawing the captured JPEG
//      into a canvas on the SAME browser page (no new dependency, no second
//      browser). A shot beyond the blank thresholds earns ONE retry with
//      forced scroll-to-content framing; the outcome is NAMED on the result
//      and the sidecar (shot_blank_retried / shot_blank_accepted), and the
//      measured stats ride the sidecar (shot_luma_std / shot_flat_pct) so the
//      next audit starts from the numbers, not from eyeballs.
const HERO_FRAME_TRIGGER_RATIO = 0.65;
const HERO_FRAME_TOP_RATIO = 0.12;
const SHOT_BLANK_RETRY_SETTLE_MS = 600;
// Audit A4's measured split: healthy site shots land at luminance stddev 46–95
// with ≤48% near-uniform tiles; the degraded slabs at stddev 15–40 and 50–80%
// uniform. The guard sits below/above the healthy band, so a real (if plain)
// page never trips it while the dark/pale slabs do.
const SHOT_BLANK_STD_MIN = 32;
const SHOT_BLANK_FLAT_PCT_MAX = 62;
// The blank meter draws a ~30–120KB JPEG and walks its pixels; generous, but
// bounded like every capture evaluate.
const SHOT_BLANK_METER_BOUND_MS = 8_000;

/** The measurement host: a bare page whose only content is the meter canvas. */
const SHOT_BLANK_METER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0"><canvas id="shot-blank-meter"></canvas></body></html>`;

// ---------------------------------------------------------------------------
// THE BEFORE SHOT vs THE REAL, HOSTILE WEB (2026-09-02)
// ---------------------------------------------------------------------------
// Smoke batch line_mtl0s1bf produced six gate_passed rows with LIVE mirrors
// (Forbes, WyattWorks, Three Way Plumbing, Hurricane Fence, Builders Fence,
// Rocky Mountain Electric) that refused force-send with
// force_send_refused:no_before_after_visuals. The AFTER (mirror) side was
// already fixed by the media policy above; the failing side was the BEFORE —
// the prospect's CURRENT external website. External sites hit bot-walls,
// challenge pages and 403/503s that our mirrors never see, and until now the
// BEFORE path had exactly two answers: store whatever loaded (a challenge page
// captioned "YOUR SITE TODAY") or fail, and a fail always ended the same way —
// no before image, gate refuses, zero emails.
//
// Owner directive for this lane: an honest disclosed-absence beats zero
// emails. So the BEFORE path now (a) CLASSIFIES a bot-block instead of
// photographing it, (b) falls back to public archives of the SAME domain —
// a snapshot of their own site is still their site — and (c) when even the
// archives have nothing, renders a styled disclosure card that says the
// previous online presence was unavailable for capture. Every non-live lane
// is NAMED on the shot record (capture_via / before_unavailable), so nothing
// downstream can mistake a disclosure card for a verified screenshot.
//
// Google's cache is deliberately absent from the chain: the cache links were
// discontinued by Google and return 404 today — spending budget there is a
// guaranteed loss.

// Statuses that mean "the site (or its wall) refused this client": a real
// business homepage does not ship these by accident.
const BEFORE_BLOCK_STATUS_REASONS = new Map([
  [403, "http_403_forbidden"],
  [429, "http_429_rate_limited"],
  [503, "http_503_unavailable"],
]);

// Unambiguous bot-wall fingerprints, checked regardless of status (some walls
// ship 200 with a challenge body). Every phrase is bot-infrastructure
// specific; none appears on a working SMB homepage by accident.
const BEFORE_CHALLENGE_MARKERS = [
  "cf-challenge",
  "cf-browser-verification",
  "cdn-cgi/challenge-platform",
  "_cf_chl_opt",
  "just a moment...",
  "attention required! | cloudflare",
  "ddos protection by",
  "checking your browser before accessing",
  "sucuri id",
  "captcha-delivery",
  "px-captcha",
  "datadome",
  "perimeterx",
  "distil networks",
  "verify you are human",
  "are you a robot",
];

// Wayback's not-archived interstitial, so a direct navigation to a missing
// snapshot is detected instead of photographed.
const WAYBACK_MISS_MARKERS = [
  "wayback machine has not archived",
  "wayback machine doesn't have that page",
  "doesn't have that page archived",
];

const ARCHIVE_TODAY_HOST_RE = /^https?:\/\/(?:www\.)?(?:archive\.ph|archive\.today|archive\.is|archive\.li|archive\.md)\//i;
const WAYBACK_SNAPSHOT_RE = /^https?:\/\/web\.archive\.org\/web\/\d{14}\//i;
const WAYBACK_LATEST_URL = (url) => `https://web.archive.org/web/2/${url}`;
const ARCHIVE_TODAY_NEWEST_URL = (url) => `https://archive.ph/newest/${url}`;
const WAYBACK_AVAILABLE_API = (url) =>
  `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;

// Fallback lanes get hard, small budgets — an archive that will not serve is
// not worth more than this, and the live site's slice is never stolen.
const ARCHIVE_TODAY_NAV_MS = 15_000;
const WAYBACK_NAV_MS = 25_000;
const WAYBACK_LOOKUP_MS = 8_000;
// A text-strip under this length means nothing human rendered; the shutter
// would fire on a blank or near-blank frame and caption it as their site.
const BEFORE_EMPTY_RENDER_TEXT_CHARS = 30;
// When the AFTER pair is already secured, the BEFORE shot is the only thing
// left between the row and a refused send, and slow external sites are the
// EXPECTED case for real businesses — so the before variants get the
// remaining budget, not a fixed 45s slice. Ceiling is absolute because the
// chromium permit (lib/serverless-chromium, MAX_PERMIT_HOLD_MS) and the
// invocation around it are both finite.
// CUT 90s -> 45s (2026-09-04, batch line_mtmvwmyn): the before lane runs
// INSIDE the gate's inspection budget, and a stranger's site that starves
// networkidle burns its whole slice before the archive chain even starts.
// A 90s ceiling plus the mirror variants' own slices is what let a healthy
// build blow the gate's entire deadline on every retry; 45s still shoots
// slow real sites (the measured dripfixplumbingde.com reached networkidle
// at 41.2s) while leaving the gate budget to live in.
const BEFORE_EXTENDED_NAV_CEILING_MS = 45_000;
const BEFORE_EXTENDED_RESERVE_MS = 4_000;

/** Strip tags and collapse whitespace — enough text to tell a wall from a site. */
function visibleTextOf(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this navigation a bot-block rather than their homepage?
 *
 * Best-effort by design: a page that cannot be interrogated (no response
 * body available on this browser build) classifies as NOT blocked, which is
 * the exact historical behaviour — the classifier may only narrow what gets
 * stored, never invent a block that is not there.
 */
async function classifyBeforeNavigation({ page, response } = {}) {
  const status = typeof (response && response.status) === "function"
    ? Number(response.status()) || 0
    : 0;
  if (BEFORE_BLOCK_STATUS_REASONS.has(status)) {
    return { blocked: true, reason: BEFORE_BLOCK_STATUS_REASONS.get(status) };
  }
  let html = "";
  try {
    if (typeof page.content === "function") {
      // A wedged renderer must not turn the classifier into a hang: the read
      // is raced against a small bound and a page we cannot interrogate
      // classifies as NOT blocked, exactly as the catch below always did.
      const content = await withCaptureBound(page.content(), CAPTURE_CONTENT_BOUND_MS);
      html = content === CAPTURE_BOUND_MISS ? "" : String(content || "");
    }
  } catch { html = ""; }
  const haystack = html.toLowerCase();
  const marker = BEFORE_CHALLENGE_MARKERS.find((needle) => haystack.includes(needle));
  if (marker) {
    return { blocked: true, reason: "challenge_page", detail: marker.slice(0, 40) };
  }
  if (html && visibleTextOf(html).length < BEFORE_EMPTY_RENDER_TEXT_CHARS) {
    return { blocked: true, reason: "empty_render" };
  }
  return { blocked: false, reason: "" };
}

/**
 * The most recent wayback capture for a URL, via the availability API (the
 * machine-readable "most recent snapshot" lookup; the Memento timemap at
 * web.archive.org redirects and walls automated readers, so it is not usable
 * from the capture lane). Returns "" when there is no usable 200 snapshot.
 */
async function waybackLatestSnapshot(url, { fetchImpl = global.fetch } = {}) {
  if (typeof fetchImpl !== "function") return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAYBACK_LOOKUP_MS);
  try {
    const res = await fetchImpl(WAYBACK_AVAILABLE_API(url), { signal: controller.signal });
    if (!res || !res.ok) return "";
    const body = await res.json();
    const closest = body && body.archived_snapshots && body.archived_snapshots.closest;
    const snapshot = String((closest && closest.url) || "");
    if (!snapshot || String(closest.status || "") !== "200") return "";
    // The API can hand back an http:// or unslashed form; normalize to the
    // timestamped shape the snapshot-verification regex expects.
    return snapshot.replace(/^http:\/\//i, "https://");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function waybackSnapshotLooksReal({ landed = "", html = "" } = {}) {
  if (!WAYBACK_SNAPSHOT_RE.test(landed)) return false;
  const haystack = String(html || "").toLowerCase();
  return !WAYBACK_MISS_MARKERS.some((needle) => haystack.includes(needle));
}

/**
 * The honest disclosed-absence card. Rendered LOCALLY (page.setContent — no
 * network), styled like the email's own dark proof panel, and it says exactly
 * what happened: we could not capture their previous online presence. No
 * timestamp — the card is content-stable, so a re-capture keeps the same
 * pixel digest and the email's cache-busted URL stays valid.
 */
function placeholderCardHtml({ url = "", mobile = false } = {}) {
  let host = String(url || "");
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
  const width = mobile ? 390 : 1440;
  const height = mobile ? 844 : 900;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    body{width:${width}px;height:${height}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
      background:#0B0B10;font-family:Arial,Helvetica,sans-serif}
    .card{width:${Math.floor(width * 0.72)}px;border:1px solid #2A2A33;border-radius:16px;background:#101016;
      padding:${mobile ? "36px 28px" : "56px 48px"};text-align:center}
    .host{color:#EDEDF2;font-size:${mobile ? 20 : 30}px;font-weight:700;word-break:break-all;margin:0 0 18px}
    .line{width:56px;height:3px;background:#3A3A46;margin:0 auto 18px}
    .note{color:#9A9AA6;font-size:${mobile ? 14 : 18}px;line-height:1.5;margin:0}
  </style></head><body><div class="card">
    <p class="host">${host.replace(/[<>&"]/g, "")}</p>
    <div class="line"></div>
    <p class="note">Your previous online presence was unavailable for capture when this comparison was prepared.</p>
  </div></body></html>`;
}

async function renderPlaceholderCard(page, { url, variant }) {
  await page.setContent(
    placeholderCardHtml({ url, mobile: /-mobile$/.test(variant) }),
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS });
}

/**
 * THE BEFORE CAPTURE, RESILIENT. Live site first — the exact historical
 * strategy (networkidle, then load, settle 1200ms) — then, only when the live
 * navigation is CLASSIFIED as a bot-block or dies outright:
 *   (a) archive.today's newest snapshot of the SAME url,
 *   (b) the Wayback Machine's most recent 200 capture,
 *   (c) a locally-rendered disclosure card (named before_unavailable).
 *
 * The returned `landed` is the URL the picture ATTESTS to — the prospect's
 * own url for every lane, so the domain identity law downstream keeps
 * holding. Where the browser actually ended up travels beside it as
 * `archive_landed_url`, and `capture_via` names the lane. A live capture
 * returns capture_via "live" and no extra fields — byte-for-byte the old
 * shape.
 */
async function captureBeforeShot(browser, { url, variant, timeoutMs = 45000 }) {
  const mobile = /-mobile$/.test(variant);
  const page = await browser.newPage({ viewport: VIEWPORTS[mobile ? "mobile" : "desktop"] });
  const fallback = { capture_via: "", archive_landed_url: "", before_unavailable: "", attempted: [] };
  try {
    // ---- LIVE ATTEMPT — the historical strategy, untouched ----------------
    const sliceStart = Date.now();
    let response = null;
    let liveReason = "";
    try {
      response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch {
      // A slow third-party beacon must not cost the shot; fall back to load,
      // bounded by what is left of this variant's slice.
      const left = Math.max(1_000, timeoutMs - (Date.now() - sliceStart));
      try {
        response = await page.goto(url, { waitUntil: "load", timeout: left });
      } catch (e) {
        liveReason = `navigation_failed:${String((e && e.message) || e).slice(0, 80)}`;
      }
    }
      if (!liveReason) {
        const verdict = await classifyBeforeNavigation({ page, response });
        if (!verdict.blocked) {
          // THE FIRST-PAINT GATE (2026-09-03), before the fixed settle: the
          // shutter may no longer fire on a clock alone. Bounded by what is left
          // of this variant's slice — the same envelope the two navigation
          // attempts above already share — and fail-open by law: a stranger's
          // page that never settles is still shot exactly as before, with the
          // miss NAMED (waitDegraded) on the result and the sidecar so a gray
          // frame is diagnosable instead of silent.
          const paintLeftMs = Math.max(1_000, timeoutMs - (Date.now() - sliceStart));
          const paint = await waitForFirstPaint(page, paintLeftMs);
          await page.waitForTimeout(1200);
          // THE POST-SHOT BLANK GUARD (2026-09-05, audit A4): a live page can
          // paint an honest but EMPTY top slab (hero content thousands of px
          // down). The shot's pixels are measured with the audit's own method
          // and a uniform slab earns ONE scroll-to-content retry. Their site
          // framed on its content is still their site — the identity law below
          // reads the attested URL, which scrolling never changes.
          const guarded = await shootWithBlankGuard(page, () =>
            page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS }));
          return {
            buffer: guarded.buffer,
            landed: guarded.landedUrl,
            response,
            capture_via: "live",
            ...(!paint.ok ? { waitDegraded: paint.reason } : {}),
            ...(guarded.blankCheck ? { blankCheck: guarded.blankCheck } : {}),
            ...(guarded.stats ? { shotStats: guarded.stats } : {}),
          };
        }
        liveReason = verdict.reason + (verdict.detail ? `:${verdict.detail}` : "");
      }
      fallback.before_unavailable = liveReason;

      // ---- (a) archive.today -------------------------------------------------
      // ARCHIVE PARITY FOR THE PHONE HALF (2026-09-05, audit A4 defect B): the
      // mobile lane used to skip both archives ("best-effort extra") and fall
      // straight to the near-black disclosure card — so bot-walled prospects
      // showed a REAL wayback archive on the desktop BEFORE beside a black
      // apology card on the phone BEFORE of the SAME site, and the email's
      // "side by side" pair read as broken. The mobile lane now runs the SAME
      // fallback chain, at its own already-mobile viewport, so the pair matches.
      fallback.attempted.push("archive_today");
      try {
        await page.goto(ARCHIVE_TODAY_NEWEST_URL(url), { waitUntil: "load", timeout: Math.min(ARCHIVE_TODAY_NAV_MS, timeoutMs) });
        const html = typeof page.content === "function" ? String(await page.content().catch(() => "")) : "";
        const landed = String(page.url() || "");
        const captcha = /captcha|checking your browser/i.test(html);
        if (ARCHIVE_TODAY_HOST_RE.test(landed) && !captcha && visibleTextOf(html).length >= BEFORE_EMPTY_RENDER_TEXT_CHARS) {
          // A REAL capture of their own site: the live-block reason does not
          // travel — this is provenance, not a disclosed absence.
          return {
            buffer: await page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS }),
            landed: url,
            response: null,
            capture_via: "archive_today",
            archive_landed_url: landed,
            attempted: fallback.attempted,
          };
        }
        fallback.attempted.push(`archive_today_unusable:${captcha ? "captcha" : "no_snapshot"}`);
      } catch (e) {
        fallback.attempted.push(`archive_today_failed:${String((e && e.message) || e).slice(0, 60)}`);
      }

      // ---- (b) Wayback Machine ----------------------------------------------
      fallback.attempted.push("wayback");
      try {
        const snapshot = await waybackLatestSnapshot(url);
        const target = snapshot || WAYBACK_LATEST_URL(url);
        await page.goto(target, { waitUntil: "load", timeout: Math.min(WAYBACK_NAV_MS, Math.max(1_000, timeoutMs)) });
        const html = typeof page.content === "function" ? String(await page.content().catch(() => "")) : "";
        const landed = String(page.url() || "");
        if (waybackSnapshotLooksReal({ landed, html })) {
          return {
            buffer: await page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS }),
            landed: url,
            response: null,
            capture_via: "wayback",
            archive_landed_url: landed,
            attempted: fallback.attempted,
          };
        }
        fallback.attempted.push("wayback_no_usable_snapshot");
      } catch (e) {
        fallback.attempted.push(`wayback_failed:${String((e && e.message) || e).slice(0, 60)}`);
      }

    // ---- (c) The disclosed-absence card ------------------------------------
    fallback.attempted.push("placeholder");
    fallback.capture_via = "placeholder";
    return {
      buffer: await renderPlaceholderCard(page, { url, variant }),
      landed: url,
      response: null,
      ...fallback,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function mirrorMediaRequest(request) {
  if (!request || typeof request !== "object") return false;
  if (typeof request.resourceType === "function"
    && MIRROR_MEDIA_RESOURCE_TYPES.has(String(request.resourceType() || ""))) return true;
  const href = typeof request.url === "function" ? String(request.url() || "") : "";
  return MIRROR_MEDIA_URL_RE.test(href);
}

/**
 * Install the AFTER shot's media policy on a page: video/audio requests are
 * aborted at the network layer (the hero's paint-under shows instead — that
 * is the designed fallback, not a compromise), and reduced motion is emulated
 * so nothing animates into a half-painted frame. Both halves are
 * feature-detected and individually best-effort: an exotic CDP session
 * without interception still gets the corrected wait strategy, which is the
 * half that fixes the hang on its own.
 */
async function applyMirrorMediaPolicy(page) {
  const applied = { blockedMedia: false, reducedMotion: false };
  try {
    if (typeof page.route === "function") {
      await page.route("**/*", (route) => {
        const request = typeof route.request === "function" ? route.request() : null;
        if (mirrorMediaRequest(request)) return route.abort();
        return route.continue();
      });
      applied.blockedMedia = true;
    }
  } catch { /* interception unavailable here; the wait strategy still bounds the capture */ }
  try {
    if (typeof page.emulateMedia === "function") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      applied.reducedMotion = true;
    }
  } catch { /* cosmetic only */ }
  return applied;
}

/**
 * THE FIRST-PAINT GATE — shared by BOTH capture lanes (2026-09-03). Every
 * EAGER image has finished loading (an image that 404s is still `complete`;
 * one that hangs is not), then two animation frames so at least one real
 * paint happened before the shutter. Never waits on the network going quiet —
 * a streaming hero clip never grants that (the mirror lane's law), and a fixed
 * clock alone fires on a mid-hydration blank (the before lane's gray/blank
 * defect: builders like Wix/Squarespace render their whole DOM after "load",
 * and eager-image completeness tracks that render — document.images is live,
 * so the gate only opens once the page has actually drawn its content).
 * Feature-detected so a minimal page stub (and an exotic CDP session without
 * waitForFunction) still captures: the gate may only WAIT, never refuse.
 *
 * VIEWPORT-AWARE SINCE 2026-09-05 (audit A4): completeness alone certified
 * pages whose confirming images were laid out 0x0 or parked below the fold, so
 * the gate opened on invisible evidence. The predicate now additionally
 * requires a CONFIRMING surface the frame can actually see — an eager image
 * with real decoded pixels AND a non-zero rect intersecting the viewport — or,
 * for a typographic hero with no in-frame art, an element with visible text
 * intersecting the viewport. A page with neither (the empty top slab of a
 * giant hero) is still shot fail-open after the bounded wait, with the miss
 * NAMED — the gate never certifies invisible content again, and never refuses
 * a shot either.
 */
async function waitForFirstPaint(page, timeoutMs) {
  if (typeof page.waitForFunction === "function") {
    try {
      await page.waitForFunction(
        () => {
          /* first-paint-gate: visible painted evidence only */
          const vw = window.innerWidth || 0;
          const vh = window.innerHeight || 0;
          const eager = Array.from(document.images || [])
            .filter((img) => img.loading !== "lazy");
          if (!eager.every((img) => img.complete)) return false;
          if (eager.length === 0) return true;
          const intersects = (el) => {
            const r = el.getBoundingClientRect();
            return Boolean(r) && r.width > 1 && r.height > 1
              && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
          };
          if (eager.some((img) => img.complete && (Number(img.naturalWidth) || 0) > 0 && intersects(img))) {
            return true;
          }
          // A typographic hero (no in-frame art) still attests real paint with
          // laid-out text inside the frame.
          const textBearing = document.querySelectorAll("h1,h2,h3,h4,p,a,span,li,button,label,td,th");
          for (const el of Array.from(textBearing)) {
            if (intersects(el) && String(el.textContent || "").trim().length > 0) return true;
          }
          return false;
        },
        undefined,
        { timeout: Math.max(1_000, Number(timeoutMs) || 1_000) },
      );
    } catch {
      return { ok: false, reason: "paint_wait_timeout" };
    }
  }
  if (typeof page.evaluate === "function") {
    try {
      // THE rAF AWAIT IS BOUNDED (2026-09-04). page.evaluate has no timeout of
      // its own, and a renderer that never answers a frame — background-tab
      // throttling, an occluded headless target — held this await open-ended
      // and, with it, the gate's whole capture budget. Two seconds is two
      // frames many times over; a miss is a named degradation, not a hang.
      const framed = await withCaptureBound(
        page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })),
        CAPTURE_EVAL_BOUND_MS,
      );
      if (framed === CAPTURE_BOUND_MISS) return { ok: false, reason: "paint_frame_timeout" };
    } catch {
      return { ok: false, reason: "paint_frame_unavailable" };
    }
  }
  return { ok: true, reason: "" };
}

/**
 * THE HERO-SURFACE GATE — the mirror lane's SECOND gate (2026-09-03). First
 * paint on our mirror can fire on chrome paint alone: the mirror's content is
 * video/poster-driven, and a client-rendered phone viewport may carry an
 * EMPTY eager-image list at domcontentloaded, so the shared gate above opens
 * before the hero has painted anything — the gray/blank NEW-site phone shot
 * the delivered V3 email shipped. After the first gate, the mirror lane
 * additionally waits for the hero surface to be REAL:
 *
 *   (a) a hero video with a decoded frame — readyState >= 2 means the current
 *       frame is paintable (the path when interception was unavailable and
 *       the clip actually plays), or
 *   (b) the poster/paint-under image decoded for actual pixels — an EAGER
 *       image that is complete AND naturalWidth > 0. `complete` alone counts
 *       a 404; naturalWidth > 0 does not.
 *
 * VIEWPORT-AWARE SINCE 2026-09-05 (audit A4): (a) and (b) as written certified
 * invisible evidence — the Hage phone's hero poster SVG carries naturalWidth
 * 1600 while laid out at 0x0, and every other "confirming" image on the
 * failing donors sat below the fold, so the gate passed on frames no one could
 * see. Both confirming surfaces must now also have a non-zero rect
 * INTERSECTING the capture viewport. A hero genuinely below the fold (the
 * multi-section slab donors) fails the gate by design — the miss is NAMED
 * (mirror_paint_timeout) and the HERO-AWARE FRAMING step below scrolls the
 * content into the frame before the shutter.
 *
 * A mirror whose hero confirms neither within its bounded slice is STILL SHOT
 * — fail-open by the same law as waitForFirstPaint: the gate may only WAIT,
 * never refuse — after a bounded extra settle (the two frames below plus
 * MIRROR_HERO_SETTLE_MS at the caller), with the miss NAMED
 * (mirror_paint_timeout) on the capture so it lands as
 * capture_wait_degraded:mirror_paint_timeout on the result and the sidecar.
 * Feature-detected so a minimal page stub still captures: no waitForFunction,
 * no gate.
 */
async function waitForMirrorHeroPaint(page, timeoutMs) {
  if (typeof page.waitForFunction !== "function") return { ok: true, reason: "" };
  let settled = true;
  try {
    await page.waitForFunction(
      () => {
        /* hero-surface-gate: in-viewport painted hero only */
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const intersects = (el) => {
          const r = el.getBoundingClientRect();
          return Boolean(r) && r.width > 1 && r.height > 1
            && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
        };
        for (const video of Array.from(document.querySelectorAll("video"))) {
          if ((Number(video.readyState) || 0) >= 2 && intersects(video)) return true;
        }
        for (const img of Array.from(document.images || [])) {
          if (img.loading !== "lazy" && img.complete && (Number(img.naturalWidth) || 0) > 0 && intersects(img)) return true;
        }
        return false;
      },
      undefined,
      { timeout: Math.max(1_000, Number(timeoutMs) || 1_000) },
    );
  } catch {
    settled = false;
  }
  // Two frames either way, best-effort: on a hit they carry the decoded hero
  // into the compositor before the shutter; on a miss they are the first half
  // of the bounded extra settle the caller adds. The evaluate itself is raced
  // against the capture eval bound (2026-09-04): a renderer that never answers
  // a frame must cost the shot its two seconds, not the gate's whole budget.
  if (typeof page.evaluate === "function") {
    try {
      await withCaptureBound(
        page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })),
        CAPTURE_EVAL_BOUND_MS,
      );
    } catch { /* the caller's bounded settle still bounds the miss */ }
  }
  return settled ? { ok: true, reason: "" } : { ok: false, reason: "mirror_paint_timeout" };
}

/** page.url(), but never a throw — a torn-down target must not kill a capture. */
function safePageUrl(page) {
  try { return String(page.url() || ""); } catch { return ""; }
}

/**
 * HERO-AWARE FRAMING (2026-09-05, audit A4 defect A). Locates the hero CONTENT
 * anchor — the first laid-out <h1>, else the first hero-named element with
 * real height (Hage's 0px phone hero is skipped by the height test) — and, when
 * the anchor's top sits below HERO_FRAME_TRIGGER_RATIO of the viewport, scrolls
 * it into the frame with HERO_FRAME_TOP_RATIO headroom. SCROLL, not an element
 * shot: the output stays the exact viewport the email's phone bezel and every
 * sidecar contract expect, whatever the hero's geometry. `force` re-frames even
 * an in-frame anchor — the blank-retry path's second chance.
 *
 * Fail-open and bounded like everything here: a page that cannot answer keeps
 * its current scroll, and the verdict names what happened.
 */
async function frameHeroContent(page, { force = false } = {}) {
  if (typeof page.evaluate !== "function") return { action: "kept", anchor: "unavailable" };
  let verdict = null;
  try {
    const evaluated = await withCaptureBound(
      page.evaluate((options) => {
        /* hero-content-framing: frame the anchor, keep the viewport shot */
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        if (!vw || !vh) return { action: "kept", anchor: "no_viewport" };
        const rectOf = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r && r.width >= 1 && r.height >= 1 ? r : null;
        };
        let anchor = null;
        let anchorName = "";
        for (const h1 of Array.from(document.querySelectorAll("h1"))) {
          const r = rectOf(h1);
          if (r) { anchor = h1; anchorName = "h1"; break; }
        }
        if (!anchor) {
          for (const el of Array.from(document.querySelectorAll("[class*='hero' i],[id*='hero' i]"))) {
            const r = rectOf(el);
            if (r && r.height >= 120) { anchor = el; anchorName = "hero_section"; break; }
          }
        }
        if (!anchor) return { action: "kept", anchor: "none" };
        const rect = anchor.getBoundingClientRect();
        const docTop = rect.top + (window.scrollY || window.pageYOffset || 0);
        const targetY = Math.max(0, Math.round(docTop - vh * options.topRatio));
        const belowFrame = rect.top >= vh * options.triggerRatio;
        if (!options.force && !belowFrame) return { action: "kept", anchor: anchorName };
        const currentY = window.scrollY || window.pageYOffset || 0;
        if (options.force && Math.abs(targetY - currentY) < 50) {
          return { action: "kept", anchor: anchorName };
        }
        window.scrollTo(0, targetY);
        return { action: "scrolled", anchor: anchorName, scrollY: targetY };
      }, { force, topRatio: HERO_FRAME_TOP_RATIO, triggerRatio: HERO_FRAME_TRIGGER_RATIO }),
      CAPTURE_EVAL_BOUND_MS,
    );
    if (evaluated !== CAPTURE_BOUND_MISS) verdict = evaluated;
  } catch { /* fail-open: keep the current scroll */ }
  if (!verdict || typeof verdict !== "object") return { action: "kept", anchor: "unavailable" };
  return { action: String(verdict.action || "kept"), anchor: String(verdict.anchor || ""), scrollY: verdict.scrollY };
}

/**
 * Measure a captured shot's own pixels with audit A4's method, IN THE CAPTURE
 * CONTEXT: the JPEG buffer is drawn into a canvas on the same browser page and
 * walked for luminance stddev plus the share of near-uniform 24px tiles
 * (tile stddev < 2.0). Returns { std, flatPct } or null when the page cannot
 * host the meter (no setContent, a stub, a torn-down renderer) — a null is a
 * skipped check, never a failed one: the guard is fail-open like every gate.
 *
 * The meter REPLACES the page content, so callers must read page.url() and the
 * response headers BEFORE the first measurement.
 */
async function measureShotUniformity(page, jpegBuffer) {
  if (!Buffer.isBuffer(jpegBuffer) || !jpegBuffer.length) return null;
  if (typeof page.setContent !== "function" || typeof page.evaluate !== "function") return null;
  try {
    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
    await page.setContent(SHOT_BLANK_METER_HTML, { waitUntil: "load" });
    const stats = await withCaptureBound(
      page.evaluate(async (payload) => {
        /* shot-blank-meter: A4 luminance stddev + near-uniform tiles */
        const img = new Image();
        img.src = payload.dataUrl;
        await new Promise((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("meter_decode_failed"));
        });
        const canvas = document.getElementById("shot-blank-meter");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        const width = canvas.width;
        const height = canvas.height;
        const data = ctx.getImageData(0, 0, width, height).data;
        const lumaAt = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        for (let i = 0; i + 2 < data.length; i += 8) {
          const luma = lumaAt(i);
          sum += luma;
          sumSq += luma * luma;
          n += 1;
        }
        const mean = sum / Math.max(1, n);
        const std = Math.sqrt(Math.max(0, sumSq / Math.max(1, n) - mean * mean));
        const tilePx = payload.tilePx;
        const cols = Math.max(1, Math.floor(width / tilePx));
        const rows = Math.max(1, Math.floor(height / tilePx));
        let uniformTiles = 0;
        let totalTiles = 0;
        for (let ty = 0; ty < rows; ty += 1) {
          for (let tx = 0; tx < cols; tx += 1) {
            let tileSum = 0;
            let tileSumSq = 0;
            let tileN = 0;
            const x0 = tx * tilePx;
            const y0 = ty * tilePx;
            for (let y = y0; y < y0 + tilePx && y < height; y += 2) {
              let idx = (y * width + x0) * 4;
              for (let x = x0; x < x0 + tilePx && x < width; x += 2) {
                const luma = lumaAt(idx);
                tileSum += luma;
                tileSumSq += luma * luma;
                tileN += 1;
                idx += 8;
              }
            }
            const tileMean = tileSum / Math.max(1, tileN);
            const tileStd = Math.sqrt(Math.max(0, tileSumSq / Math.max(1, tileN) - tileMean * tileMean));
            totalTiles += 1;
            if (tileStd < 2.0) uniformTiles += 1;
          }
        }
        return {
          std: Math.round(std * 10) / 10,
          flatPct: Math.round((100 * uniformTiles) / Math.max(1, totalTiles)),
        };
      }, { dataUrl, tilePx: 24 }),
      SHOT_BLANK_METER_BOUND_MS,
    );
    if (stats === CAPTURE_BOUND_MISS) return null;
    if (!stats || typeof stats !== "object") return null;
    const std = Number(stats.std);
    const flatPct = Number(stats.flatPct);
    if (!Number.isFinite(std) || !Number.isFinite(flatPct)) return null;
    return { std, flatPct };
  } catch {
    return null;
  }
}

/** Audit A4's blank verdict on the meter's numbers. */
function shotLooksBlank(stats) {
  if (!stats) return false;
  return stats.std < SHOT_BLANK_STD_MIN || stats.flatPct >= SHOT_BLANK_FLAT_PCT_MAX;
}

/**
 * THE POST-SHOT BLANK GUARD (2026-09-05, audit A4). Wraps a lane's shutter:
 * after the first frame, measure the shot's pixels; if the frame is a
 * near-uniform slab, retry ONCE with forced scroll-to-content framing and
 * measure again. The outcome is NAMED — shot_blank_retried when the retry
 * reads real content, shot_blank_accepted when even the reframed shot stays
 * uniform (a genuinely flat site is still their site) — and the measured
 * stats ride the result so the sidecar carries the numbers. A page that
 * cannot host the meter (stubs, torn-down renderers) skips the guard
 * entirely: it may only convert silent blanks into named ones, never lose a
 * shot.
 */
async function shootWithBlankGuard(page, shutter) {
  const buffer = await shutter();
  // The meter replaces the page: read the landing URL BEFORE measuring.
  const landedUrl = safePageUrl(page);
  const stats = await measureShotUniformity(page, buffer);
  if (!stats || !shotLooksBlank(stats)) {
    return { buffer, landedUrl, stats, blankCheck: "", framedVia: "" };
  }
  const reframed = await frameHeroContent(page, { force: true });
  try { await page.waitForTimeout(SHOT_BLANK_RETRY_SETTLE_MS); } catch { /* bounded beat, best-effort */ }
  let retryBuffer = null;
  try {
    retryBuffer = await shutter();
  } catch { /* the first (blank) shot stands; named below */ }
  if (!retryBuffer) {
    return { buffer, landedUrl, stats, blankCheck: "shot_blank_accepted", framedVia: reframed.anchor };
  }
  const retryStats = await measureShotUniformity(page, retryBuffer);
  const retryBlank = !retryStats || shotLooksBlank(retryStats);
  return {
    buffer: retryBuffer,
    landedUrl,
    stats: retryStats || stats,
    blankCheck: retryBlank ? "shot_blank_accepted" : "shot_blank_retried",
    framedVia: reframed.anchor,
  };
}

/**
 * The proof shot is a picture of the CLIENT'S site. Our own sign-up panel must
 * not sit over the top of it in the email, so OUR mirror ("new*") is loaded
 * with the suppression flag the panel checks — the same guard the original
 * floater used to keep itself out of screenshots.
 *
 * The flag itself is built by proof-storage.suppressOurPanelsUrl, which is the
 * only writer of it. This function's job is the half that is genuinely local:
 * deciding WHOSE site this variant is a picture of. "old*" is the prospect's,
 * and we do not add query parameters to a stranger's site.
 */
function shotUrl(url, variant) {
  if (!/^new(-|$)/.test(variant)) return url;
  return suppressOurPanelsUrl(url);
}

async function captureOne(browser, { url, variant, timeoutMs = 45000 }) {
  const mobile = /-mobile$/.test(variant);
  const mirror = /^new(-|$)/.test(variant);
  if (!mirror) {
    // THE BEFORE SHOT — the prospect's own site. The live attempt inside
    // keeps the strategy that is honest about a STRANGER'S page (networkidle,
    // load fallback, no interception, no emulation — only its own load events
    // speak for it), now with the SHARED first-paint gate ahead of the 1200ms
    // settle (2026-09-03 gray/blank fix — see the header note);
    // captureBeforeShot adds the bot-block classification and the
    // archive/wayback/placeholder fallback chain AROUND it, so a wall or a
    // dead origin resolves to a named, honest capture instead of a refused
    // send. The BEFORE shot may be granted up to the extended ceiling — the
    // caller in ensureLineProofShots hands it the remaining budget when the
    // AFTER pair is already secured; the AFTER shot below keeps its 45s
    // envelope.
    const navigationTimeout = Math.max(1_000, Math.min(
      BEFORE_EXTENDED_NAV_CEILING_MS,
      Number(timeoutMs) || 45_000,
    ));
    return captureBeforeShot(browser, { url, variant, timeoutMs: navigationTimeout });
  }
  const navigationTimeout = Math.max(1000, Math.min(45000, Number(timeoutMs) || 45000));
  const page = await browser.newPage({ viewport: VIEWPORTS[mobile ? "mobile" : "desktop"] });
  try {
    // THE AFTER SHOT — our mirror. Media is refused at the network layer and
    // the wait is domcontentloaded + paint, never network quiet: a hero clip
    // must not be able to spend the capture budget (see the 2026-09-02 note
    // above). Since 2026-09-03 the paint half is TWO gates — first paint
    // (eager images + two frames), then the HERO surface itself (a video
    // frame decoded or the poster/paint-under image decoded with real pixels)
    // — because chrome paint alone was gray on the phone viewport. If even
    // these bounded waits outrun the budget, the shutter fires anyway on
    // whatever painted and the shot is tagged waitDegraded — a named
    // degradation in the report beats a deterministic no_after_shot.
    //
    // EVERY stage below is NAMED on failure (navigation_threw / paint_* /
    // screenshot_failed) and the navigation gets the same two attempts the
    // "before" shot has always had. The 2026-09-02 no_after_shot rows were
    // unreachable to diagnosis precisely because these stages failed
    // anonymously: a thrown goto also loses the response object, which the
    // shared-identity check then refuses on — one transient deadline became
    // a deterministic, unnamed refusal on every retry.
    await applyMirrorMediaPolicy(page);
    const navTarget = shotUrl(url, variant);
    let response = null;
    const degradedParts = [];
    const sliceStart = Date.now();
    try {
      response = await page.goto(navTarget, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    } catch (navError) {
      // A DCL deadline can pass AFTER the document committed — the page may
      // be fully painted with the response object lost. Only a page that
      // never left about:blank earns a second navigation (the "before"
      // lane's own load-fallback symmetry); a committed page is shot as-is
      // and tagged, and its identity is re-proven downstream by the header
      // refetch instead of being refused for a missing response.
      if (pageCommitted(page)) {
        degradedParts.push("navigation_timeout");
      } else {
        degradedParts.push(`navigation_threw:${brief(navError)}`);
        try {
          response = await page.goto(navTarget, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
        } catch (retryError) {
          degradedParts.push(`navigation_retry_threw:${brief(retryError)}`);
        }
      }
    }
    // THE PAINT WAIT GETS THE REMAINING SLICE, NOT A FRESH ONE (2026-09-04).
    // This used to hand waitForFirstPaint the FULL navigation timeout again,
    // so one mirror variant could legally spend nav + paint + hero + settles
    // at ~3x its slice — the arithmetic that let four variants blow the whole
    // capture budget and, with it, the gate's inspection deadline.
    const paintLeftMs = Math.max(1_000, navigationTimeout - (Date.now() - sliceStart));
    const paint = await waitForFirstPaint(page, paintLeftMs);
    if (!paint.ok) degradedParts.push(paint.reason);
    // THE HERO-SURFACE GATE (2026-09-03): first paint on a video/poster mirror
    // can fire on chrome paint while the hero is still gray, so the shutter
    // now also waits for the hero surface to be REAL (video frame decoded, or
    // the poster/paint-under image decoded with actual pixels). Bounded by
    // what is left of this variant's slice — the same envelope the navigation
    // and the first gate already share — and fail-open by law: a hero that
    // never confirms is still shot after a bounded extra settle, with the
    // miss NAMED (mirror_paint_timeout) on the result and the sidecar.
    const heroLeftMs = Math.max(1_000, navigationTimeout - (Date.now() - sliceStart));
    const hero = await waitForMirrorHeroPaint(page, heroLeftMs);
    if (!hero.ok) {
      degradedParts.push(hero.reason);
      await page.waitForTimeout(MIRROR_HERO_SETTLE_MS);
    }
    // HERO-AWARE FRAMING (2026-09-05, audit A4 defect A): the viewport-only
    // shutter photographed the EMPTY TOP SLIVER of giant donor heroes (h1 at
    // y=1239 on the phone, y=2081 on desktop; one hero section measures 0x0 at
    // the phone viewport). The frame now moves to the CONTENT: the first
    // laid-out h1 — else the first hero-named section with real height —
    // scrolled into the frame with headroom when it sits below the fold. The
    // output stays the exact viewport shot; only WHAT it frames changes. A
    // scroll is positive provenance (capture_framed_via), not a degrade.
    const framing = await frameHeroContent(page);
    await page.waitForTimeout(MIRROR_SETTLE_MS);
    // THE IDENTITY SNAPSHOT — read BEFORE the shutter/blank-guard: the meter
    // re-hosts the page, and the response's remote reads die with the page.
    let responseHeaders = null;
    try {
      if (response && typeof response.headers === "function") responseHeaders = response.headers();
      else if (response && response.headers && typeof response.headers === "object") responseHeaders = response.headers;
      if ((!responseHeaders || typeof responseHeaders !== "object") && response && typeof response.allHeaders === "function") {
        responseHeaders = await response.allHeaders();
      }
    } catch { /* the read tiers below still have the refetch */ }
    // One immediate same-page retry on a thrown shutter: a shutter firing
    // mid-paint is the classic transient. A second failure is NAMED, never a
    // bare throw.
    const shutter = async () => {
      try {
        return await page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS });
      } catch (shotError) {
        try {
          await page.waitForTimeout(250);
          const retry = await page.screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_SCREENSHOT_MS });
          if (!degradedParts.includes("screenshot_retried")) degradedParts.push("screenshot_retried");
          return retry;
        } catch {
          throw new Error(`screenshot_failed: ${brief(shotError)}`);
        }
      }
    };
    // THE POST-SHOT BLANK GUARD: measure the shot's own pixels (A4's luminance
    // stddev + near-uniform tiles) and, on a slab, retry ONCE with forced
    // scroll-to-content framing. Named outcomes only — shot_blank_retried /
    // shot_blank_accepted — never a silent blank, never a lost shot.
    const guarded = await shootWithBlankGuard(page, shutter);
    const degraded = degradedParts.join("+").slice(0, 120);
    return {
      buffer: guarded.buffer,
      landed: guarded.landedUrl,
      response,
      ...(responseHeaders && typeof responseHeaders === "object" ? { responseHeaders } : {}),
      ...(degraded ? { waitDegraded: degraded } : {}),
      ...(framing.action === "scrolled" ? { framedVia: `hero:${framing.anchor}`.slice(0, 32) } : {}),
      ...(guarded.blankCheck ? { blankCheck: guarded.blankCheck } : {}),
      ...(guarded.stats ? { shotStats: guarded.stats } : {}),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** A 64-hex digest, or "". Never a truthy fragment. */
function hexOrEmpty(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{64}$/i.test(text) ? text : "";
}

/** The after shot must be our exact requested mirror, not merely some WSS host. */
function mirrorShotBelongsTo({ capturedUrl = "", expectedWebsite = "" } = {}) {
  const capturedHost = previewHostOf(capturedUrl);
  const expectedHost = previewHostOf(expectedWebsite);
  if (!capturedHost || !isApprovedPreviewUrl(capturedUrl)) {
    return { ok: false, reason: "preview_host_not_approved" };
  }
  if (!expectedHost || !isApprovedPreviewUrl(expectedWebsite)) {
    return { ok: false, reason: "expected_preview_not_approved" };
  }
  if (capturedHost !== expectedHost) return { ok: false, reason: "preview_host_mismatch" };
  return { ok: true, reason: "" };
}

/** A one-line, bounded error text for named failure reasons. */
function brief(error) {
  return String((error && error.message) || error || "unknown").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Did the navigation actually reach an http(s) document? A page that never
 *  committed is still on about:blank, and re-navigable. */
function pageCommitted(page) {
  try {
    return /^https?:\/\//i.test(String(page.url() || ""));
  } catch {
    return false;
  }
}

/**
 * SERVER-SIDE IDENTITY REFETCH — the bounded fallback for a LOST RESPONSE.
 *
 * When the browser's main-document response object never reaches us (the goto
 * threw after commit — a DCL deadline, a transient reset), the shared-identity
 * check used to refuse `response_identity_missing` even though the page had
 * landed and painted. But those headers are served by OUR OWN router on every
 * GET of the document — the activation verifier (shared-site-publisher) proves
 * exactly this with a plain fetch. So the fallback re-reads the SAME headers
 * from the SAME URL server-side, once, bounded. The comparison contract is
 * unchanged (exact site_id/release_id/build_hash match); only the transport of
 * the evidence gains a second, independent path. The browser-landing half —
 * mirrorShotBelongsTo — has already passed before this runs.
 */
async function fetchMirrorIdentityHeaders(url, { fetchImpl = global.fetch, timeoutMs = 8_000 } = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, reason: "refetch_fetch_unavailable" };
  const parsed = (() => {
    try { return new URL(String(url || "")); } catch { return null; }
  })();
  if (!parsed || parsed.protocol !== "https:") return { ok: false, reason: "refetch_url_not_https" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 8_000));
  try {
    const res = await fetchImpl(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const headers = {};
    if (res && typeof res.headers === "object" && typeof res.headers.forEach === "function") {
      res.headers.forEach((value, name) => { headers[String(name).toLowerCase()] = String(value); });
    }
    return { ok: true, status: Number(res && res.status) || 0, headers };
  } catch (error) {
    return { ok: false, reason: `refetch_threw:${brief(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the shared release identity from the final main-document response.
 * Playwright exposes headers as a plain object; the small alternatives keep
 * this usable with Fetch-style Headers and deterministic injected test fakes.
 *
 * THE CLOSED-PAGE TRAP (the actual 2026-09-02 production break, reproduced):
 * captureOne closes its page before the caller reads the identity, and
 * `response.allHeaders()` is a CDP ROUND TRIP — on a closed page it throws
 * "Target page, context or browser has been closed", the whole read threw, and
 * every shared-identity shot was refused
 * (capture_identity_response_identity_unreadable) on every retry, in every
 * lane. So the read is now tiered, each tier named by `via`:
 *
 *   1. the live response object — with a fallback to `headers()`, the LOCAL
 *      snapshot that survives the page close (via: main_document_response),
 *   2. the snapshot captureOne took while the page was still open
 *      (capture.responseHeaders — via: captured_response_snapshot),
 *   3. the bounded server-side refetch of the URL (via: refetch) — only when
 *      the browser left no response object at all; the browser-landing half
 *      (mirrorShotBelongsTo) has already passed before this runs.
 */
async function mainDocumentResponseIdentity({ response, capture = null, requestedUrl = "", fetchImpl = undefined } = {}) {
  const parseHeaders = (headers) => {
    const values = {};
    if (headers && typeof headers.forEach === "function") {
      headers.forEach((value, name) => { values[String(name).toLowerCase()] = String(value); });
    } else if (headers && typeof headers === "object") {
      for (const [name, value] of Object.entries(headers)) {
        values[String(name).toLowerCase()] = String(value);
      }
    }
    return {
      site_id: String(values["x-wss-site-id"] || "").trim(),
      release_id: String(values["x-wss-release-id"] || "").trim(),
      build_hash: String(values["x-wss-build-hash"] || "").trim(),
      route_generation: String(values["x-wss-route-generation"] || "").trim(),
    };
  };

  const fromHeaders = async (source) => {
    if (!source) return null;
    let headers = null;
    try {
      if (typeof source.allHeaders === "function") headers = await source.allHeaders();
      else if (typeof source.headers === "function") headers = source.headers();
      else if (source.headers && typeof source.headers === "object") headers = source.headers;
    } catch {
      // A closed page takes allHeaders() with it; the LOCAL snapshot
      // (headers()) survives the close. Fall back to it before giving up.
      try {
        if (typeof source.headers === "function") headers = source.headers();
        else if (source.headers && typeof source.headers === "object") headers = source.headers;
      } catch { /* fall through to the tiered sources below */ }
    }
    if (!headers) return null;
    return parseHeaders(headers);
  };

  const direct = await fromHeaders(response);
  if (direct) return { ...direct, via: "main_document_response" };

  // The snapshot captureOne recorded while the page was open. If it exists it
  // is what the browser ACTUALLY received — trusted as-is, even when it lacks
  // the identity fields (that absence is the verdict, and the refetch must not
  // launder an error page into a passing identity).
  const snapshotHeaders = capture
    && typeof capture === "object"
    && capture.responseHeaders
    && typeof capture.responseHeaders === "object"
    ? capture.responseHeaders
    : null;
  if (snapshotHeaders) {
    return { ...parseHeaders(snapshotHeaders), via: "captured_response_snapshot" };
  }

  const refetched = await fetchMirrorIdentityHeaders(requestedUrl, { fetchImpl });
  if (!refetched.ok) {
    return { site_id: "", release_id: "", build_hash: "", route_generation: "", via: "refetch_failed", reason: refetched.reason };
  }
  return { ...parseHeaders(refetched.headers), via: "refetch" };
}

/** Exact, fail-closed comparison for a shared release's response headers. */
function sharedResponseIdentityMatches({ expected, actual } = {}) {
  const wanted = normalizeProofIdentity({ proofIdentity: expected });
  if (!wanted.active) return { ok: true, legacy: true };
  if (!wanted.valid) return { ok: false, reason: wanted.reason };
  const observed = normalizeProofIdentity({ proofIdentity: actual });
  if (!observed.active) return { ok: false, reason: "response_identity_missing" };
  if (!observed.valid) return { ok: false, reason: "response_identity_incomplete" };
  for (const field of ["site_id", "release_id", "build_hash"]) {
    if (observed[field] !== wanted[field]) return { ok: false, reason: `response_${field}_mismatch` };
  }
  return {
    ok: true,
    identity: {
      site_id: observed.site_id,
      release_id: observed.release_id,
      build_hash: observed.build_hash,
      ...(String(actual && actual.route_generation || "").trim()
        ? { route_generation: String(actual.route_generation).trim() }
        : {}),
    },
  };
}

/**
 * Is a stored shot the picture we would take today?
 *
 * "old" family — a picture of the PROSPECT'S site, which our builds do not
 * change, so the only question is identity: did the browser land on their own
 * registrable domain? That check is unchanged and still refuses on drift.
 *
 * "new" family — a picture of OUR mirror. Reusable only when the sidecar names
 * the SAME build_hash we are about to shoot. An absent hash on either side is
 * not a match: it is the absence of evidence, and the answer is to re-shoot.
 */
function storedShotIsCurrent({ meta, variant, url, buildHash, proofIdentity }) {
  if (!meta) return { ok: false, reason: "no_meta" };
  // A URL/build match without the pixel digest is not reusable proof. Older
  // sidecars can carry a valid identity but no SHA; treating those as current
  // produces an all-success result with an incomplete proof record, so every
  // Line retry repeats the same no-op forever. Re-shoot it once and persist the
  // complete v2/v3 sidecar instead.
  if (!hexOrEmpty(meta.shot_sha256)) {
    return { ok: false, reason: "stored_shot_missing_sha256" };
  }
  if (/^old(-|$)/.test(variant)) {
    const identity = capturedShotBelongsTo({
      capturedUrl: String(meta.captured_url || ""),
      expectedWebsite: url,
    });
    return identity.ok ? { ok: true } : { ok: false, reason: `identity_${identity.reason}` };
  }
  const identity = mirrorShotBelongsTo({
    capturedUrl: String(meta.captured_url || ""),
    expectedWebsite: url,
  });
  if (!identity.ok) return { ok: false, reason: `identity_${identity.reason}` };
  const shared = normalizeProofIdentity({ proofIdentity });
  if (shared.active) {
    if (!shared.valid) return { ok: false, reason: shared.reason };
    for (const field of ["site_id", "release_id", "build_hash"]) {
      const stored = String(meta[field] || "").trim();
      if (!stored) return { ok: false, reason: `stored_shot_missing_${field}` };
      if (stored !== shared[field]) return { ok: false, reason: `${field}_changed` };
    }
  }
  const wanted = String(buildHash || (shared.valid && shared.build_hash) || "").trim();
  if (!wanted) return { ok: false, reason: "no_build_hash_supplied" };
  const stored = String(meta.build_hash || "").trim();
  if (!stored) return { ok: false, reason: "stored_shot_predates_build_keying" };
  return stored === wanted ? { ok: true } : { ok: false, reason: "build_hash_changed" };
}

/**
 * ensureLineProofShots({ currentWebsite, previewUrl, buildHash, browser }) ->
 *   { ok, reason, shots: { old_captured_url, new_captured_url, … }, results }
 *
 * ok:true means EVERY desktop variant that was asked for is stored with clean
 * identity. Mobile variants are best-effort extras; their absence never blocks
 * a send.
 *
 * IT USED TO SAY YES HAVING DONE NOTHING. `okOld` was `!currentWebsite || …`,
 * so a prospect with no current website on file — the one case where a "before"
 * shot can never exist — reported ok:true with the old side of the comparison
 * empty. That is the exact "reports success having done nothing" shape this
 * codebase keeps getting burned by, and it made the flag worthless as an
 * answer to "may this email ship?". A variant that was not captured is now a
 * NO, with the reason named.
 *
 * @param {string} currentWebsite  the prospect's own site (the "before")
 * @param {string} previewUrl      our mirror (the "after")
 * @param {string} buildHash       which build the mirror is; enables reuse
 * @param {object} browser         an ALREADY-OPEN chromium. Not closed here.
 * @param {number} deadlineAt      epoch ms; past it, remaining variants are
 *                                 skipped rather than started. 0 = no deadline.
 */
async function ensureLineProofShots({
  currentWebsite = "",
  previewUrl = "",
  buildHash = "",
  proofIdentity = null,
  browser = null,
  deadlineAt = 0,
  now = Date.now,
  readResponseIdentity = mainDocumentResponseIdentity,
  captureShot = null,
  readProofShot = fetchProofShot,
  writeProofShot = uploadProofShot,
} = {}) {
  const wanted = [];
  // Secure the always-required "after" and the mobile "ours" half FIRST — the
  // email can't render without new-mobile. The slow, cold, less-reliable
  // third-party "before" shots run at the tail, so a tight budget starves the
  // prospect "before" (which already adapts to an ours-only pair), never the
  // mobile pair the email depends on.
  if (previewUrl) wanted.push({ variant: "new", url: previewUrl }, { variant: "new-mobile", url: previewUrl });
  if (currentWebsite) wanted.push({ variant: "old", url: currentWebsite }, { variant: "old-mobile", url: currentWebsite });
  if (!wanted.length) return { ok: false, reason: "nothing_to_capture", shots: {}, results: [] };

  const results = [];
  const shots = {};
  const shared = normalizeProofIdentity({ proofIdentity });
  const suppliedBuildHash = String(buildHash || "").trim();
  const sharedBuildMismatch = shared.active && shared.valid && suppliedBuildHash
    && suppliedBuildHash !== shared.build_hash;
  const effectiveBuildHash = shared.active && shared.valid ? shared.build_hash : suppliedBuildHash;
  const recordSharedIdentity = () => {
    if (!shared.active || !shared.valid) return;
    shots.site_id = shared.site_id;
    shots.release_id = shared.release_id;
    shots.build_hash = shared.build_hash;
  };
  // The browser we OPENED, as opposed to the one we were handed. Only ours is
  // closed here: closing the gate's browser out from under it would take the
  // page it is still reading with it.
  let owned = null;
  const acquire = async () => {
    if (browser) return browser;
    if (!owned) owned = await launchChromium();
    return owned;
  };
  try {
    for (const { variant, url } of wanted) {
      const sharedNew = /^new(-|$)/.test(variant) && shared.active;
      if (sharedNew && (!shared.valid || sharedBuildMismatch)) {
        results.push({
          variant,
          ok: false,
          reason: sharedBuildMismatch ? "shared_proof_build_hash_mismatch" : shared.reason,
        });
        continue;
      }
      const objectPath = proofObjectPath({ url, variant, proofIdentity: sharedNew ? shared : undefined });
      if (!objectPath) { results.push({ variant, ok: false, reason: "unkeyable_url" }); continue; }

      let meta = null;
      const metaPath = proofMetaPath({ url, variant, proofIdentity: sharedNew ? shared : undefined });
      const existing = await readProofShot(metaPath).catch(() => null);
      if (existing && existing.ok) {
        try { meta = JSON.parse(existing.buffer.toString("utf8")); } catch { meta = null; }
      }
      const current = storedShotIsCurrent({
        meta,
        variant,
        url,
        buildHash: effectiveBuildHash,
        proofIdentity: sharedNew ? shared : undefined,
      });
      if (current.ok) {
        const captured = String((meta && meta.captured_url) || "");
        // THE PIXEL DIGEST TRAVELS WITH THE REUSE. The email cache-busts its
        // <img> on this value (lib/email.js shotUrl); reusing a shot without it
        // hands Gmail's proxy the un-busted URL it already has a copy of, which
        // is the stale-thumbnail bug arriving through the reuse door.
        const storedSha = hexOrEmpty(meta && meta.shot_sha256);
        if (variant === "old") {
          shots.old_captured_url = captured || url;
          if (storedSha) shots.old_shot_sha = storedSha;
          // PROVENANCE RIDES THE REUSE TOO. A stored fallback capture (an
          // archive snapshot or the disclosed-absence card) must keep saying
          // what it is on every later send — a reuse that drops the marker
          // would let a disclosure card pass for a verified screenshot.
          const via = String((meta && meta.capture_via) || "live");
          if (via && via !== "live") shots.before_capture_via = via;
          const unavailable = String((meta && meta.before_unavailable) || "");
          if (unavailable) shots.before_unavailable = unavailable;
        }
        if (variant === "new") { shots.new_captured_url = captured || url; if (storedSha) shots.new_shot_sha = storedSha; }
        // The phone frame rides on the record the same way the stills do: the
        // email's mobile-vs-desktop pair is gated on this sha, so a mobile shot
        // that exists in the bucket but not on the record simply does not ship
        // — absence removes the block, exactly like every other email fact.
        if (variant === "new-mobile" && storedSha) { shots.new_mobile_shot_sha = storedSha; shots.new_mobile_captured_url = captured || url; }
        // THEIR site on a phone, same contract. This variant was captured and
        // uploaded from day one and never recorded, so the email's
        // theirs-vs-ours phone comparison had no evidence to gate on and could
        // never render. Identity is already settled here: storedShotIsCurrent
        // put every old-family reuse through capturedShotBelongsTo above.
        if (variant === "old-mobile" && storedSha) { shots.old_mobile_shot_sha = storedSha; shots.old_mobile_captured_url = captured || url; }
        if (sharedNew) recordSharedIdentity();
        results.push({ variant, ok: true, skipped: "already_stored", publicUrl: publicProofUrl(objectPath) });
        continue;
      }

      const remainingMs = deadlineAt ? deadlineAt - now() : Number.POSITIVE_INFINITY;
      if (remainingMs <= 5_000) {
        results.push({ variant, ok: false, reason: "capture_budget_exhausted" });
        continue;
      }

      let captured;
      try {
        const oldVariant = /^old(-|$)/.test(variant);
        // THE AFTER PAIR IS SECURED by the time a before variant runs — it is
        // captured first by design. That flips the budget question: the
        // before shot is then the only thing left between this row and a
        // refused send, and slow external sites are the EXPECTED case for
        // real businesses, so the before variants get the REMAINING budget
        // rather than a fixed 45s slice (ceiling is absolute: the chromium
        // permit and the invocation around it are both finite). Every other
        // case keeps the historical envelope — one navigation may fall back
        // from networkidle to load, so the slice is divided across both
        // attempts with 2.5s reserved for the settle, screenshot, upload,
        // and checkpoint that follow.
        const afterSecured = Boolean(shots.new_captured_url);
        const timeoutMs = oldVariant && afterSecured
          ? (Number.isFinite(remainingMs)
            ? Math.max(1_000, Math.min(BEFORE_EXTENDED_NAV_CEILING_MS, remainingMs - BEFORE_EXTENDED_RESERVE_MS))
            : BEFORE_EXTENDED_NAV_CEILING_MS)
          : (Number.isFinite(remainingMs)
            ? Math.max(1_000, Math.min(45_000, Math.floor((remainingMs - 2_500) / 2)))
            : 45_000);
        captured = captureShot
          ? await captureShot({ url, variant, timeoutMs })
          : await captureOne(await acquire(), { url, variant, timeoutMs });
      } catch (e) {
        results.push({ variant, ok: false, reason: `capture_failed: ${String(e.message || e).slice(0, 120)}` });
        continue;
      }
      const landed = captured.landed || url;
      // PROVENANCE OF A BEFORE FALLBACK. A capture that did not come off the
      // live site names its lane (archive_today / wayback / placeholder) and,
      // for the placeholder, the classified reason the live site refused us.
      // `landed` is the URL the picture ATTESTS to — the prospect's own url,
      // so the identity law below keeps holding — and the archive lane's
      // literal landing URL travels beside it. Nothing downstream may mistake
      // a disclosed-absence card for a verified screenshot.
      const beforeProvenance = (/^old(-|$)/.test(variant)
        && String(captured.capture_via || "live") !== "live")
        ? {
            capture_via: String(captured.capture_via).slice(0, 24),
            ...(captured.archive_landed_url
              ? { archive_landed_url: String(captured.archive_landed_url).slice(0, 300) }
              : {}),
            ...(captured.before_unavailable
              ? { before_unavailable: String(captured.before_unavailable).slice(0, 120) }
              : {}),
            ...(Array.isArray(captured.attempted) && captured.attempted.length
              ? { fallback_attempted: captured.attempted.slice(0, 8).map((s) => String(s).slice(0, 80)) }
              : {}),
          }
        : null;
      if (/^old(-|$)/.test(variant)) {
        const identity = capturedShotBelongsTo({ capturedUrl: landed, expectedWebsite: url });
        if (!identity.ok) {
          results.push({ variant, ok: false, reason: `capture_identity_${identity.reason}`, landedOn: registrableDomain(landed) });
          continue;
        }
      } else if (/^new(-|$)/.test(variant)) {
        const identity = mirrorShotBelongsTo({ capturedUrl: landed, expectedWebsite: url });
        if (!identity.ok) {
          results.push({ variant, ok: false, reason: `capture_identity_${identity.reason}`, landedOn: previewHostOf(landed) });
          continue;
        }
      }
      let responseIdentity = null;
      if (sharedNew) {
        let observed;
        try {
          observed = await readResponseIdentity({
            response: captured.response,
            capture: captured,
            requestedUrl: url,
            capturedUrl: landed,
            variant,
          });
        } catch {
          results.push({ variant, ok: false, reason: "capture_identity_response_identity_unreadable" });
          continue;
        }
        const responseMatch = sharedResponseIdentityMatches({ expected: shared, actual: observed });
        if (!responseMatch.ok) {
          results.push({ variant, ok: false, reason: `capture_identity_${responseMatch.reason}` });
          continue;
        }
        responseIdentity = responseMatch.identity;
        // PROVENANCE: did this identity come off the browser's own document
        // response, or from the bounded server-side refetch that rescues a
        // lost response? Named on the result and in the sidecar so a later
        // reader can always answer where the identity was read from.
        const identityVia = String((observed && observed.via) || "").trim().slice(0, 32);
        if (identityVia) responseIdentity = { ...responseIdentity, response_identity_via: identityVia };
      }
      // FINGERPRINT THE PIXELS. The object key is derived from the URL, which
      // does not change when we rebuild — so the email's <img> src was byte-for
      // -byte identical across runs and Gmail's image proxy kept serving the
      // copy it cached the first time. Four "fixed" emails arrived showing the
      // old colours for exactly this reason. The digest travels to the email so
      // a changed screenshot mints a changed URL that no proxy has seen.
      const shotSha = createHash("sha256").update(captured.buffer).digest("hex");
      if (variant === "old") {
        shots.old_shot_sha = shotSha;
        if (beforeProvenance) {
          shots.before_capture_via = beforeProvenance.capture_via;
          if (beforeProvenance.before_unavailable) shots.before_unavailable = beforeProvenance.before_unavailable;
        }
      }
      if (variant === "old-mobile") shots.old_mobile_shot_sha = shotSha;
      if (variant === "new") shots.new_shot_sha = shotSha;
      if (variant === "new-mobile") shots.new_mobile_shot_sha = shotSha;

      const up = await writeProofShot(objectPath, captured.buffer, { contentType: "image/jpeg" });
      if (up.ok !== true) { results.push({ variant, ok: false, reason: `upload_failed: ${up.reason || up.status || ""}` }); continue; }
      const metaUp = await writeProofShot(
        metaPath,
        Buffer.from(JSON.stringify({
          schema: sharedNew ? "wss-proof-shot-meta-v3" : "wss-proof-shot-meta-v2",
          variant,
          requested_url: String(url),
          captured_url: landed,
          captured_domain: registrableDomain(landed),
          bytes: captured.buffer.length,
          // Where a fallback capture actually happened (the archive page), so
          // the sidecar stays a complete account of itself. Absent for live
          // shots, whose captured_url IS the landing URL.
          ...(beforeProvenance || {}),
          // The two facts that make a stored shot answerable later: WHICH BUILD
          // it is a picture of, and WHAT the pixels hash to. Without the first
          // the only safe policy is to re-shoot every send; without the second a
          // reused shot loses the email's cache-bust.
          build_hash: String(effectiveBuildHash || "") || null,
          ...(sharedNew ? {
            site_id: shared.site_id,
            release_id: shared.release_id,
            ...(responseIdentity && responseIdentity.route_generation
              ? { route_generation: responseIdentity.route_generation }
              : {}),
            ...(responseIdentity && responseIdentity.response_identity_via
              ? { response_identity_via: responseIdentity.response_identity_via }
              : {}),
          } : {}),
          shot_sha256: shotSha,
          // Named degradation, not a silent one: this shot's wait strategy
          // outran its budget slice and fired on whatever had painted. The
          // pixels and identity checks above still apply in full.
          ...(captured.waitDegraded ? { capture_wait_degraded: String(captured.waitDegraded).slice(0, 80) } : {}),
          // HERO-AWARE FRAMING provenance (2026-09-05, audit A4): the shot was
          // reframed onto the hero CONTENT anchor — positive evidence the
          // frame shows the site's actual presentation, not its empty top.
          ...(captured.framedVia ? { capture_framed_via: String(captured.framedVia).slice(0, 32) } : {}),
          // THE SHOT-QUALITY GUARD'S RECORD: a blank/uniform first frame earns
          // ONE scroll-to-content retry; the named outcome and the measured
          // stats (audit A4's luminance stddev + near-uniform tile share) ride
          // the sidecar so the next audit starts from the numbers.
          ...(captured.blankCheck ? { shot_blank_check: String(captured.blankCheck).slice(0, 32) } : {}),
          ...(captured.shotStats && Number.isFinite(Number(captured.shotStats.std))
            ? { shot_luma_std: Number(captured.shotStats.std), shot_flat_pct: Number(captured.shotStats.flatPct) }
            : {}),
          captured_at: new Date().toISOString(),
          captured_by: "line-proof-shots",
        }, null, 2), "utf8"),
        { contentType: "application/json" },
      );
      // A shared image without its immutable identity sidecar is not stored
      // proof. Keep the legacy best-effort sidecar behavior untouched, but
      // fail closed for the shared contract so no caller records this shot.
      if (sharedNew && metaUp.ok !== true) {
        results.push({ variant, ok: false, reason: `meta_upload_failed: ${metaUp.reason || metaUp.status || ""}` });
        continue;
      }
      if (variant === "old") shots.old_captured_url = landed;
      // Recorded ONLY after the identity check above and the upload both
      // passed — so a recorded old-mobile pair is proof the phone shot exists
      // AND was taken on the prospect's own registrable domain.
      if (variant === "old-mobile") shots.old_mobile_captured_url = landed;
      if (variant === "new") shots.new_captured_url = landed;
      if (variant === "new-mobile") shots.new_mobile_captured_url = landed;
      if (sharedNew) recordSharedIdentity();
      results.push({
        variant,
        ok: true,
        publicUrl: publicProofUrl(objectPath),
        landedOn: registrableDomain(landed),
        // The report field for a budget-degraded wait: the shot exists and
        // passed every identity check, and the report says its paint was not
        // fully settled when the shutter fired.
        ...(captured.waitDegraded ? { capture_wait_degraded: String(captured.waitDegraded).slice(0, 80) } : {}),
        // Framing provenance and the blank guard's named outcome travel to the
        // report beside the wait degradation they complement.
        ...(captured.framedVia ? { capture_framed_via: String(captured.framedVia).slice(0, 32) } : {}),
        ...(captured.blankCheck ? { shot_blank_check: String(captured.blankCheck).slice(0, 32) } : {}),
        ...(captured.shotStats && Number.isFinite(Number(captured.shotStats.std))
          ? { shot_luma_std: Number(captured.shotStats.std), shot_flat_pct: Number(captured.shotStats.flatPct) }
          : {}),
        // Same honesty law for a fallback capture: ok:true says the before
        // SLOT is filled, and the provenance beside it says how.
        ...(beforeProvenance ? { ...beforeProvenance } : {}),
        // Where the shared identity was read from (main_document_response,
        // captured_response_snapshot, or refetch) — the answer to "how do we
        // know this shot is this build".
        ...(responseIdentity && responseIdentity.response_identity_via
          ? { response_identity_via: responseIdentity.response_identity_via }
          : {}),
      });
    }
  } finally {
    if (owned) await owned.close().catch(() => {});
  }

  // NOTHING IS VACUOUSLY TRUE. Each side is a yes only if a shot is actually
  // stored for it; a side that was never asked for is a no with a reason,
  // because "we have no before image" must not read as "the comparison is fine".
  //
  // The reason NAMES the failing variant's own cause. The 2026-09-02 rows were
  // stuck for days on the bare "no_after_shot" while the actual cause sat in
  // `results` and was thrown away — an operator (and the recapture marker)
  // must read the guard that fired, not a family label.
  const namedFamilyMiss = (familyRe, fallback) => {
    const failed = results.find((entry) => (
      entry && entry.ok === false && familyRe.test(String(entry.variant || ""))
      && String(entry.reason || "").trim()
    ));
    return failed
      ? `${fallback}:${String(failed.variant).slice(0, 12)}=${String(failed.reason).slice(0, 140)}`
      : fallback;
  };
  const missing = [];
  if (!currentWebsite) missing.push("no_current_website");
  else if (!shots.old_captured_url) missing.push(namedFamilyMiss(/^old(?:-|$)/, "no_before_shot"));
  if (!previewUrl) missing.push("no_preview_url");
  else if (!shots.new_captured_url) missing.push(namedFamilyMiss(/^new(?:-|$)/, "no_after_shot"));
  return {
    ok: missing.length === 0,
    ...(missing.length ? { reason: missing.join(",") } : {}),
    shots,
    results,
  };
}

module.exports = {
  ensureLineProofShots,
  storedShotIsCurrent,
  mirrorShotBelongsTo,
  mainDocumentResponseIdentity,
  sharedResponseIdentityMatches,
  urlForVariant,
  // The BEFORE-resilience seam (2026-09-02): exported for the classifier and
  // card fixtures so tests can pin exactly what counts as a bot-block and
  // what the disclosed-absence card says.
  classifyBeforeNavigation,
  placeholderCardHtml,
  waybackLatestSnapshot,
  BEFORE_CHALLENGE_MARKERS,
  BEFORE_EXTENDED_NAV_CEILING_MS,
  // The shot-quality seam (2026-09-05, audit A4): exported so the suites can
  // run the REAL pixel meter against real chromium and pin the blank verdict's
  // thresholds to audit A4's measured bands.
  measureShotUniformity,
  shotLooksBlank,
  SHOT_BLANK_STD_MIN,
  SHOT_BLANK_FLAT_PCT_MAX,
};
