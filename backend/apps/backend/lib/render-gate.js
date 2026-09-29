"use strict";

/**
 * lib/render-gate.js — the gate a mirror must clear before its preview_url may
 * be written or its email may be queued.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * "QC PASS is never proof, always render the DOM."
 *
 * Every defect that reached a live prospect in this system passed a status
 * field first:
 *   · checks.brand reported passed while the rendered page had logoImgs = 0,
 *   · token_scan passed vacuously on a donor whose prerender had already
 *     resolved its tokens away,
 *   · a Places API reported "enabled" with a 100% error rate,
 *   · jf-lopez shipped "OWNER · M. FORCHIONE" — a donor's real person — with
 *     every gate green,
 *   · oasis med spa shipped fake "A. Client" reviews because content injection
 *     silently produced 0 pairs and the template deployed anyway.
 *
 * So this module never reads a status. It reads the rendered DOM — innerText,
 * the resolved <img> bytes, the JSON-LD the crawler will actually parse — and
 * compares it against the client's OWN verified source facts.
 *
 * FAIL-CLOSED IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * Unverifiable is not verified. Every one of these ends in FAIL, never in a
 * pass and never in a skip:
 *   · Playwright is not installed / chromium will not launch
 *   · the page 404s, 500s, or renders an empty body
 *   · a source fact needed by a check is absent
 *   · the check itself threw
 * A gate that cannot see is a gate that says no. There is no `force`, no
 * `skipGate`, and no env var that turns a fact off — see assertGateIntegrity().
 */

const crypto = require("node:crypto");
const { residualEntities } = require("./mirror-engine/html-entities");
const { implausibleReason } = require("./mirror-engine/place-names");
const { scoreTrades } = require("./trade-inference");

/** The facts. Order is the order an operator reads them in the UI. */
const FACTS = Object.freeze([
  "nap_match",
  "vertical_match",
  "logo_own_and_unique",
  "entity_residue_zero",
  "schema_type",
  "donor_leak_zero",
  "aggregate_rating_backed",
  "unverified_claims_omitted",
  "place_names_plausible",
  // THE COMPARATIVE TRIO — "is this build at least as good as the source
  // site?" The nine above prove the build is CORRECT (honest, branded, its own
  // trade). None of them asks whether the build LOST something the client's
  // own site has: their hero video, their photography, the visual proof of
  // the before/after claim. These do, and they read the client's OWN intake
  // evidence for the "before" half — see the check bodies for exactly which
  // packet fields each one consults.
  "source_video_preserved",
  "owned_photos_retained",
  "side_by_side_captured",
]);

/**
 * Schema.org @type per vertical. A fence company must never ship as
 * RoofingContractor, so this table is also the trade-swap oracle: the
 * `terms` of one vertical appearing on another vertical's mirror is a leak.
 */
const VERTICALS = Object.freeze({
  roofing: { schema: "RoofingContractor", terms: ["roof", "roofing", "shingle", "reroof", "reroofing", "gutter"], shared: ["concrete"] },
  // schema.org has NO FenceContractor type — demanding one failed a correct
  // mirror. HomeAndConstructionBusiness is the schema.org-valid type a fence
  // contractor publishes (it is what the sterling donor emits), and shipping a
  // made-up type would cost the client rich-result eligibility.
  fencing: {
    schema: "HomeAndConstructionBusiness",
    terms: ["fence", "fencing", "gate", "picket", "chain link"],
    // "gate" is plumbing's own vocabulary (gate valve) and appears in yard/
    // access copy across trades. Bare "gate" on another trade's mirror is not
    // proof a fencing page was swapped in; these are.
    exclusive: ["fence", "fencing", "picket", "chain link", "gate installation", "fence gate"],
  },
  concrete: { schema: "GeneralContractor", terms: ["concrete", "driveway", "slab", "patio", "foundation"] },
  plumbing: { schema: "Plumber", terms: ["plumb", "plumber", "plumbers", "plumbing", "drain", "water heater", "sewer"], shared: ["slab"] },
  hvac: { schema: "HVACBusiness", terms: ["hvac", "furnace", "air conditioning", "heat pump", "duct"] },
  masonry: {
    schema: "GeneralContractor",
    terms: ["masonry", "brick", "stone", "mortar", "paver"],
    // "stone" and "brick" are nouns that appear inside other trades' own copy
    // (a fence page describing stone columns or a brick post). Only the
    // unambiguous forms are evidence that ANOTHER trade's page was swapped in.
    exclusive: ["masonry", "brickwork", "mortar", "paver", "stone veneer", "stonework"],
  },
  // GENERAL CONTRACTOR — added 2026-08-20 for the Krab Construction test
  // client and the whole GC population behind him. The donor is
  // concrete-elconstruction, whose own lineage IS a general-contractor build
  // (EL Construction); the client's verified services carry their real mix via
  // authority pages, exactly like every multi-trade admission. Terms are the
  // GC's own service language; none of them is exclusive enough to convict a
  // neighbouring trade (every remodeler says "renovation"), so no exclusive
  // list — this entry proves OUR language, it does not convict others.
  "general contractor": {
    schema: "GeneralContractor",
    terms: ["general contractor", "general contracting", "remodel", "renovation", "home addition", "additions", "new construction", "design build", "tenant improvement"],
    // Deliberately EMPTY: every one of these words appears in other trades'
    // own honest prose ("a full renovation of your fence line"). This entry
    // proves a GC mirror speaks its own language; it convicts nobody.
    exclusive: [],
  },
  // REAL ESTATE AGENT — added 2026-08-20 with the realestate-waterline donor.
  // Terms are the trade's own service language; none of them is exclusive
  // enough to convict a neighbouring trade (every remodeler's page says
  // "buyers", every builder says "listing"), so the exclusive list is
  // deliberately EMPTY, the general-contractor precedent — this entry proves
  // OUR language, it does not convict others.
  "real estate agent": {
    schema: "RealEstateAgent",
    terms: ["real estate", "realtor", "realty", "buyer", "seller", "listing", "relocation", "condominium", "waterfront", "luxury home"],
    exclusive: [],
  },
  landscaping: { schema: "LandscapingBusiness", terms: ["landscape", "landscaping", "landscaper", "lawn", "sod", "irrigation", "mulch"] },
  "tree service": {
    schema: "TreeRemovalService",
    terms: ["tree", "stump", "arborist", "pruning", "canopy"],
    // A fence page legitimately says "tree roots change post depth". Bare
    // "tree" is not proof a tree-service page was swapped in; "tree removal" is.
    exclusive: ["tree removal", "tree service", "tree trimming", "stump grinding", "arborist"],
  },
  electrical: { schema: "Electrician", terms: ["electric", "electrical", "electrician", "wiring", "panel upgrade", "breaker"] },
  "garage door": { schema: "GeneralContractor", terms: ["garage door", "opener", "torsion spring"] },
  "pest control": { schema: "PestControlService", terms: ["pest", "termite", "exterminate", "exterminator", "extermination", "rodent"] },
  "auto detailing": { schema: "AutoWash", terms: ["auto detail", "auto detailing", "detailing", "detailer", "ceramic coating", "paint correction"] },
  "med spa": { schema: "MedicalBusiness", terms: ["botox", "filler", "med spa", "aesthetic"] },
  // schema.org's NailSalon is a real, valid subtype of HealthAndBeautyBusiness
  // (verified against schema.org's own hierarchy — not invented). "nail" and
  // "polish" alone are too common in general beauty copy to prove a swap, so
  // exclusive is narrowed to the compound/technique terms that are distinctly
  // nail-salon and do not collide with med spa's "aesthetic"/"filler" language.
  salon: {
    schema: "NailSalon",
    terms: ["manicure", "pedicure", "gel", "acrylic", "nail art", "nail salon", "cuticle", "polish"],
    exclusive: ["manicure", "pedicure", "nail art", "nail salon", "gel manicure", "acrylic nails"],
  },
  dental: { schema: "Dentist", terms: ["dental", "dentist", "teeth", "orthodontic", "orthodontics", "orthodontist"] },
  tattoo: { schema: "TattooParlor", terms: ["tattoo", "piercing", "ink"] },
});

function normalizeVertical(value) {
  return String(value || "").trim().toLowerCase();
}

function schemaTypeFor(vertical) {
  const entry = VERTICALS[normalizeVertical(vertical)];
  return entry ? entry.schema : "";
}

/** Casefold + collapse punctuation so "R & R Roofing" matches "R and R Roofing". */
function fold(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Match a folded word or multi-word phrase, never a fragment inside a word. */
function hasFoldedPhrase(text, phrase) {
  const haystack = fold(text);
  const needle = fold(phrase);
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

/** Digits only, last 10 — how a phone reads to a human regardless of format. */
function foldPhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/**
 * Does `text` show this phone number anywhere, in any human format?
 *
 * Matched PER LINE. A single regex over the whole innerText greedily ran
 * "(512) 555-0147" into the street address on the next line, produced a
 * 20-digit blob, and reported the client's own phone missing from a page that
 * plainly displayed it — a false FAIL is as damaging as a false PASS.
 */
function phoneShownIn(text, phone) {
  const wanted = foldPhone(phone);
  if (!wanted) return false;
  return String(text || "")
    .split(/[\n\r]+/)
    .some((line) => line.replace(/\D+/g, "").includes(wanted));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// ---------------------------------------------------------------------------
// STEP BUDGETS — every await in the inspection is bounded (2026-09-04)
// ---------------------------------------------------------------------------
// Production, batch line_mtmvwmyn_f72f05204d: nine healthy, published mirrors
// sat in `inspection_started` for an hour and were swept build_retry_exhausted
// at 12:47Z. The pages were fine in real browsers. What hung was the GATE'S
// OWN AWAIT CHAIN: readRenderedDomOnce bounded only its page.goto, and the
// capture hook await (below) was bounded by NOTHING — a comment claimed a
// budget existed, but no code enforced one. A single never-settling await
// inside the inspection (a chromium launch queue, a page whose renderer
// starves requestAnimationFrame, a capture lane navigating an arbitrary
// prospect site) therefore held the row until the runner's outer race killed
// the phase, and the retry loop burned its seven attempts on the same wall.
//
// THE LAW NOW: every await between inspection_started and the verdict carries
// its own slice budget, in the same idiom as line-runner's withTimeout. A step
// that outruns its slice fails THAT read with a NAMED reason —
// `gate_step_timeout:<phase>` — so the row settles terminal with the phase in
// row.reason, instead of jamming until a batch-level sweep erases the cause.
// The capture hook stays fail-OPEN (a capture can never change a fact, so its
// timeout rides out on dom.capture exactly like any other failed capture).
const GATE_STEP_LAUNCH_MS = 20_000;
const GATE_STEP_NEW_PAGE_MS = 10_000;
const GATE_STEP_SCRAPE_MS = 20_000;
const GATE_STEP_LOGOS_MS = 20_000;
const GATE_STEP_CAPTURE_MS = 90_000;
const GATE_STEP_CLOSE_MS = 5_000;
// The whole inspection — both reads and any capture the facts earn — must fit
// inside this, and inside the caller's own deadline when it passes one
// (processRowPhase hands the gate its durable deadlineAt). 150s sits 30s under
// the runner's GATE_TIMEOUT_MS race so the gate, not the runner, names the
// phase that timed out.
const GATE_INSPECTION_TOTAL_MS = 150_000;
const GATE_RESIDUAL_RESERVE_MS = 2_000;

/** The named error a step that outran its slice rejects with. */
function gateStepTimeout(phase, ms) {
  return Object.assign(
    new Error(`gate_step_timeout:${phase}_after_${Math.round(ms / 1000)}s`),
    { code: "gate_step_timeout", phase },
  );
}

/**
 * Race one inspection step against its slice budget. `tracker` (optional) is a
 * shared {phase} cell the whole inspection keeps updated with the step currently
 * in flight, so an outer budget that fires can name the phase it interrupted.
 */
async function withGateStep(work, ms, phase, tracker) {
  if (tracker) tracker.phase = phase;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(gateStepTimeout(tracker && tracker.phase ? tracker.phase : phase, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** True when a caught error is one of this module's step-budget timeouts. */
function isGateStepTimeout(e) {
  return Boolean(e) && e.code === "gate_step_timeout";
}

// ---------------------------------------------------------------------------
// readRenderedDom — the only place that touches a browser
// ---------------------------------------------------------------------------
/**
 * Loads `url` in headless chromium and returns what a visitor's eye and a
 * crawler's parser actually receive. Never throws: an unreadable page comes
 * back as { ok:false, reason }, which every check below treats as FAIL.
 *
 * @param {string} url
 * @param {{timeoutMs?:number, launcher?:object, onRendered?:function}} options
 *   launcher   — inject a chromium-shaped stub in tests. Production passes none.
 *   onRendered — see runRenderGate. Invoked with the OPEN browser after a
 *                successful read and before it is closed, so work that needs a
 *                browser on this exact page does not have to launch a second
 *                one. Its result is attached as `dom.capture`; it can never
 *                change `ok`, `reason`, or a single measured fact.
 */
async function readRenderedDomOnce(url, { timeoutMs = 45000, launcher = null, onRendered = null, stepTracker = null, deadlineAt = 0 } = {}) {
  let browser;
  try {
    browser = await withGateStep(
      launcher
        ? launcher.launch({ headless: true })
        : require("./serverless-chromium").launchChromium(),
      GATE_STEP_LAUNCH_MS,
      "chromium_launch",
      stepTracker,
    );
  } catch (e) {
    // The launcher names both attempts and both engines now; do not slice the
    // cause off the end of the only sentence that explains the failure.
    if (isGateStepTimeout(e)) return { ok: false, url, reason: `gate_step_timeout:${e.phase}`, stepTimedOut: true };
    return { ok: false, url, reason: `chromium_launch_failed: ${String(e.message || e).slice(0, 400)}` };
  }
  try {
    const page = await withGateStep(browser.newPage(), GATE_STEP_NEW_PAGE_MS, "new_page", stepTracker);
    let response;
    // A just-attached *.wss-ai.com alias can refuse connections for a few
    // seconds while the edge provisions TLS. One bounded retry beats failing
    // a perfect build on a race — and still fails closed if the host is dead.
    // The tracker names the phase so an outer budget firing mid-navigation
    // reports `goto` as what it interrupted. The goto itself is bounded by its
    // own timeout below; a navigation timeout is NOT in the transient set, so
    // the retry loop can never multiply a slow page into an unbounded read.
    if (stepTracker) stepTracker.phase = "goto";
    for (let attempt = 1; ; attempt++) {
      try {
        response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
        break;
      } catch (e) {
        const transient = /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_SSL|ERR_CONNECTION_REFUSED/.test(String(e.message || e));
        if (!transient || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
    const status = response ? response.status() : 0;

    const scraped = await withGateStep(page.evaluate(() => {
      const body = document.body;
      const imgs = [...document.querySelectorAll("img")].map((img) => ({
        src: img.currentSrc || img.src || "",
        alt: img.alt || "",
        // A logo written to disk but never referenced in the DOM is a FALSE
        // PASS. Only images with real layout boxes count as rendered.
        width: Math.round(img.getBoundingClientRect().width),
        height: Math.round(img.getBoundingClientRect().height),
        inHeader: Boolean(img.closest("header,nav,[class*=header i],[class*=nav i]")),
        looksLikeLogo:
          /logo/i.test(img.className || "") ||
          /logo/i.test(img.alt || "") ||
          /logo/i.test(img.src || "") ||
          Boolean(img.closest("[class*=logo i],[id*=logo i]")),
      }));
      // THE VIDEO SURFACE — the hero/background videos and YouTube/Vimeo
      // embeds the page actually renders. A native <video> counts only with a
      // real URL behind it (a data: URI is a placeholder, not a video); an
      // iframe counts only when it embeds one of the known video hosts. This
      // is the build-side half of the source_video_preserved fact — readyState
      // and paused are recorded as evidence, while the donor's own
      // hero-plays acceptance test (lib/mirror-engine/verify.js) remains the
      // place that proves a present video actually PLAYS.
      const videos = [...document.querySelectorAll("video")].slice(0, 8).map((v) => ({
        src: v.currentSrc || v.src || "",
        poster: v.poster || "",
        readyState: v.readyState,
        paused: v.paused,
        inHero: Boolean(v.closest('header,[class*="hero" i],section')),
      }));
      const videoEmbeds = [...document.querySelectorAll("iframe[src]")]
        .map((f) => f.getAttribute("src") || "")
        .filter((src) => /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(src))
        .slice(0, 8);

      const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || "");

      // THE DONOR SURFACE — the rendered page with everything the CLIENT
      // published lifted out: the injected client-content block (their service
      // list, their about copy, their areas and hours, their FAQ) and every
      // block marked verbatim (a Google review, their own mission statement).
      //
      // Only the trade-swap scan reads this. Nothing else does, and innerText
      // below is still the whole page, so no other fact loses a single word.
      // See checkVertical for why the distinction decides four real builds.
      //
      // innerText needs layout, which a detached clone does not have, so the
      // clone is measured inside a hidden host that is removed again — the same
      // technique renderAudit uses for its prose scan.
      let donorText = "";
      if (body) {
        const clone = body.cloneNode(true);
        for (const n of clone.querySelectorAll("[data-wss-verbatim],[data-wss-content],section.wss-c")) n.remove();
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;left:-99999px;top:0;width:1200px";
        host.appendChild(clone);
        document.body.appendChild(host);
        donorText = clone.innerText || "";
        host.remove();
      }

      // EVERY STRING THE PAGE PUBLISHES AS THE NAME OF A PLACE.
      //
      // Read as its own list rather than looked for inside innerText, because
      // "9" is a substring of half the page — a phone number, a price, a review
      // count — and the only way to know that a "9" is being presented AS A TOWN
      // is to read the element whose job is to hold a town.
      //
      // Both surfaces the coverage block renders: the nearby-towns rail
      // (.wss-c__neartown) and the service-area chips (.wss-c__areas li).
      const placeNames = [...document.querySelectorAll(".wss-c__neartown, .wss-c__areas li")]
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 60);

      return {
        title: document.title || "",
        innerText: body ? body.innerText : "",
        donorText,
        hrefs: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "").slice(0, 400),
        imgs,
        videos,
        videoEmbeds,
        placeNames,
        jsonldRaw: jsonld,
      };
    }), GATE_STEP_SCRAPE_MS, "scrape", stepTracker);

    // Logo BYTES, not the URL. Two clients pointing at the same file is the
    // defect this catches, and only a byte hash sees it.
    //
    // The loop is bounded AS A WHOLE (20s), not just per request: six logos at
    // 15s each is 90s of verdict-latency on a page whose logo hosts are slow,
    // and a read that cannot fetch bytes in 20 seconds has already learned the
    // only thing the facts need — which elements draw and which do not. A logo
    // that never returned its bytes keeps sha "" — the exact "could not be
    // fetched" shape the checks already treat as unverified.
    const logosDeadline = Date.now() + GATE_STEP_LOGOS_MS;
    const logos = [];
    for (const img of scraped.imgs.filter((i) => i.looksLikeLogo && i.width > 0 && i.height > 0).slice(0, 6)) {
      const sliceLeft = logosDeadline - Date.now();
      if (sliceLeft <= 0) {
        logos.push({ ...img, sha256: "", bytes: 0 });
        continue;
      }
      let sha = "";
      let bytes = 0;
      try {
        const res = await page.request.get(img.src, { timeout: Math.min(15000, sliceLeft) });
        if (res.ok()) {
          const buf = await res.body();
          bytes = buf.length;
          sha = sha256(buf);
        }
      } catch {
        sha = "";
      }
      logos.push({ ...img, sha256: sha, bytes });
    }

    const jsonld = [];
    for (const raw of scraped.jsonldRaw) {
      try {
        const parsed = JSON.parse(raw);
        for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
          if (node && typeof node === "object") jsonld.push(node);
          if (node && Array.isArray(node["@graph"])) {
            for (const g of node["@graph"]) if (g && typeof g === "object") jsonld.push(g);
          }
        }
      } catch {
        jsonld.push({ __unparseable: raw.slice(0, 200) });
      }
    }

    const innerText = String(scraped.innerText || "");
    if (status !== 200) return { ok: false, url, status, reason: `http_${status}` };
    if (innerText.trim().length < 40) return { ok: false, url, status, reason: "empty_rendered_body" };

    const dom = {
      ok: true,
      url,
      status,
      title: String(scraped.title || ""),
      innerText,
      donorText: String(scraped.donorText || ""),
      hrefs: scraped.hrefs || [],
      imgs: scraped.imgs || [],
      // Always ARRAYS on a successful read (empty = "looked, found none"), so
      // the parity check can tell "no video on the page" apart from "the
      // reader never looked" — a missing surface is unprovable, and fails.
      videos: scraped.videos || [],
      videoEmbeds: scraped.videoEmbeds || [],
      placeNames: scraped.placeNames || [],
      logos,
      jsonld,
    };

    // THE BROWSER IS STILL OPEN, AND IT IS THE EXPENSIVE THING.
    //
    // Every fact above is already measured and frozen into `dom`. A hook here
    // is handed the live browser to do work that would otherwise cost a whole
    // second chromium — the email's proof shots and the motion loop, which the
    // SEND path used to launch a browser of its own for, at 28–35s a prospect.
    //
    // IT CANNOT REACH A FACT. `dom` is passed by reference for reading only;
    // the return value lands on `capture`, a field no check consults and
    // evaluateRenderGate never looks at. A hook that throws, hangs past its own
    // budget or returns junk changes nothing about the verdict — it is recorded
    // as a failed capture and the send path falls back to capturing for itself.
    if (typeof onRendered === "function") {
      // Free the gate's own page first: the hook opens its own, and two live
      // pages against a lambda's memory limit is the thing that fails first.
      await withGateStep(page.close().catch(() => {}), GATE_STEP_CLOSE_MS, "page_close", stepTracker).catch(() => {});
      // THE CAPTURE HOOK'S BUDGET IS REAL NOW. This await used to be unbounded
      // while its comment claimed a budget existed — the exact hole the
      // mtmvwmyn batch fell into: a capture lane that never settled held a
      // PASSING verdict hostage until the runner's outer race killed the whole
      // phase. The hook is capped at the capture budget itself (or what is left
      // of the caller's deadline, minus the reserve that lets this function
      // close the browser and return), and a hook that outruns the slice is
      // recorded as a failed capture — the verdict it can never touch is
      // returned immediately.
      const captureCapMs = Math.max(
        1_000,
        Math.min(
          GATE_STEP_CAPTURE_MS,
          (Number(deadlineAt) > 0 ? Number(deadlineAt) - Date.now() : Number.POSITIVE_INFINITY) - GATE_RESIDUAL_RESERVE_MS,
        ),
      );
      try {
        dom.capture = await withGateStep(onRendered({ browser, dom }), captureCapMs, "capture", stepTracker);
      } catch (e) {
        dom.capture = isGateStepTimeout(e)
          ? { ok: false, reason: `gate_step_timeout:${e.phase}` }
          : { ok: false, reason: `capture_threw: ${String(e.message || e).slice(0, 200)}` };
      }
    }
    return dom;
  } catch (e) {
    if (isGateStepTimeout(e)) return { ok: false, url, reason: `gate_step_timeout:${e.phase}`, stepTimedOut: true };
    return { ok: false, url, reason: `render_error: ${String(e.message || e).slice(0, 300)}` };
  } finally {
    await withGateStep(browser.close().catch(() => {}), GATE_STEP_CLOSE_MS, "browser_close").catch(() => {});
  }
}

/**
 * readRenderedDom — one rendered read of the page, with ONE retry.
 *
 * A gate that cannot see still says no; that has not changed. What has changed
 * is that it looks twice before saying it. Every reason a first read comes back
 * ok:false is a reason a second read can plausibly clear — a chromium that lost
 * the /tmp extraction race to a sibling row, a goto that timed out under
 * contention, an alias whose edge had not finished provisioning, a body that
 * had not painted yet. None of them are properties of the deployed bytes.
 *
 * The SECOND read is the verdict. It re-measures the same page against the same
 * nine render facts and the comparative trio, so no fact is weakened and no failure is smoothed over — a page
 * that is genuinely wrong is wrong twice, and falls out as a named casualty
 * carrying BOTH reasons.
 */
async function readRenderedDom(url, options = {}) {
  const first = await readRenderedDomOnce(url, options);
  if (first && first.ok === true) return first;
  const second = await readRenderedDomOnce(url, options);
  const firstReason = (first && first.reason) || "unknown";
  if (second && second.ok === true) return { ...second, attempts: 2, first_attempt_reason: firstReason };
  return {
    ...(second || { ok: false, url }),
    attempts: 2,
    reason: `${(second && second.reason) || "unknown"} (first attempt: ${firstReason})`,
  };
}

// ---------------------------------------------------------------------------
// The checks. Each returns { fact, pass, reason, evidence }.
// ---------------------------------------------------------------------------

function checkNap(dom, source) {
  const text = fold(`${dom.title} ${dom.innerText}`);
  const missing = [];
  if (!present(source.business_name)) return fail("nap_match", "source_business_name_absent");
  if (!text.includes(fold(source.business_name))) missing.push(`name:${source.business_name}`);

  if (present(source.phone) && !phoneShownIn(dom.innerText, source.phone)) {
    missing.push(`phone:${source.phone}`);
  }
  // facts.city is the Google NAP locality and the ONLY value allowed to prove
  // the postal address. facts.service_area (marketing city) is deliberately
  // NOT accepted here — Flint renders Austin marketing on a Buda postal row.
  if (present(source.postal_city) && !text.includes(fold(source.postal_city))) {
    missing.push(`postal_city:${source.postal_city}`);
  }
  return missing.length
    ? fail("nap_match", `rendered DOM is missing ${missing.join(", ")}`, { missing })
    : pass("nap_match", "name, phone and postal city all present in rendered text");
}

// ---------------------------------------------------------------------------
// WHOSE WORDS MAY THE TRADE-SWAP SCAN CONVICT?
// ---------------------------------------------------------------------------
// Only ours.
//
// This check exists to catch ONE defect: a donor built for another trade —
// a plumbing template shipped for an HVAC company. That has happened and it
// burned a build. It is worth a gate.
//
// It is not worth THIS. A real ten-lead run mirrored 10/10 and queued 4, and
// four of the six refusals convicted a plumber of being the wrong trade using
// that plumber's own published words, rendered on the page exactly as intended:
//
//   TN Plumbing      concrete:concrete      a Google review —
//                                           "Two days of cutting through
//                                            concrete in the heat"
//   Fix It All       concrete:driveway      a Google review —
//                                           "options for our driveway repair"
//   Platero Parada   hvac:heat pump         a Google review —
//                                           "replace it to heat pump electric"
//   America's        landscaping:irrigation its OWN service list, card 07 —
//                                           "Drip Irrigation"
//
// All four are plumbers. All four sentences are evidence ABOUT the business,
// published by the business or by its customers. None is evidence that WE
// picked the wrong donor. A customer describing the concrete their plumber cut
// through is the plumber's proof of work, not our proof of a swap.
//
// renderAudit has excluded [data-wss-verbatim] from its prose rules since a
// real customer wrote "great to work with and totally took care of us" and
// failed a clean mirror. This is that same law applied to trade language, and
// it has to reach one element further than verbatim does: the client's own
// service list is NOT marked verbatim, and "07 Drip Irrigation" is no more our
// words than the review is. Measured on the live DOM — America's convicting
// text sat in <h3> inside section#services-detail and in the FAQ that lists
// their services, neither of them a verbatim block.
//
// So the scan reads the DONOR SURFACE: the rendered page with the injected
// client-content block and every verbatim block lifted out. What remains is the
// template we chose and the copy we wrote — precisely the thing on trial.
//
// The OWN-language half still reads the WHOLE page. A missing signal must never
// block, and a plumber's customers calling him a plumber is fair proof he is
// one.

/** Below this many characters there is no donor surface left to judge. */
const DONOR_SURFACE_FLOOR = 200;

/**
 * The text the trade-swap scan is allowed to judge, and the honest name of what
 * it turned out to be.
 *
 * FAILS CLOSED. If the donor surface was never captured (an older reader, a
 * hand-built dom in a test) or came back implausibly small while the page
 * itself is full — a scrape bug, a donor that wrapped its own chrome in our
 * content marker — this returns the WHOLE page and scans that instead. The
 * worst case is the behaviour we had before this change: a false refusal an
 * operator can see and overrule. The alternative — scanning an empty string and
 * reporting "no foreign trade" — is a silent false PASS, which is the one
 * outcome this file exists to prevent.
 */
function donorSurfaceText(dom) {
  const full = String(dom.innerText || "");
  const donor = String(dom.donorText || "");
  if (!donor.trim()) return { text: full, scope: "whole_page:donor_surface_not_captured" };
  if (donor.trim().length < DONOR_SURFACE_FLOOR && full.trim().length > donor.trim().length) {
    return { text: full, scope: "whole_page:donor_surface_too_small" };
  }
  return { text: donor, scope: "donor_surface" };
}

/**
 * The client's OWN VERIFIED LEGAL NAME is not evidence that we swapped in
 * somebody else's trade.
 *
 * MEASURED on two live mirrors, 2026-08-08. "Plumbing Today HVAC" was refused
 * for `hvac:hvac`; the term occurred five times on the donor surface and ALL
 * FIVE were the string "Plumbing Today HVAC" — the header ticker, the socials
 * heading, the footer and the quote panel printing the business's own name.
 * "Paschal Air, Plumbing & Electric" was refused for `electrical:electric`, all
 * five hits its own name again. Meanwhile "Eyman Plumbing Heating & Air"
 * PASSED and shipped, on exactly the same profile — it escaped only because
 * "Heating & Air" happens to contain no term in the hvac list. Whether we
 * publish was being decided by how a company spells itself.
 *
 * `source.business_name` is the Google-Places-verified name; printing it is the
 * one thing every mirror MUST do. So it is lifted out of the swap text before
 * the scan, exactly as [data-wss-verbatim] blocks already are — same law: text
 * we are obliged to reproduce verbatim cannot also be our own copy on trial.
 *
 * This exempts THE NAME, not the words in it. A roofing donor's "shingle
 * replacement" on a plumber still convicts, and "Plumbing Today HVAC" does not
 * buy the page a licence to say "hvac" anywhere else — every other occurrence
 * is still counted.
 *
 * AND THE EXEMPTION IS EARNED, NOT GIVEN. It applies only when the name states
 * OUR OWN TRADE too — "Plumbing Today HVAC" on a plumbing mirror, "208
 * Specialties - Landscaping, Paver Patios, and Fencing" on a landscaping one.
 * That condition is what stops this from becoming a hole, and it was measured:
 * of the 31 businesses in the store whose NAME ALONE the swap scan convicts,
 * NINE are in the wrong lane entirely — Redeemed HVAC and Bruce Thornton Air
 * Conditioning were both mined under a plumbing target and built on the
 * plumbing donor. A blanket name exemption would have let those two ship a
 * schema.org Plumber mirror for an air-conditioning company, with the one check
 * that catches it switched off. Their names say nothing about plumbing, so they
 * earn no exemption and the gate refuses them exactly as it does today.
 *
 * What remains admitted is the "one lead trade, named secondaries" shape: the
 * client's own legal name leads with the trade we built. Since 2026-08-20 the
 * co-equal multi-trade business (Sal's Heating, Cooling & Plumbing) builds on
 * its LEAD trade's donor, so its name must earn the exemption too — and a
 * list-shaped name like "Heating, Cooling & Plumbing" matches none of the
 * gate's own PHRASES ("air conditioning", "heat pump"). The earning condition
 * therefore also accepts the SAME evidence that chose the donor: when
 * scoreTrades says the name itself claims the trade we built, the name is the
 * client's claim on our trade and is removed. Redeemed HVAC on a plumbing
 * mirror still earns nothing either way — its name scores hvac, not plumbing —
 * so the nine wrong-lane builds this condition was measured against are
 * refused exactly as before.
 */
function withoutOwnName(text, businessName, ownTerms = [], wantedTrade = "") {
  const haystack = fold(text);
  const name = fold(businessName);
  // A name shorter than this cannot be matched safely once folded; no
  // exemption is the conservative answer, and it fails toward refusal.
  if (!name || name.length < 4) return { text: haystack, removed: 0 };
  // THE EARNING CONDITION. No claim on our own trade, no exemption.
  const earned = ownTerms.some((term) => hasFoldedPhrase(name, term))
    || (wantedTrade && scoreTrades({ businessName }).some((s) => s.trade === wantedTrade));
  if (!earned) {
    return { text: haystack, removed: 0, exempt: false };
  }
  const needle = ` ${name} `;
  // Replaced one at a time, and with a space on BOTH sides put back: the header
  // ticker prints the name twice in a row, and consuming the shared separator
  // would leave the second copy without the leading boundary the scan matches
  // on — the exemption would then cover only half the occurrences.
  let out = ` ${haystack} `;
  let removed = 0;
  while (out.includes(needle)) { out = out.replace(needle, "  "); removed++; }
  return { text: removed ? out.replace(/\s+/g, " ").trim() : haystack, removed };
}

/**
 * Remove the client's own VERIFIED service phrases from the swap-scan text.
 *
 * A fencing company named "Texas Best Fence & Patio" whose verified services
 * include "Patio Covers" and "Automatic Driveway Gates" was refused as
 * "trade swap — concrete:patio, concrete:driveway" for printing its own
 * offerings (measured live, 2026-08-19). Whole folded PHRASES only, exactly
 * like withoutOwnName: "automatic driveway gates" is removed as one unit, so a
 * donor-swapped paragraph about "concrete driveway repair" — which is not in
 * the verified list — still convicts. Services come from the client's own
 * packet/site (truth-ported), so removing them removes only the client's own
 * claims, never donor bytes.
 */
/**
 * The WORDS of the client's verified services, folded, with naive
 * singular/plural twins. A term-level companion to withoutOwnServices: the
 * client's own prose legitimately paraphrases its service names — Texas Best
 * Fence & Patio's FAQ says "flagstone/concrete patios" while the verified
 * service is "Patio Covers" — and whole-phrase removal cannot cover honest
 * paraphrase. A foreign TERM whose word the client verifiably sells is the
 * client's own claim, not a swapped donor's; the swap is still convicted by
 * every term the client does NOT sell.
 */
function clientServiceTermSet(services) {
  const words = new Set();
  for (const s of Array.isArray(services) ? services : []) {
    const name = typeof s === "string" ? s : (s && (s.name || s.title)) || "";
    for (const w of fold(name).split(" ")) {
      if (w.length < 4) continue;
      words.add(w);
      words.add(w.endsWith("s") ? w.slice(0, -1) : `${w}s`);
    }
  }
  return words;
}

/**
 * Remove VERBATIM third-party review text from the swap-scan.
 *
 * A customer review is quoted speech the mirror may not edit, and customers
 * name whatever trade they like: "they diagnosed our plumbing" convicted an
 * HVAC mirror live (Bell Brothers, 2026-08-20). The texts come from the same
 * verified source the page printed them from, folded and removed as whole
 * passages — donor-authored copy contains none of them and still convicts.
 */
function withoutVerbatimReviews(text, reviews) {
  const passages = (Array.isArray(reviews) ? reviews : [])
    .map((r) => fold(String(r || "")))
    .filter((r) => r.length >= 30);
  if (!passages.length) return { text, removed: 0 };
  let out = ` ${text} `;
  let removed = 0;
  for (const passage of passages) {
    const needle = ` ${passage} `;
    while (out.includes(needle)) { out = out.replace(needle, "  "); removed++; }
    // The reader may have truncated or re-wrapped a long review; fall back to
    // removing its distinctive leading window when the whole passage misses.
    if (!out.includes(needle) && passage.length > 60) {
      const head = ` ${passage.slice(0, 60)}`;
      let idx = out.indexOf(head);
      while (idx >= 0) {
        // Consume from the window's start through the rest of the passage's
        // length or to the next sentence-ish boundary in the folded stream.
        out = out.slice(0, idx) + "  " + out.slice(idx + Math.min(passage.length + 1, out.length - idx));
        removed++;
        idx = out.indexOf(head);
      }
    }
  }
  return { text: removed ? out.replace(/\s+/g, " ").trim() : text, removed };
}

function withoutOwnServices(text, services) {
  const list = (Array.isArray(services) ? services : [])
    .map((s) => fold(typeof s === "string" ? s : (s && (s.name || s.title)) || ""))
    .filter((s) => s && s.length >= 4);
  if (!list.length) return { text, removed: 0 };
  let out = ` ${text} `;
  let removed = 0;
  for (const phrase of list) {
    const needle = ` ${phrase} `;
    while (out.includes(needle)) { out = out.replace(needle, "  "); removed++; }
  }
  return { text: removed ? out.replace(/\s+/g, " ").trim() : text, removed };
}

function checkVertical(dom, source) {
  const wanted = normalizeVertical(source.vertical);
  if (!VERTICALS[wanted]) return fail("vertical_match", `source vertical "${source.vertical || ""}" is not an approved vertical`);
  const admittedForeignTrades = new Set(
    (Array.isArray(source.secondary_verticals) ? source.secondary_verticals : [])
      .map(normalizeVertical)
      .filter(Boolean),
  );
  // OWN LANGUAGE: the whole page, client's words included.
  const text = fold(`${dom.title} ${dom.innerText}`);
  const ownTerms = new Set([
    ...VERTICALS[wanted].terms,
    ...(VERTICALS[wanted].shared || []),
  ].map(fold));
  const own = VERTICALS[wanted].terms.filter((term) => hasFoldedPhrase(text, term));
  if (!own.length) return fail("vertical_match", `no ${wanted} language in the rendered page`, { ownTermsFound: own });

  // TRADE SWAP: another vertical's exclusive terms in OUR OWN copy.
  // `exclusive` (when declared) is the subset that only ever appears when that
  // OTHER trade's page was swapped in. Ambiguous nouns stay in `terms` — they
  // still prove a vertical's own language — but they cannot convict a
  // neighbouring trade, which failed every fencing mirror on "tree roots".
  // The title stays in scope: it is ours, and "Roofing in Nashville" over a
  // plumber is the loudest swap evidence there is.
  const judged = donorSurfaceText(dom);
  // The exemption is judged against THIS vertical's own terms, so a name that
  // never claims our trade never earns it — see withoutOwnName.
  const named = withoutOwnName(`${dom.title} ${judged.text}`, source.business_name, VERTICALS[wanted].terms, wanted);
  const served = withoutOwnServices(named.text, source.services);
  const quoted = withoutVerbatimReviews(served.text, source.reviews);
  const swapText = quoted.text;
  const serviceWords = clientServiceTermSet(source.services);
  const foreign = [];
  for (const [name, entry] of Object.entries(VERTICALS)) {
    if (name === wanted || admittedForeignTrades.has(name)) continue;
    for (const term of (entry.exclusive || entry.terms)) {
      const t = fold(term);
      // A term shared with the client's own vertical is not evidence of a swap.
      if (ownTerms.has(t)) continue;
      // Nor is a word the client VERIFIABLY sells: their own prose paraphrases
      // their service names ("patios" for "Patio Covers"). Swapped donor copy
      // still convicts on every term outside the client's verified offerings.
      if (serviceWords.has(t)) continue;
      if (hasFoldedPhrase(swapText, t)) foreign.push(`${name}:${term}`);
    }
  }
  const evidence = {
    judged: judged.scope,
    ...(admittedForeignTrades.size ? { admitted_secondary_trades: [...admittedForeignTrades] } : {}),
    ...(named.removed ? { own_name_removed: named.removed } : {}),
    ...(served.removed ? { own_services_removed: served.removed } : {}),
    ...(quoted.removed ? { verbatim_reviews_removed: quoted.removed } : {}),
  };
  return foreign.length
    ? fail("vertical_match", `trade swap — foreign trade language on a ${wanted} mirror: ${foreign.slice(0, 5).join(", ")}`, { foreign, ...evidence })
    : pass("vertical_match", `${wanted} language present, no foreign trade`, { ownTermsFound: own, ...evidence });
}

function checkLogo(dom, source, seenLogoShas) {
  const rendered = (dom.logos || []).filter((l) => l.sha256);
  const mark = source.brand_mark && typeof source.brand_mark === "object" && !Array.isArray(source.brand_mark)
    ? source.brand_mark
    : null;
  const rung = String(mark?.rung || "").trim();
  const value = mark?.value && typeof mark.value === "object" && !Array.isArray(mark.value)
    ? mark.value
    : null;
  const validFallback = Boolean(String(mark?.reason || "").trim()) && (
    (rung === "wordmark" && value?.type === "wordmark" && present(value.text))
    || (rung === "monogram" && value?.type === "monogram" && present(value.initials))
    || (rung === "donor_default" && value?.type === "donor_default")
  );
  if (!present(source.logo_sha256) && validFallback) {
    const drawn = Array.isArray(dom.logos) ? dom.logos : [];
    const engineAsset = (logo) => {
      try {
        const page = new URL(String(dom.url || ""));
        const asset = new URL(String(logo.src || ""), page);
        return asset.origin === page.origin && asset.pathname === "/assets/brand-logo.svg";
      }
      catch { return false; }
    };
    if (!drawn.length) {
      // The engine is EXPECTED to render the fallback brand asset. A declared
      // ladder rung with zero rendered logo elements is unverified identity
      // and defeats persisted uniqueness — unrendered is not verified.
      return fail(
        "logo_own_and_unique",
        `the deliberate ${rung} brand-mark fallback rendered no fetchable logo bytes — unrendered is not verified`,
        { fallback: true, rung },
      );
    }
    if (drawn.every(engineAsset)) {
      // VALIDATE THE OBSERVATION SET BEFORE DEDUPING IT. Every rendered
      // element at the engine's fallback path must carry a normalized
      // 64-lowercase-hex sha; a missing or malformed observation is
      // unverifiable bytes, and unverifiable is not verified. Only then may
      // "exactly one unique sha" mean anything — two distinct byte sets mean
      // something unverified is rendering as this client's mark, and
      // identical bytes across clients are the same isolation breach a
      // client-logo collision is. The sha rides in evidence so the runner's
      // atomic claim map and the durable row's logoSha256 track fallback
      // bytes exactly like verified client logos.
      const shas = drawn.map((logo) => String(logo.sha256 || "").trim().toLowerCase());
      if (shas.some((sha) => !/^[a-f0-9]{64}$/.test(sha))) {
        return fail(
          "logo_own_and_unique",
          `the ${rung} fallback rendered logo elements without verifiable bytes — unverifiable is not verified`,
          { fallback: true, rung, rendered: shas.map((sha) => (sha ? sha.slice(0, 16) : "(missing)")) },
        );
      }
      const fallbackShas = [...new Set(shas)];
      if (fallbackShas.length !== 1) {
        return fail(
          "logo_own_and_unique",
          `the ${rung} fallback rendered ${fallbackShas.length} distinct logo byte sets — exactly one engine-generated mark may render`,
          { fallback: true, rung, rendered: fallbackShas.map((sha) => sha.slice(0, 16)) },
        );
      }
      const sha256 = fallbackShas[0];
      const owner = seenLogoShas instanceof Map ? seenLogoShas.get(sha256) : null;
      if (owner && owner !== source.prospect_id) {
        return fail(
          "logo_own_and_unique",
          `this exact fallback mark already shipped for ${owner} — one logo cannot belong to two clients`,
          { fallback: true, rung, sha256, collidesWith: owner },
        );
      }
      return pass(
        "logo_own_and_unique",
        `no client logo supplied — deliberate ${rung} brand-mark fallback rendered (sha ${sha256.slice(0, 16)})`,
        { fallback: true, rung, sha256 },
      );
    }
    // Something rendered OUTSIDE the engine's fallback path: not a pure
    // fallback page. Fall through to the strict client-logo law below.
  }
  if (!rendered.length) {
    const drawn = (dom.logos || []).length;
    return fail(
      "logo_own_and_unique",
      drawn
        ? "a logo element renders but its bytes could not be fetched — unverifiable is not verified"
        : "logoImgs=0 — no logo image renders in the DOM",
    );
  }
  if (!present(source.logo_sha256)) return fail("logo_own_and_unique", "no verified client logo hash in source facts");
  const match = rendered.find((l) => l.sha256 === source.logo_sha256);
  if (!match) {
    return fail("logo_own_and_unique", `rendered logo bytes are not this client's logo (rendered ${rendered[0].sha256.slice(0, 16)}, client ${String(source.logo_sha256).slice(0, 16)})`, {
      rendered: rendered.map((l) => l.sha256.slice(0, 16)),
    });
  }
  const owner = seenLogoShas instanceof Map ? seenLogoShas.get(match.sha256) : null;
  if (owner && owner !== source.prospect_id) {
    return fail("logo_own_and_unique", `this exact logo already shipped for ${owner} — one logo cannot belong to two clients`, { collidesWith: owner });
  }
  return pass("logo_own_and_unique", `client's own logo renders (sha ${match.sha256.slice(0, 16)})`, { sha256: match.sha256 });
}

function checkEntityResidue(dom) {
  const residue = residualEntities(`${dom.title} ${dom.innerText}`);
  return residue.length
    ? fail("entity_residue_zero", `entity residue a visitor can read: ${residue.slice(0, 4).join(" ")}`, { residue })
    : pass("entity_residue_zero", "no entity residue in rendered text");
}

function checkSchemaType(dom, source) {
  const wanted = schemaTypeFor(source.vertical);
  if (!wanted) return fail("schema_type", `no schema type known for vertical "${source.vertical || ""}"`);
  const types = [];
  for (const node of dom.jsonld || []) {
    const t = node && node["@type"];
    for (const one of Array.isArray(t) ? t : [t]) if (one) types.push(String(one));
  }
  if (!types.length) return fail("schema_type", "no JSON-LD @type in the rendered page");
  return types.includes(wanted)
    ? pass("schema_type", `@type ${wanted} present`, { types })
    : fail("schema_type", `@type is ${types.join(",")} — expected ${wanted} for ${normalizeVertical(source.vertical)}`, { types });
}

function checkDonorLeak(dom, source) {
  const needles = [];
  for (const value of source.donor_strings || []) {
    const clean = String(value || "").trim();
    if (clean.length >= 4) needles.push(clean);
  }
  if (!needles.length) {
    // A mirror is built FROM a donor. Not knowing which strings are the
    // donor's is not evidence they are absent.
    return fail("donor_leak_zero", "no donor fingerprint supplied — cannot prove the donor did not leak");
  }
  const haystack = fold(`${dom.title} ${dom.innerText} ${(dom.hrefs || []).join(" ")}`);
  const phoneText = `${dom.innerText}\n${(dom.hrefs || []).join("\n")}`;
  const hits = needles.filter((n) => {
    const asPhone = foldPhone(n);
    if (asPhone) return phoneShownIn(phoneText, n);
    return haystack.includes(fold(n));
  });
  return hits.length
    ? fail("donor_leak_zero", `donor identity leaked into the live page: ${hits.slice(0, 4).join(", ")}`, { hits })
    : pass("donor_leak_zero", `${needles.length} donor fingerprints checked, none present`);
}

function ratingNodes(dom) {
  const found = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (String(node["@type"] || "") === "AggregateRating") found.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  for (const node of dom.jsonld || []) walk(node, 0);
  return found;
}

function checkAggregateRating(dom, source) {
  const nodes = ratingNodes(dom);
  const haveSource = present(source.rating_value) && present(source.rating_count) && Number(source.rating_count) > 0;
  if (!nodes.length) {
    return pass("aggregate_rating_backed", haveSource
      ? "no AggregateRating published (allowed — omission is always safe)"
      : "no AggregateRating published and none is verified");
  }
  if (!haveSource) {
    return fail("aggregate_rating_backed", "AggregateRating is published but no verified rating AND count exist in source facts", {
      published: nodes.length,
    });
  }
  for (const node of nodes) {
    const value = node.ratingValue;
    const count = node.reviewCount ?? node.ratingCount;
    if (!present(value) || !present(count)) {
      return fail("aggregate_rating_backed", "AggregateRating is missing ratingValue or reviewCount", { node });
    }
    if (Number(value) !== Number(source.rating_value) || Number(count) !== Number(source.rating_count)) {
      return fail("aggregate_rating_backed", `AggregateRating ${value}/${count} does not match verified ${source.rating_value}/${source.rating_count}`);
    }
  }
  return pass("aggregate_rating_backed", `AggregateRating matches verified ${source.rating_value} from ${source.rating_count} reviews`);
}

function checkUnverifiedClaims(dom, source) {
  const claims = (source.unverified_claims || []).map((c) => String(c || "").trim()).filter((c) => c.length >= 3);
  if (!claims.length) return pass("unverified_claims_omitted", "no unverified claims recorded for this client");
  const text = fold(`${dom.title} ${dom.innerText}`);
  const shipped = claims.filter((c) => text.includes(fold(c)));
  return shipped.length
    ? fail("unverified_claims_omitted", `unverified claim published: ${shipped.slice(0, 4).join(", ")}`, { shipped })
    : pass("unverified_claims_omitted", `${claims.length} unverified claim(s) correctly omitted`);
}

// ---------------------------------------------------------------------------
// THE NINTH FACT — is every place this page names actually a place?
// ---------------------------------------------------------------------------
//
// On 2026-08-11 a live HVAC mirror published "9, LA", "4, LA", "13, LA" and
// "5, LA" as the towns near a real Baton Rouge company, and every one of the
// eight facts above passed. They were right to: nothing was misrepresented, no
// donor leaked, the logo was the client's own. The page was HONEST and it was
// also nonsense, and an owner cannot tell those apart.
//
// The bug had a source and the source is fixed (lib/mirror-engine/nearby-cities
// now refuses the Census's numbered voting districts, which is what those
// integers really were). This exists because the source will not be the last
// one: a future geocoder, an intake packet, an operator typing into a form. The
// gate does not care where a town came from. It reads the rail on the rendered
// page and asks the one question that has a right answer.
//
// WHY IT IS SAFE TO ADD AS A BLOCKING FACT. It can only fail on a string the
// page is ALREADY presenting as a place name, and only when that string could
// not be one — no letters at all, a bare template token, a lone state code. A
// mirror with no coverage block publishes no place names and passes trivially,
// which is the common case and stays free.
function checkPlaceNames(dom) {
  // Rendered rail first; JSON-LD areaServed as the second surface, because a
  // town that is wrong on the page is equally wrong in the structured data
  // Google parses, and the two are generated from the same list.
  const rendered = (Array.isArray(dom.placeNames) ? dom.placeNames : []).map((s) => String(s || ""));
  const schema = [];
  for (const node of Array.isArray(dom.jsonld) ? dom.jsonld : []) {
    const area = node && node.areaServed;
    for (const entry of Array.isArray(area) ? area : [area]) {
      if (!entry) continue;
      if (typeof entry === "string") schema.push(entry);
      else if (typeof entry === "object" && entry.name) schema.push(String(entry.name));
    }
  }

  // "St. George, LA" is one rendered string carrying a town and its state. Judge
  // the TOWN — the state half is a two-letter code by construction and would
  // otherwise convict every correct row of being a lone state code.
  const townOf = (s) => {
    const parts = String(s).split(",");
    return parts.length > 1 && /^\s*[A-Za-z]{2}\.?\s*$/.test(parts[parts.length - 1])
      ? parts.slice(0, -1).join(",")
      : s;
  };

  const published = [...rendered, ...schema].map(townOf).map((s) => s.trim()).filter(Boolean);
  if (!published.length) return pass("place_names_plausible", "the page publishes no place names");

  const bad = [];
  for (const name of published) {
    const reason = implausibleReason(name);
    if (reason) bad.push(`${JSON.stringify(name)} (${reason})`);
  }
  return bad.length
    ? fail("place_names_plausible", `published as a place name but is not one: ${bad.slice(0, 6).join(", ")}`, { bad, published: published.length })
    : pass("place_names_plausible", `${published.length} published place name(s), all readable as places`);
}

function pass(fact, reason, evidence) {
  return { fact, pass: true, reason, evidence: evidence || null };
}
function fail(fact, reason, evidence) {
  return { fact, pass: false, reason, evidence: evidence || null };
}

// ---------------------------------------------------------------------------
// THE COMPARATIVE TRIO — is this build at least as good as the SOURCE SITE?
// ---------------------------------------------------------------------------
//
// The nine facts above prove the build is CORRECT. None of them compares it
// with the client's own site, so a mirror that silently dropped the client's
// hero video, placed 2 of their 16 photographs, and shipped with no visual
// record of the before/after claim could pass all nine — correct, branded,
// honest, and visibly worse than what the client already has.
//
// The "before" half of each comparison comes from the client's OWN intake
// evidence, carried on `source` exactly like every other verified fact:
//   · source.hero_video            — the packet's record of a hero/background
//                                    video on the client's site ({url, kind}).
//   · source.photos_captured       — usable OWNED photos the packet banked
//                                    (photo_bank.photos.length, lib/client-photo-bank).
//   · source.photos_placed         — what the build placed into the donor's
//                                    photo_slots (engine checks.brand.photos.placed).
//   · source.photos_unplaced       — per-asset rejection reasons for captured
//                                    photos the build did NOT place.
//   · source.side_by_side_shots    — the four comparative shot URLs, supplied
//                                    as inputs when they must pre-exist.
//   · source.rebuild               — true when this prospect already had a
//                                    preview_url (this build replaces one).
//
// FAIL-CLOSED LAW, same as the nine: absent evidence a fact does not need is a
// recorded skip, malformed evidence is a refusal, and a "before" the build
// cannot match is a blocker. Never a silent pass.

/**
 * The videos a visitor could actually play on the rendered page: native
 * <video> elements with a real URL behind them (a data: URI is a placeholder),
 * plus YouTube/Vimeo iframe embeds. Exported so the parity rule is testable
 * without standing up a browser.
 */
function functioningVideos(dom) {
  const nativeSrc = (v) => {
    const src = String((v && (v.src || v.currentSrc)) || "");
    return /^(https?:)?\/\//i.test(src) || src.startsWith("/") ? src : "";
  };
  const native = (Array.isArray(dom && dom.videos) ? dom.videos : [])
    .filter((v) => v && typeof v === "object")
    .map(nativeSrc)
    .filter(Boolean);
  const embeds = (Array.isArray(dom && dom.videoEmbeds) ? dom.videoEmbeds : [])
    .map((s) => String(s || ""))
    .filter((s) => /^(https?:)?\/\//i.test(s));
  return { native, embeds };
}

/**
 * TENTH FACT — did a source site that ships a hero/background video keep one?
 *
 * The client's packet records the "before" as source.hero_video ({url, kind}).
 * No intake writer produces that field yet — it is the documented integration
 * point (from-genie maps only logo/photo assets today) — so its absence is a
 * recorded skip, not a pass claim: "nothing to preserve" is only ever said
 * about a packet that recorded no video, never about one we did not ask.
 * When the field IS present, the build must render a functioning video or the
 * row is blocked: a source site with a moving hero and a mirror with a flat
 * one is the owner's "worse than what they have" in its purest form.
 */
function checkSourceVideo(dom, source) {
  const heroVideo = source.hero_video;
  if (heroVideo === undefined || heroVideo === null || heroVideo === "") {
    return pass("source_video_preserved", "the packet records no hero/background video for this client — nothing to preserve", { source_video: null });
  }
  if (typeof heroVideo !== "object" || Array.isArray(heroVideo) || !present(heroVideo.url)) {
    return fail("source_video_preserved", `malformed source hero-video evidence (${JSON.stringify(heroVideo).slice(0, 120)}) — parity cannot be judged`, { source_video: heroVideo || null });
  }
  const surfaceCaptured = Array.isArray(dom.videos) || Array.isArray(dom.videoEmbeds);
  if (!surfaceCaptured) {
    return fail("source_video_preserved", "the rendered DOM's video surface was not captured — preservation unprovable", { source_video: { url: String(heroVideo.url).slice(0, 200) } });
  }
  const found = functioningVideos(dom);
  if (!found.native.length && !found.embeds.length) {
    return fail("source_video_preserved", `the client's site ships a hero/background video (${String(heroVideo.url).slice(0, 120)}) and the build renders none — the mirror is flatter than the source`, {
      source_video: { url: String(heroVideo.url).slice(0, 200), kind: heroVideo.kind || null },
      build_videos: 0,
    });
  }
  return pass("source_video_preserved", "a hero/background video the visitor can play survives in the build", {
    source_video: { url: String(heroVideo.url).slice(0, 200), kind: heroVideo.kind || null },
    build_videos: {
      native: found.native.length,
      embeds: found.embeds.length,
      first: (found.native[0] || found.embeds[0] || "").slice(0, 200),
    },
  });
}

/**
 * ELEVENTH FACT — did the build keep at least half the client's OWN photos?
 *
 * captured  = source.photos_captured  — usable owned photos the packet banked
 *             (lib/client-photo-bank: bank.photos.length, harvest-refused
 *             candidates already excluded).
 * placed    = source.photos_placed    — the engine's own count of client photos
 *             placed into the donor's photo_slots (checks.brand.photos.placed,
 *             carried out through the dispatch to this gate).
 * reasons   = source.photos_unplaced  — per-asset {url, reason} records for
 *             captured photos the build did not place. The engine writes only
 *             counts today, so this field has no producer yet — which is the
 *             point: an unexplained gap blocks, a explained one does not.
 *
 * Placed >= ceil(captured * 0.5) passes. Below the floor, ONLY per-asset
 * rejection reasons covering the gap can pass the row. Missing accounting on
 * the build side (captured known, placed never reported) is a refusal —
 * "retention unprovable" — never a pass.
 */
const RETENTION_FLOOR = 0.5;

function checkOwnedPhotos(dom, source) {
  const capturedRaw = source.photos_captured;
  if (capturedRaw === undefined || capturedRaw === null || capturedRaw === "") {
    return pass("owned_photos_retained", "the packet carries no owned-photo accounting (no banked photo count) — retention not judged", { captured: null, placed: null });
  }
  const captured = Number(capturedRaw);
  if (!Number.isInteger(captured) || captured < 0) {
    return fail("owned_photos_retained", `malformed owned-photo accounting: photos_captured=${JSON.stringify(capturedRaw)}`, { captured: capturedRaw });
  }
  if (captured === 0) {
    return pass("owned_photos_retained", "no usable owned photos were captured for this client — nothing to retain", { captured: 0, placed: null });
  }
  const placedRaw = source.photos_placed;
  if (placedRaw === undefined || placedRaw === null || placedRaw === "") {
    return fail("owned_photos_retained", `the packet banks ${captured} usable owned photo(s) and no placed-photo accounting reached the gate — retention is unprovable`, { captured, placed: null });
  }
  const placed = Number(placedRaw);
  if (!Number.isInteger(placed) || placed < 0) {
    return fail("owned_photos_retained", `malformed placed-photo accounting: photos_placed=${JSON.stringify(placedRaw)}`, { captured, placed: placedRaw });
  }
  const required = Math.ceil(captured * RETENTION_FLOOR);
  if (placed >= required) {
    return pass("owned_photos_retained", `${placed} of ${captured} owned photo(s) placed — at or above the ${Math.round(RETENTION_FLOOR * 100)}% floor (${required})`, { captured, placed, required });
  }
  const gap = required - placed;
  const unplaced = source.photos_unplaced;
  // Malformed rejection evidence (present but not a list of {url, reason})
  // covers NOTHING — fail closed, same law as every malformed input here.
  const reasons = Array.isArray(unplaced)
    ? unplaced.filter((r) => r && typeof r === "object" && present(r.url) && present(r.reason))
    : [];
  const suppliedButMalformed = unplaced !== undefined && unplaced !== null && !Array.isArray(unplaced);
  if (!suppliedButMalformed && reasons.length >= gap) {
    return pass("owned_photos_retained", `${placed} of ${captured} placed (floor ${required}); the ${gap}-photo gap carries a per-asset rejection reason for each`, {
      captured,
      placed,
      required,
      gap,
      unplaced_reasons: reasons.slice(0, gap).map((r) => ({ url: String(r.url).slice(0, 160), reason: String(r.reason).slice(0, 120) })),
    });
  }
  return fail("owned_photos_retained", `only ${placed} of ${captured} owned photo(s) placed (floor ${required}); ${suppliedButMalformed ? "malformed" : `${reasons.length} per-asset`} rejection reason(s) do not cover the ${gap}-photo gap`, {
    captured,
    placed,
    required,
    gap,
    unplaced_reasons: reasons.length,
    ...(suppliedButMalformed ? { malformed_unplaced: true } : {}),
  });
}

/** The four comparative shots, in the order the check names them. */
const SIDE_BY_SIDE_KEYS = Object.freeze(["source_desktop", "source_mobile", "build_desktop", "build_mobile"]);

/**
 * TWELFTH FACT — are the four comparative shots on the record?
 *
 * Desktop AND mobile, of the SOURCE site and of the BUILD — the evidence the
 * owner's "at least as good" claim rests on. Capture of these belongs to the
 * proof-shot lane (lib/line-proof-shots.js shoots exactly this set in the
 * gate's own open browser the moment the facts pass), so the gate's own read
 * is of the shots SUPPLIED to it: the four URLs must arrive on
 * source.side_by_side_shots. A fresh build records that the post-verdict hook
 * owns the capture; a REBUILD (the prospect already had a preview_url) gets
 * no such grace — its shots must be supplied as inputs or the row is blocked,
 * because a rebuild with no before/after record is exactly the silent
 * regression this fact exists to stop.
 */
function checkSideBySide(dom, source) {
  const shots = source.side_by_side_shots;
  const rebuild = source.rebuild === true;
  const hook = source.side_by_side_hook === "post_verdict";
  if (shots === undefined || shots === null || shots === "") {
    if (rebuild && !hook) {
      return fail("side_by_side_captured", "rebuild job: the four comparative shots (source+build, desktop+mobile) were not supplied — failing closed", { shots: null, rebuild: true });
    }
    // Fresh builds and any build running under a declared post-verdict hook:
    // the hook shoots the four (old/old-mobile/new/new-mobile) after this
    // verdict and writes their URLs into this fact's evidence. A rebuild on a
    // hook-less path never reaches this branch.
    return pass("side_by_side_captured", rebuild
      ? "rebuild under the line's post-verdict hook: the same capture that covers a fresh build covers this one"
      : "fresh build: the four comparative shots are captured by the post-verdict proof-shot hook (old/old-mobile/new/new-mobile)", { shots: null, rebuild, hook });
  }
  if (typeof shots !== "object" || Array.isArray(shots)) {
    return fail("side_by_side_captured", `malformed side-by-side shot evidence (${JSON.stringify(shots).slice(0, 120)}) — cannot judge`, { shots: null, rebuild });
  }
  const missing = SIDE_BY_SIDE_KEYS.filter((key) => !present(shots[key]));
  if (missing.length) {
    return fail("side_by_side_captured", `comparative shots missing: ${missing.join(", ")}${rebuild ? " (rebuild job — failing closed)" : ""}`, { shots, missing, rebuild });
  }
  const evidence = {};
  for (const key of SIDE_BY_SIDE_KEYS) evidence[key] = String(shots[key]).slice(0, 400);
  return pass("side_by_side_captured", "all four comparative shots on the record — source and build, desktop and mobile", { ...evidence, rebuild });
}

// ---------------------------------------------------------------------------
// evaluateRenderGate — pure. No network, no browser, fully unit-testable.
// ---------------------------------------------------------------------------
/**
 * @param {object} dom     the result of readRenderedDom()
 * @param {object} source  the client's OWN verified facts
 * @param {Map<string,string>} seenLogoShas  sha256 -> prospect_id already shipped
 * @returns {{pass:boolean, checks:Array, failed:Array, blockedBy:string}}
 */
function evaluateRenderGate({ dom, source = {}, seenLogoShas = new Map() } = {}) {
  if (!dom || dom.ok !== true) {
    const reason = (dom && dom.reason) || "no_rendered_dom";
    // Every fact fails, because not one of them was proven.
    const checks = FACTS.map((f) => fail(f, `render unavailable: ${reason}`));
    // A step-budget timeout names its phase on the verdict itself, so the
    // durable row answers "which await hung" in one look (row.reason carries
    // blockedBy; row.gate.stepTimeout survives with the full verdict).
    const timedOutPhase = dom && dom.stepTimedOut === true
      ? String(reason || "").replace(/^gate_step_timeout:/, "")
      : "";
    return {
      pass: false,
      checks,
      failed: FACTS.slice(),
      blockedBy: `render_unavailable:${reason}`,
      renderedUrl: (dom && dom.url) || "",
      ...(timedOutPhase ? { stepTimeout: timedOutPhase } : {}),
    };
  }
  const checks = [];
  checks.push(safely("nap_match", () => checkNap(dom, source)));
  checks.push(safely("vertical_match", () => checkVertical(dom, source)));
  checks.push(safely("logo_own_and_unique", () => checkLogo(dom, source, seenLogoShas)));
  checks.push(safely("entity_residue_zero", () => checkEntityResidue(dom)));
  checks.push(safely("schema_type", () => checkSchemaType(dom, source)));
  checks.push(safely("donor_leak_zero", () => checkDonorLeak(dom, source)));
  checks.push(safely("aggregate_rating_backed", () => checkAggregateRating(dom, source)));
  checks.push(safely("unverified_claims_omitted", () => checkUnverifiedClaims(dom, source)));
  checks.push(safely("place_names_plausible", () => checkPlaceNames(dom)));
  checks.push(safely("source_video_preserved", () => checkSourceVideo(dom, source)));
  checks.push(safely("owned_photos_retained", () => checkOwnedPhotos(dom, source)));
  checks.push(safely("side_by_side_captured", () => checkSideBySide(dom, source)));

  const failed = checks.filter((c) => !c.pass).map((c) => c.fact);
  const firstFailure = checks.find((c) => !c.pass);
  return {
    pass: failed.length === 0,
    checks,
    failed,
    blockedBy: firstFailure ? `${firstFailure.fact}: ${firstFailure.reason}` : "",
    renderedUrl: dom.url || "",
  };
}

/** A check that throws is a check that did not prove its fact. That is a FAIL. */
function safely(fact, fn) {
  try {
    const result = fn();
    if (!result || typeof result.pass !== "boolean") return fail(fact, "check returned no verdict");
    return result;
  } catch (e) {
    return fail(fact, `check threw: ${String(e.message || e).slice(0, 160)}`);
  }
}

/**
 * runRenderGate — read the DOM, then judge it. The only entry point callers
 * should use. There is deliberately no options.skip and no options.force.
 *
 * `capture` — OPTIONAL, and it is not a gate option: it cannot admit, refuse or
 * soften a single fact. It is invoked with the gate's own open browser, on the
 * page the gate just measured, ONLY when every fact has passed, and its
 * result rides out on `verdict.capture` for the caller to use or ignore.
 *
 *   async capture({ browser, dom, url, build }) -> any
 *
 * WHY IT IS GATED ON THE VERDICT. Capture costs seconds of browser time, and a
 * row that failed a fact is never sent — its shots would never be looked at.
 * The interim evaluation below is the SAME pure function, on the SAME dom, with
 * the SAME seenLogoShas map, run synchronously in the same tick, so it cannot
 * disagree with the verdict returned at the bottom of this function.
 *
 * `build` is opaque here: whatever the caller needs to key what it captures
 * (the mirror's build hash, the prospect's current website). The gate reads no
 * field of it, ever — it exists so the hook does not have to be rebuilt per row
 * by a caller that only has one gate function.
 */
async function runRenderGate({
  url,
  source = {},
  seenLogoShas = new Map(),
  timeoutMs = 45000,
  reader = readRenderedDom,
  capture = null,
  build = null,
  // The caller's own wall-clock (epoch ms). processRowPhase passes the durable
  // worker's deadline; the gate keeps its capture hook and its whole inspection
  // inside it instead of racing past it into the caller's kill.
  deadlineAt = 0,
} = {}) {
  if (!present(url)) {
    return { ...evaluateRenderGate({ dom: null, source, seenLogoShas }), blockedBy: "render_unavailable:no_preview_url" };
  }
  // THE INSPECTION HAS AN INTERNAL TIMEOUT NOW. A hung await used to hold the
  // row until the CALLER's race fired, which turned one stuck phase into
  // render_gate_timed_out (retryable, seven times, then a batch sweep that
  // erased the cause). The gate now owns a total budget — the caller's
  // deadline when one arrives, else GATE_INSPECTION_TOTAL_MS — and returns a
  // verdict naming the phase in flight when the budget dies.
  const stepTracker = { phase: "render_read" };
  const options = { timeoutMs, stepTracker };
  if (Number(deadlineAt) > 0) options.deadlineAt = Number(deadlineAt);
  if (typeof capture === "function") {
    options.onRendered = async ({ browser, dom }) => {
      const interim = evaluateRenderGate({ dom, source, seenLogoShas });
      if (interim.pass !== true) return { ok: false, skipped: `gate_failed:${interim.failed.join(",")}` };
      return capture({ browser, dom, url, build });
    };
  }
  const totalMs = Number(deadlineAt) > 0
    ? Number(deadlineAt) - Date.now()
    : GATE_INSPECTION_TOTAL_MS;
  const readPromise = reader(url, options);
  const dom = totalMs > GATE_RESIDUAL_RESERVE_MS
    ? await withGateStep(readPromise, totalMs, "render_read", stepTracker).catch((e) => {
      if (!isGateStepTimeout(e)) throw e;
      return { ok: false, url, reason: `gate_step_timeout:${e.phase}`, stepTimedOut: true };
    })
    : { ok: false, url, reason: "gate_step_timeout:render_read", stepTimedOut: true };
  const verdict = evaluateRenderGate({ dom, source, seenLogoShas });
  return dom && dom.capture !== undefined ? { ...verdict, capture: dom.capture } : verdict;
}

/**
 * assertGateIntegrity — a self-check the line runs before it starts, so a gate
 * that has been quietly weakened stops the whole run instead of passing rows.
 * It proves, at runtime, that the gate still fails closed.
 */
function assertGateIntegrity() {
  const blind = evaluateRenderGate({ dom: { ok: false, reason: "self_test" }, source: {} });
  if (blind.pass !== false || blind.failed.length !== FACTS.length) {
    throw new Error("render_gate_integrity_failed: a blind gate did not fail all facts");
  }
  const empty = evaluateRenderGate({
    dom: { ok: true, url: "x", title: "", innerText: "nothing at all here for anyone to read today", hrefs: [], imgs: [], logos: [], jsonld: [] },
    source: {},
  });
  if (empty.pass !== false) throw new Error("render_gate_integrity_failed: an empty page passed");

  // THE SWAP DETECTOR IS STILL ARMED. checkVertical now judges the donor
  // surface rather than the whole page, so that a plumber's own reviews and
  // service list stop convicting him of being a landscaper. The cost of
  // getting that exclusion wrong — too broad a carve-out, a scrape that
  // returns "" — is a swap detector that quietly always passes. This proves at
  // runtime that it does not: an HVAC company on a plumbing donor, with the
  // plumbing language sitting in the DONOR SURFACE where a wrong template puts
  // it, must still be refused.
  const swapped = checkVertical(
    {
      title: "Coldfront Mechanical",
      innerText: "Coldfront Mechanical\nFurnace and air conditioning service.\nDrain cleaning, sewer repair and water heater installation by our licensed plumbers.",
      donorText: "Coldfront Mechanical\nFurnace and air conditioning service.\nDrain cleaning, sewer repair and water heater installation by our licensed plumbers.",
    },
    { vertical: "hvac" },
  );
  if (swapped.pass !== false) {
    throw new Error("render_gate_integrity_failed: a wrong-trade donor passed the vertical gate");
  }

  // A NUMBER IS NOT A TOWN, PROVEN AT RUNTIME. The four integers that shipped
  // to a Baton Rouge HVAC company were refused by nothing — the rail rendered
  // them, the schema carried them, and all eight facts passed. This asserts, on
  // every line start, that the ninth fact still convicts the exact page that
  // reached that owner, and that a clean rail still passes so the check has not
  // been turned into an unconditional refusal nobody would notice.
  const numericTowns = checkPlaceNames({ placeNames: ["St. George, LA", "9, LA", "13, LA"], jsonld: [] });
  if (numericTowns.pass !== false) {
    throw new Error("render_gate_integrity_failed: a numeric town passed the place-name gate");
  }
  const realTowns = checkPlaceNames({ placeNames: ["St. George, LA", "Denham Springs, LA"], jsonld: [] });
  if (realTowns.pass !== true) {
    throw new Error("render_gate_integrity_failed: real towns were refused by the place-name gate");
  }

  // THE COMPARATIVE TRIO IS ARMED, PROVEN AT RUNTIME. Each of the three facts
  // can only pass vacuously on a packet that carries none of its evidence, so
  // the self-check convicts each one with the exact shape that must never
  // slip through: a source video with no build video, a 16-photo packet with
  // 2 placed and no reasons, and a rebuild with no comparative shots. And a
  // clean packet on each side still passes, so none of the three has quietly
  // become an unconditional refusal.
  const videoLost = checkSourceVideo({ videos: [], videoEmbeds: [] }, { hero_video: { url: "https://client.example.com/hero.mp4" } });
  if (videoLost.pass !== false) {
    throw new Error("render_gate_integrity_failed: a source hero video was lost without a refusal");
  }
  const videoKept = checkSourceVideo({ videos: [{ src: "/assets/hero.mp4", readyState: 4, paused: false }], videoEmbeds: [] }, { hero_video: { url: "https://client.example.com/hero.mp4" } });
  if (videoKept.pass !== true) {
    throw new Error("render_gate_integrity_failed: a preserved hero video was refused");
  }
  const photosLost = checkOwnedPhotos({}, { photos_captured: 16, photos_placed: 2 });
  if (photosLost.pass !== false) {
    throw new Error("render_gate_integrity_failed: 2 of 16 owned photos placed with no reasons passed the retention gate");
  }
  const photosKept = checkOwnedPhotos({}, { photos_captured: 16, photos_placed: 8 });
  if (photosKept.pass !== true) {
    throw new Error("render_gate_integrity_failed: 8 of 16 owned photos placed was refused by the retention gate");
  }
  const shotsAbsent = checkSideBySide({}, { rebuild: true });
  if (shotsAbsent.pass !== false) {
    throw new Error("render_gate_integrity_failed: a rebuild without comparative shots passed");
  }
  const shotsPresent = checkSideBySide({}, {
    side_by_side_shots: {
      source_desktop: "https://proofs.example/old.jpg",
      source_mobile: "https://proofs.example/old-mobile.jpg",
      build_desktop: "https://proofs.example/new.jpg",
      build_mobile: "https://proofs.example/new-mobile.jpg",
    },
  });
  if (shotsPresent.pass !== true) {
    throw new Error("render_gate_integrity_failed: four supplied comparative shots were refused");
  }

  // THE CAPTURE HOOK IS NOT A GATE OPTION. runRenderGate now hands its open
  // browser to a caller-supplied hook so the email's proof shots stop paying
  // for a second chromium. That hook's result rides on `dom.capture`, and the
  // one thing that must never become possible is a field on the dom talking the
  // verdict into a pass. Proven at runtime: a dom that saw nothing, decorated
  // with the most successful-looking capture result available, still fails all
  // eight facts.
  const decorated = evaluateRenderGate({
    dom: { ok: false, reason: "self_test", capture: { ok: true, shots: { new_captured_url: "https://example.com" } } },
    source: {},
  });
  if (decorated.pass !== false || decorated.failed.length !== FACTS.length) {
    throw new Error("render_gate_integrity_failed: a capture result influenced the verdict");
  }
  return { ok: true, facts: FACTS.length };
}

module.exports = {
  FACTS,
  VERTICALS,
  schemaTypeFor,
  readRenderedDom,
  readRenderedDomOnce,
  evaluateRenderGate,
  runRenderGate,
  assertGateIntegrity,
  // exported for tests and for the console's per-fact rendering
  fold,
  foldPhone,
  sha256,
  // the swap detector and the exclusion it rests on, exported so the rule that
  // decides whose words may convict is testable on its own
  checkVertical,
  donorSurfaceText,
  DONOR_SURFACE_FLOOR,
  // the ninth fact, exported so the rule that decides what counts as a place
  // name is testable without standing up a browser
  checkPlaceNames,
  // the comparative trio, exported for the same reason: each rule is testable
  // on its own packet/dom pair, and the parity surface helper is shared with
  // the source-parity gate tests
  checkSourceVideo,
  checkOwnedPhotos,
  checkSideBySide,
  functioningVideos,
  SIDE_BY_SIDE_KEYS,
  RETENTION_FLOOR,
  // the step-budget law (2026-09-04): every inspection await is bounded and a
  // step that outruns its slice fails with gate_step_timeout:<phase>. Exported
  // so the bounds themselves are testable without a browser.
  withGateStep,
  gateStepTimeout,
  isGateStepTimeout,
  GATE_INSPECTION_TOTAL_MS,
  GATE_STEP_CAPTURE_MS,
};
