"use strict";

/**
 * The WSS operator gallery — the owner's favorite screen.
 *
 * The browser fetches one authenticated snapshot, then handles tabs, search,
 * filters, archived visibility, menus, and incremental rendering locally.
 * Every card is screenshot-first: the picture, the business name big, one
 * line of "Trade · City, ST", and one status chip in plain English. The
 * factory's own vocabulary ("line_gate_passed", "packeted") never reaches
 * the owner's eyes — it rides along in parentheses and tooltips only.
 *
 * WHAT THIS PAGE WRITES, AND EVERY DOOR IS NARROW ON PURPOSE:
 *
 *   1. A note. Appended to the event log against one business, never edited,
 *      never able to touch the lead record itself.
 *   2. A proof email. It runs /api/admin/send-mirror-proof, which passes
 *      internalOwnerProof:true — lib/email.js then REPLACES the recipient with
 *      GHOST_AGENCY_OWNER_EMAIL, empties cc and bcc, and refuses the send
 *      unless the resolved address is already the owner's. No parameter this
 *      page can send reaches a business.
 *   3. The owner's own corrections. "Edit details" posts five fields (name,
 *      city, state, trade, private notes) to /api/admin/gallery-manage, which
 *      writes only what was provided and returns the record as truth.
 *   4. Archive, restore, and — on archived cards only — a delete that makes
 *      the operator type the business name back before it fires.
 *   5. A rebuild. One card at a time, through the same
 *      forceFreshDispatch:true door the console uses; no email, no skipping
 *      the queue's own gates.
 *
 * The lead's contact details arrive from an admin-gated POST, live only in
 * the drawer's DOM, and never enter the URL.
 */
const { operatorNav } = require("./operator-nav");
const { PLAIN_REFUSAL } = require("./send-refusals");

// ---------------------------------------------------------------------------
// THE OWNER'S PLAIN VOICE.
//
// lib/operator-voice.js is the shared plain-language layer for every operator
// surface (a parallel workstream owns it). When it is present this page takes
// its words verbatim — for every status and trade label — by snapshotting
// statusChip() over the status vocabulary this gallery actually serves. When
// it is not on disk yet, the gallery ships its own minimal fallback map so
// the owner is never shown a raw factory code either way; the fallback's
// phrasing mirrors lib/prospect-detail.js so the drawer and the card agree.
//
// An unknown status still falls through to an honest title-casing of the raw
// value at render time — a raw truth beats a wrong translation.
// ---------------------------------------------------------------------------
let operatorVoice = null;
try {
  operatorVoice = require("./operator-voice");
} catch (_) {
  operatorVoice = null;
}

const VOICE_STATUS_VOCAB = Object.freeze([
  "new", "packeted", "line_queued", "line_gate_passed", "previewed", "sent",
  "contacted", "built", "ready", "live", "held", "completed", "error",
  "failed", "blocked", "rejected", "opted_out", "unsubscribed",
  "do_not_contact", "bounced", "complained", "archived_legacy",
]);

const VOICE_FALLBACK_CHIPS = Object.freeze({
  new: { label: "Just found", tone: "" },
  packeted: { label: "Research done, ready to build", tone: "warn" },
  line_queued: { label: "Waiting for your OK", tone: "warn" },
  line_gate_passed: { label: "✓ Passed final inspection", tone: "ok" },
  previewed: { label: "Preview ready for you", tone: "warn" },
  sent: { label: "Already reached out", tone: "done" },
  contacted: { label: "Already reached out", tone: "done" },
  built: { label: "✓ Website is live", tone: "ok" },
  ready: { label: "✓ Website is live", tone: "ok" },
  live: { label: "✓ Website is live", tone: "ok" },
  held: { label: "Held for a second look", tone: "warn" },
  completed: { label: "Finished", tone: "done" },
  error: { label: "Something went wrong", tone: "bad" },
  failed: { label: "Something went wrong", tone: "bad" },
  blocked: { label: "Stopped on purpose", tone: "bad" },
  rejected: { label: "Stopped on purpose", tone: "bad" },
  opted_out: { label: "Asked us to stop", tone: "bad" },
  unsubscribed: { label: "Asked us to stop", tone: "bad" },
  do_not_contact: { label: "Do not contact", tone: "bad" },
  bounced: { label: "Their inbox refused us", tone: "bad" },
  complained: { label: "Complained — do not contact", tone: "bad" },
  archived_legacy: { label: "Archived", tone: "done" },
});

const VOICE_FALLBACK_PLAIN = Object.freeze({
  new: "We just found this business. Nothing is built yet.",
  packeted: "The research is done. The website has not been built yet.",
  line_queued: "The website is built and waiting for your go-ahead.",
  line_gate_passed: "The finished website passed every final check.",
  held: "This one is waiting for a person to look at it first.",
  archived_legacy: "An old record, parked out of the way. Restore it any time.",
  completed: "Finished and done.",
});

// The shared voice speaks tones as good/wait/bad/neutral; this page's chips
// are styled ok/warn/bad/neutral. Translate, never drop.
function voiceToneClass(tone) {
  const value = String(tone == null ? "" : tone).trim().toLowerCase();
  const translated = { good: "ok", wait: "warn", bad: "bad", done: "done", ok: "ok", warn: "warn", neutral: "" }[value];
  return translated === undefined ? "" : translated;
}

function voiceTermKey(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildVoiceSnapshot() {
  const chips = { ...VOICE_FALLBACK_CHIPS };
  let plain = { ...VOICE_FALLBACK_PLAIN };
  let source = "gallery-fallback";
  if (operatorVoice && typeof operatorVoice.statusChip === "function") {
    source = "operator-voice";
    const known = operatorVoice.STATUS && typeof operatorVoice.STATUS === "object" && !Array.isArray(operatorVoice.STATUS)
      ? operatorVoice.STATUS
      : null;
    for (const term of VOICE_STATUS_VOCAB) {
      // Only take the shared answer for terms it actually carries: its
      // statusChip() politely title-cases unknowns, and a polite "Built"
      // would replace this page's "✓ Website is live" for a status the
      // dictionary has not met yet. Unknown terms fall through to the
      // fallback here, and to honest title-casing in the browser beyond it.
      if (known && !Object.prototype.hasOwnProperty.call(known, voiceTermKey(term))) continue;
      try {
        const chip = operatorVoice.statusChip(term);
        if (chip && chip.label) {
          chips[term] = { label: String(chip.label), tone: voiceToneClass(chip.tone) };
        }
      } catch (_) { /* one bad term never takes the page down */ }
    }
    if (operatorVoice.PLAIN && typeof operatorVoice.PLAIN === "object" && !Array.isArray(operatorVoice.PLAIN)) {
      plain = { ...plain, ...operatorVoice.PLAIN };
    }
  }
  return { source, chips, plain };
}

const VOICE = buildVoiceSnapshot();

const { BROWSER_SCRIPT: LIVE_REFRESH } = require("./gallery-live-refresh");

module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#08080B">
  <meta name="description" content="The owner's site gallery: every website the factory built, in plain words, with edit, rebuild, archive, and a carefully guarded delete.">
  <title>Site Gallery · WSS Command Center</title>
  <style>
    :root{
      color-scheme:dark;
      --void:#08080B; --carbon:#131318; --carbon-2:#17171d; --ice:#F2F2F5; --slate:#9B9AA4;
      --graphite:#6F6E79; --signal:#7C6CF6; --circuit:#4A6CF7; --pulse:#34D399;
      --sky:#6E8BFF; --ember:#E0A44A; --rose:#F26D6D; --hair:rgba(255,255,255,.07);
      --grad-signal:linear-gradient(135deg,#4A6CF7 0%,#8B5CF6 100%);
      --sans:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
      --mono:'IBM Plex Mono','SFMono-Regular',Consolas,Menlo,monospace;
    }
    *{box-sizing:border-box;min-width:0}
    html{min-height:100%;overflow-x:hidden;background:var(--void)}
    /* overflow-x stays on html ONLY: adding it to body too makes body the clip
       container and silently kills position:sticky on the search dock. */
    body{min-height:100vh;margin:0;background:var(--void);color:var(--ice);font-family:var(--sans);-webkit-font-smoothing:antialiased}
    button,input{font:inherit}
    button,a,input{touch-action:manipulation}
    button{color:inherit}
    [hidden]{display:none!important}
    .skip-link{position:fixed;z-index:100;top:10px;left:10px;transform:translateY(-160%);padding:9px 12px;border-radius:8px;background:var(--ice);color:var(--void);font:700 12px var(--mono);text-decoration:none}
    .skip-link:focus{transform:translateY(0)}
    :focus-visible{outline:2px solid var(--sky);outline-offset:3px}
    .shell{width:100%;max-width:1440px;margin:0 auto;padding:28px 22px 64px;transition:filter .18s ease}
    .shell.locked{filter:blur(8px);pointer-events:none;user-select:none}

    /* Command-center lockup: the existing WSS mark and token palette. */
    .masthead{display:flex;align-items:center;gap:15px;padding-bottom:22px;border-bottom:1px solid var(--hair)}
    .mark{width:58px;height:58px;flex:none;display:grid;place-items:center;border:1px solid var(--hair);border-radius:15px;background:var(--carbon)}
    .eyebrow{margin:0 0 6px;color:var(--slate);font:500 10px/1 var(--mono);letter-spacing:.28em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(26px,4vw,36px);font-weight:800;line-height:1;letter-spacing:-.03em}
    .masthead-note{margin-left:auto;display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}
    .readonly{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid rgba(52,211,153,.3);border-radius:999px;color:var(--pulse);font:500 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
    .readonly::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--pulse)}
    .catalog-note{color:var(--slate);font:500 10px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase}

    .intro{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:34px 0 22px}
    .intro-copy{max-width:650px}
    .intro h2{margin:0;font-size:clamp(24px,4vw,42px);line-height:1.02;letter-spacing:-.035em}
    .intro p{max-width:590px;margin:10px 0 0;color:var(--slate);font-size:14px;line-height:1.6}
    /* The page-level statement of destination. It is filled from the server's
       own answer about the one send route, so it names the real address rather
       than a hard-coded one that could drift out of date. */
    .intro-send{display:inline-flex;align-items:center;gap:9px;margin-top:13px!important;padding:9px 13px;border:1px solid rgba(52,211,153,.28);border-radius:999px;background:rgba(52,211,153,.06);color:var(--pulse)!important;font-size:12.5px!important;font-weight:600;line-height:1.4!important}
    .intro-send::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--pulse)}
    .result-note{flex:none;color:var(--slate);font:500 10px/1.4 var(--mono);letter-spacing:.1em;text-align:right;text-transform:uppercase}

    /* THE LIVE CAMPAIGN CLOCK. One monospace line under the intro: when the
       newest active batch carries a stamped timing record, the owner sees the
       campaign's measured pace — when it fired, how long each first took, and
       how many have gone out. Hidden entirely when no campaign is running;
       it never guesses a moment the batch did not stamp. */
    .campaign-clock{display:flex;align-items:center;gap:10px;margin:0 0 18px;padding:10px 13px;border:1px solid var(--hair);border-radius:12px;background:var(--carbon);color:var(--slate);font:500 11px/1.6 var(--mono);letter-spacing:.02em;font-variant-numeric:tabular-nums}
    .campaign-clock::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--signal)}

    /* One search dock instead of a stack of dashboard cards. */
    /* top:52px, not 0 — the shared operator bar is 52px tall and sticks above
       this dock. At top:0 the search controls slid underneath it. */
    .controls{position:sticky;z-index:40;top:52px;display:grid;grid-template-columns:auto minmax(170px,1fr) auto auto auto auto;align-items:end;gap:16px;padding:15px 16px;border:1px solid var(--hair);border-radius:14px;background:var(--carbon)}
    .tabs{display:flex;align-items:end;gap:24px;border-bottom:1px solid var(--hair)}
    .tab{position:relative;margin:0 0 -1px;padding:2px 0 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--slate);font:500 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;cursor:pointer}
    .tab:hover{color:var(--ice)}
    .tab.active{border-bottom-color:var(--signal);color:var(--ice)}
    .tab-count{margin-left:6px;color:var(--slate);font-variant-numeric:tabular-nums}
    .tab.active .tab-count{color:var(--signal)}
    .search-wrap{position:relative}
    .search-wrap svg{position:absolute;top:50%;left:13px;width:17px;height:17px;transform:translateY(-50%);color:var(--slate);pointer-events:none}
    .search{width:100%;height:42px;padding:0 14px 0 40px;border:1px solid var(--hair);border-radius:9px;background:var(--void);color:var(--ice);font:500 13px var(--sans)}
    .search::placeholder{color:var(--slate)}
    .search:focus{border-color:rgba(124,108,246,.65)}
    .archive-control{display:flex;align-items:center;gap:9px;min-height:42px;color:var(--slate);font:500 10px/1.25 var(--mono);letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;cursor:pointer}
    .archive-control input{width:17px;height:17px;margin:0;accent-color:var(--signal)}
    .sort-wrap{display:flex;align-items:center;gap:9px}
    /* One label width for all three dock groups ("Show only", "Status",
       "Sort") so the three selects start at the same x and read as one row. */
    .sort-label{flex:none;min-width:66px;color:var(--slate);font:500 10px/1 var(--mono);letter-spacing:.09em;text-transform:uppercase}
    .sort{height:42px;padding:0 30px 0 12px;border:1px solid var(--hair);border-radius:9px;background:var(--void) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239B9AA4' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 11px center;color:var(--ice);font:500 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;cursor:pointer;appearance:none;-webkit-appearance:none}
    .sort:focus{border-color:rgba(124,108,246,.65)}
    .sort option{background:var(--carbon);color:var(--ice);text-transform:none}
    /* "Show only…" filters. The label is a sentence fragment the select
       finishes: "Show only [Plumbing]". Statuses list the plain label with
       the factory token in parentheses, so the jargon stays findable without
       being the thing the owner has to read. */
    .filter-wrap{display:flex;align-items:center;gap:9px}
    .filter-wrap .sort{max-width:210px;overflow:hidden;text-overflow:ellipsis}

    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:16px;margin-top:18px}
    .site-card{position:relative;display:flex;flex-direction:column;overflow:visible;border:1px solid var(--hair);border-radius:16px;background:var(--carbon);animation:card-in .24s ease-out both;transition:transform .16s ease,border-color .16s ease}
    .site-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.14)}
    .site-card:focus-within{z-index:30}
    .site-card.archived{opacity:.72}
    /* The card is the open-live-site gesture through its PREVIEW AREA: the
       stretched link covers the screenshot (position:relative scopes the
       overlay to the shot itself, not the whole card). Scoping it is a fix,
       measured in a real browser: with inset measured against the card, the
       overlay also sat ON TOP of the card-face action buttons, so pressing
       "Edit details" or "Archive" opened the live site instead. The name and
       controls stay outside the link; the kebab keeps its own z-index either
       way. */
    .preview-link{position:relative;display:block;flex:none;color:inherit;text-decoration:none}
    .preview-link::after{content:"";position:absolute;z-index:1;inset:0;border-radius:15px 15px 0 0}
    .preview-link:focus-visible{outline:none}
    .preview-link:focus-visible::after{outline:2px solid var(--sky);outline-offset:-2px}
    .preview{position:relative;isolation:isolate;flex:none;overflow:hidden;aspect-ratio:16/10;border-radius:15px 15px 0 0;border-bottom:1px solid var(--hair);background:var(--carbon-2)}
    .preview::after{content:"";position:absolute;z-index:2;inset:auto 0 0;height:38%;background:linear-gradient(transparent,rgba(8,8,11,.25));pointer-events:none}
    .preview img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;background:var(--carbon-2);visibility:hidden}
    .preview[data-preview-state="image"] img{visibility:visible}
    .preview-empty{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(124,108,246,.1),transparent 42%),linear-gradient(145deg,rgba(255,255,255,.025),rgba(255,255,255,.008))}
    .preview-empty-inner{display:grid;justify-items:center;gap:11px;color:var(--slate);font:600 10px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase}
    .preview-empty svg{width:44px;height:32px;color:rgba(242,242,245,.48)}
    .card-body{display:flex;flex:1;flex-direction:column;gap:12px;padding:18px}
    .card-heading{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px}
    /* The name is the loudest plain thing under the screenshot, because it is
       the one word the owner already knows every business by. Clamped to two
       lines so one long name cannot stretch its card past its row. */
    .business-name{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;margin:0;color:var(--ice);font-size:19px;font-weight:800;line-height:1.18;letter-spacing:-.02em}
    /* ONE line of place, trade-first: "Plumbing · Tulsa, OK". The old two-span
       metadata row made the owner parse a location chip and a vertical chip;
       this is one sentence he can read in one glance. */
    .metadata{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;margin-top:7px;color:var(--slate);font-size:12.5px;line-height:1.35}
    .metadata span{display:inline-flex;align-items:center;gap:6px;overflow-wrap:anywhere}
    .metadata span+span::before{content:"";width:3px;height:3px;border-radius:50%;background:var(--slate)}
    /* THE PLAIN STATUS LINE. One chip, plain English, colored dot. The raw
       factory code rides in the tooltip, never on the card face. A min-height
       keeps cards that carry an extra badge (offline, halted batch) from
       growing a different body height than their neighbors. */
    .status-line{display:flex;align-items:center;flex-wrap:wrap;gap:7px;min-height:26px}
    /* The foot carries the card's real controls — open, edit, rebuild,
       archive — pinned to a shared baseline, so every card in a row offers
       its powers at the same height. */
    .card-foot{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:auto;padding-top:11px;border-top:1px solid var(--hair)}
    .status{max-width:100%;overflow:hidden;display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:0;border-radius:999px;background:rgba(255,255,255,.07);color:#A5A4AE;font:600 11.5px/1 var(--sans);white-space:nowrap}
    .status::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--graphite)}
    .status.ok{background:rgba(52,211,153,.14);color:#4ADCA6}
    .status.ok::before{background:#34D399}
    .status.warn{background:rgba(224,164,74,.14);color:#E9B96A}
    .status.warn::before{background:#E0A44A}
    .status.bad{background:rgba(242,109,109,.14);color:#F58A8A}
    .status.bad::before{background:#F26D6D}
    .status.done{background:rgba(124,108,246,.16);color:#B0A4FF}
    .status.done::before{background:#7C6CF6}
    /* Offline is a MEASURED fact from /api/admin/gallery-liveness, not a record
       field: this host answered something other than 200 just now. It rides
       beside the record status rather than replacing it, because "queued" and
       "the mirror is gone" are two different true things about one row. */
    .status.offline{background:rgba(242,109,109,.14);color:#F58A8A}
    .status.offline::before{background:#F26D6D}

    /* PLAIN-LANGUAGE CARD ACTIONS, on the face of the card. The kebab keeps
       the operator extras; the four things the owner actually does to a
       website are buttons with words on them, not icons behind dots. */
    .card-action{display:inline-flex;align-items:center;justify-content:center;min-height:33px;padding:7px 12px;border:1px solid var(--hair);border-radius:9px;background:var(--carbon-2);color:var(--ice);font:600 11.5px/1 var(--sans);white-space:nowrap;text-decoration:none;cursor:pointer}
    .card-action:hover{border-color:rgba(124,108,246,.55)}
    .card-action:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
    .card-action.primary{border:0;background:var(--grad-signal);font-weight:700}
    .card-action.danger{border-color:rgba(242,109,109,.4);color:#F58A8A}
    .card-action.danger:hover{border-color:rgba(242,109,109,.75)}
    .card-action:disabled{cursor:wait;opacity:.55}
    .card-action.grow{flex:1 1 auto}

    /* THE INLINE EDITOR. "Edit details" turns the card itself into the form —
       no navigation, no drawer hunt — and on failure the operator's typed
       words stay put in the box, because they are the one thing here we
       cannot regenerate. */
    .edit-form{display:grid;gap:10px;padding:2px 0}
    .edit-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .edit-field{display:grid;gap:5px;min-width:0}
    .edit-field.wide{grid-column:1/-1}
    .edit-field label{color:var(--slate);font:600 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase}
    .edit-field input,.edit-field textarea{width:100%;padding:9px 11px;border:1px solid var(--hair);border-radius:8px;background:var(--void);color:var(--ice);font:500 13px/1.4 var(--sans)}
    .edit-field textarea{min-height:74px;resize:vertical}
    .edit-field input:focus,.edit-field textarea:focus{border-color:rgba(124,108,246,.65);outline:none}
    .edit-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .edit-hint{grid-column:1/-1;margin:0;color:var(--slate);font-size:11px;line-height:1.45}

    /* "Emailed" is the board's info tone. It is never green: green on this
       page means a live, healthy thing, and a past send is neither. */
    .status.sent{background:rgba(110,139,255,.15);color:#9DB2FF}
    .status.sent::before{background:#6E8BFF}

    /* THE LAST SEND, ON THE FACE OF THE CARD. A footnote line rather than a
       fourth pill: three pills and a button do not fit a 280px card at 390px,
       and this is a date, not a state. */
    .card-sent{display:flex;align-items:center;gap:7px;margin:-4px 0 0;color:var(--slate);font:500 11px/1.35 var(--mono);letter-spacing:.02em}
    .card-sent::before{content:"";width:5px;height:5px;flex:none;border-radius:50%;background:var(--sky)}
    .card-sent b{color:var(--ice);font-weight:600}

    /* SITE BUILT, EMAIL PENDING — a finished site that is not emailing yet is
       STATE, not an error: an amber dot and one honest sentence, so a
       gate_passed row parked behind a halted batch reads as parked instead of
       silently "done". */
    .card-pending{display:flex;align-items:flex-start;gap:7px;margin:-4px 0 0;color:var(--slate);font:500 11px/1.45 var(--mono);letter-spacing:.01em}
    .card-pending::before{content:"";width:5px;height:5px;flex:none;margin-top:4px;border-radius:50%;background:var(--ember)}

    /* SELECTION. The checkbox sits above the stretched card link (z-index 1)
       the same way the kebab does, so picking a card never opens its site. */
    .select-box{position:absolute;z-index:6;top:11px;left:11px;display:grid;place-items:center;width:32px;height:32px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(8,8,11,.74);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);cursor:pointer}
    .select-box:hover{border-color:rgba(124,108,246,.7)}
    .select-box input{width:16px;height:16px;margin:0;accent-color:var(--signal);cursor:pointer}
    .site-card.picked{border-color:rgba(124,108,246,.7)}
    .site-card.picked .select-box{border-color:rgba(124,108,246,.85);background:rgba(124,108,246,.26)}

    /* The batch bar only exists while something is picked. It is sized so the
       count, the destination and the three controls fit on ONE row at 1280 —
       at 680px the send button wrapped under the sentence describing it. */
    .batch-bar{position:fixed;z-index:55;left:50%;bottom:18px;width:min(940px,calc(100vw - 24px));display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;padding:13px 16px;border:1px solid rgba(124,108,246,.45);border-radius:14px;background:rgba(19,19,24,.97);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 22px 60px rgba(0,0,0,.55);transform:translateX(-50%)}
    .batch-count{flex:1 1 auto;min-width:0;color:var(--ice);font:700 14px/1.3 var(--sans)}
    .batch-count small{display:block;margin-top:2px;color:var(--slate);font:500 11px/1.35 var(--sans)}
    .batch-plain{flex:none;padding:9px 12px;border:1px solid var(--hair);border-radius:9px;background:transparent;color:var(--slate);font:600 11px/1 var(--mono);letter-spacing:.07em;text-transform:uppercase;white-space:nowrap;cursor:pointer}
    .batch-plain:hover{border-color:rgba(124,108,246,.55);color:var(--ice)}
    .batch-go{flex:none;padding:11px 17px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:700 13px var(--sans);white-space:nowrap;cursor:pointer}
    .batch-go:disabled{cursor:not-allowed;opacity:.5}
    /* The toast lives in the same corner the bar occupies at narrow widths, so
       it steps up out of the way rather than landing underneath it. */
    body.batching .copy-status{bottom:104px}

    /* THE CONFIRMATION. It exists to answer two questions before the press:
       how many, and to whom. Both are the largest things in it. */
    .confirm-scrim{position:fixed;z-index:84;inset:0;background:rgba(8,8,11,.76);backdrop-filter:blur(6px)}
    .confirm{position:fixed;z-index:85;inset:0;display:grid;place-items:center;padding:20px}
    .confirm-card{width:min(500px,100%);max-height:min(80vh,660px);display:flex;flex-direction:column;padding:22px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:var(--carbon);box-shadow:0 30px 80px rgba(0,0,0,.5)}
    .confirm-card h2{margin:0;font-size:21px;font-weight:800;letter-spacing:-.02em}
    /* 12px, not 11: the board's control radius. Panels are 16, pills are 999,
       controls are 9-12, and a one-off radius is how a system starts to rot. */
    .confirm-to{overflow-wrap:anywhere;margin:13px 0 0;padding:12px 14px;border:1px solid rgba(52,211,153,.28);border-radius:12px;background:rgba(52,211,153,.06);color:var(--pulse);font-size:15px;font-weight:700;line-height:1.4}
    .confirm-why{margin:11px 0 0;color:var(--slate);font-size:13px;line-height:1.6}
    .confirm-list{overflow-y:auto;flex:1 1 auto;margin-top:14px;padding-right:2px;overscroll-behavior:contain}
    /* flex-wrap is load-bearing: without it the refusal sentence squeezes in
       beside the business name instead of dropping to its own line, and the
       name it belongs to wraps to two lines to make room for it. */
    .confirm-row{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px;line-height:1.4}
    .confirm-row:last-child{border-bottom:0}
    .confirm-row-name{overflow-wrap:anywhere;flex:1 1 auto;color:var(--ice)}
    .confirm-row-state{flex:none;color:var(--slate);font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
    .confirm-row-state.ok{color:var(--pulse)}
    .confirm-row-state.bad{color:var(--rose)}
    .confirm-row-why{width:100%;margin:2px 0 0;color:var(--slate);font-size:11.5px;line-height:1.45}
    .confirm-foot{display:flex;align-items:center;gap:10px;flex:none;margin-top:16px}
    .confirm-summary{flex:1 1 auto;min-width:0;color:var(--slate);font:500 12px/1.4 var(--sans)}
    .confirm-cancel{flex:none;padding:11px 15px;border:1px solid var(--hair);border-radius:9px;background:transparent;color:var(--ice);font:600 13px var(--sans);white-space:nowrap;cursor:pointer}
    .confirm-cancel:hover{border-color:rgba(124,108,246,.55)}
    .confirm-go{flex:none;padding:11px 17px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:700 13px var(--sans);white-space:nowrap;cursor:pointer}
    .confirm-go:disabled{cursor:not-allowed;opacity:.55}
    .confirm-go.danger{background:linear-gradient(135deg,#D64545 0%,#F26D6D 100%)}
    /* THE TYPED-NAME CONFIRMATION. Delete forever asks the owner to type the
       business's own name back; the input is the largest thing in the dialog
       so the match is a decision, not a coincidence. */
    .confirm-input{width:100%;margin-top:13px;padding:13px 14px;border:1px solid rgba(242,109,109,.4);border-radius:9px;background:var(--void);color:var(--ice);font:600 15px/1.3 var(--sans)}
    .confirm-input:focus{border-color:rgba(242,109,109,.8);outline:none}
    .confirm-input::placeholder{color:var(--graphite);font-weight:500}

    .menu{position:relative;z-index:4}
    .menu-button{width:40px;height:40px;display:grid;place-items:center;padding:0;border:1px solid var(--hair);border-radius:8px;background:transparent;color:var(--slate);font:700 16px/1 var(--mono);letter-spacing:1px;cursor:pointer}
    .menu-button:hover,.menu-button[aria-expanded="true"]{border-color:rgba(124,108,246,.55);color:var(--ice);background:var(--carbon-2)}
    .menu-panel{position:absolute;z-index:20;top:47px;right:0;width:190px;max-width:calc(100vw - 44px);padding:6px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:var(--carbon);box-shadow:0 18px 45px rgba(0,0,0,.5)}
    .menu-item{width:100%;display:flex;align-items:center;gap:9px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--ice);font:500 12px/1.2 var(--sans);text-align:left;text-decoration:none;white-space:nowrap;cursor:pointer}
    .menu-item:hover,.menu-item:focus-visible{background:var(--carbon-2)}
    .menu-item svg{width:15px;height:15px;flex:none;color:var(--graphite)}

    .state-panel{min-height:230px;display:grid;place-items:center;margin-top:18px;padding:40px 20px;border:1px dashed var(--hair);border-radius:14px;background:var(--carbon)}
    .state-inner{max-width:460px;text-align:center}
    .state-icon{width:48px;height:48px;display:grid;place-items:center;margin:0 auto 15px;border:1px solid var(--hair);border-radius:13px;background:var(--carbon-2);color:var(--signal)}
    .state-icon svg{width:23px;height:23px}
    .state-panel h3{margin:0;color:var(--ice);font-size:18px;letter-spacing:-.015em}
    .state-panel p{margin:8px 0 0;color:var(--slate);font-size:13px;line-height:1.55}
    .load-zone{display:grid;justify-items:center;gap:10px;padding:24px 0 0}
    .load-more,.retry{padding:10px 15px;border:1px solid var(--hair);border-radius:9px;background:var(--carbon);color:var(--ice);font:600 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
    .load-more:hover,.retry:hover{border-color:rgba(124,108,246,.55);background:var(--carbon-2)}
    .load-hint{color:var(--slate);font:500 9px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase}
    .copy-status{position:fixed;z-index:50;right:18px;bottom:18px;max-width:calc(100vw - 36px);padding:10px 13px;border:1px solid rgba(52,211,153,.35);border-radius:9px;background:var(--carbon);color:var(--pulse);font:600 11px/1.3 var(--mono);box-shadow:0 14px 38px rgba(0,0,0,.4)}
    /* Failures talk longer and in the rose tone, so a refused archive or send
       never reads as a confirmation that flashed by. */
    .copy-status.bad{border-color:rgba(242,109,109,.42);color:#F58A8A}

    /* THE SKELETON. The first paint shows the grid's real shape while the
       snapshot is in flight: a card silhouette with no invented words, no
       fake names, nothing that could be mistaken for data. */
    .skeleton-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--hair);border-radius:16px;background:var(--carbon)}
    .skeleton-shot{aspect-ratio:16/10;border-bottom:1px solid var(--hair);background:linear-gradient(100deg,var(--carbon-2) 30%,rgba(255,255,255,.055) 50%,var(--carbon-2) 70%);background-size:220% 100%;animation:skeleton-sweep 1.5s linear infinite}
    .skeleton-body{display:grid;gap:10px;padding:18px}
    .skeleton-line{height:11px;border-radius:6px;background:rgba(255,255,255,.05)}
    .skeleton-line.title{height:16px;width:70%!important}
    @keyframes skeleton-sweep{to{background-position:-220% 0}}

    .access{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(10px)}
    .access-card{width:min(410px,100%);padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:var(--carbon);box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .access-card h2{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}
    .access-card p{margin:0 0 16px;color:var(--slate);font-size:13px;line-height:1.5}
    .access-card input{width:100%;height:44px;margin-bottom:10px;padding:0 13px;border:1px solid var(--hair);border-radius:9px;background:var(--void);color:var(--ice);font:500 13px var(--mono)}
    .access-card button{width:100%;padding:13px 16px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:700 14px var(--sans);cursor:pointer}
    .access-card button:disabled{cursor:wait;opacity:.62}
    .access-status{min-height:18px;margin:10px 0 0!important;color:var(--rose)!important}

    /* THE DETAIL DRAWER. Everything the miner already knew and never showed. */
    .scrim{position:fixed;z-index:60;inset:0;background:rgba(8,8,11,.72);backdrop-filter:blur(5px)}
    .drawer{position:fixed;z-index:70;top:0;right:0;bottom:0;width:min(560px,100%);display:flex;flex-direction:column;border-left:1px solid var(--hair);background:var(--carbon);box-shadow:-24px 0 70px rgba(0,0,0,.5)}
    .drawer-head{display:flex;align-items:flex-start;gap:14px;flex:none;padding:20px 22px 16px;border-bottom:1px solid var(--hair)}
    .drawer-head h2{overflow-wrap:anywhere;margin:0;font-size:21px;font-weight:800;letter-spacing:-.02em}
    .drawer-sub{margin:6px 0 0;color:var(--slate);font-size:12.5px;line-height:1.45}
    .drawer-close{width:36px;height:36px;flex:none;display:grid;place-items:center;margin-left:auto;padding:0;border:1px solid var(--hair);border-radius:8px;background:transparent;color:var(--slate);font:600 17px/1 var(--mono);cursor:pointer}
    .drawer-close:hover{border-color:rgba(124,108,246,.55);color:var(--ice)}
    .drawer-body{flex:1;overflow-y:auto;padding:4px 22px 30px;overscroll-behavior:contain}
    .block{padding:17px 0;border-bottom:1px solid var(--hair)}
    .block:last-child{border-bottom:0}
    .block h3{margin:0 0 11px;color:var(--slate);font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase}
    .rows{display:grid;gap:9px}
    .row{display:grid;grid-template-columns:118px minmax(0,1fr);align-items:baseline;gap:12px;font-size:13.5px;line-height:1.5}
    .row dt{color:var(--slate);font-size:12px}
    .row dd{overflow-wrap:anywhere;margin:0;color:var(--ice)}
    .row a{color:var(--sky);text-decoration:none}
    .row a:hover{text-decoration:underline}
    .missing{color:var(--slate);font-style:italic}
    .bullets{display:grid;gap:8px;margin:0;padding:0;list-style:none}
    .bullets li{position:relative;padding-left:17px;color:var(--ice);font-size:13.5px;line-height:1.5}
    .bullets li::before{content:"";position:absolute;top:8px;left:0;width:6px;height:6px;border-radius:50%;background:var(--signal)}
    .bullets.warn li::before{background:var(--ember)}
    .pill-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:11px}
    .pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--ice);font:600 12px/1 var(--sans)}
    .pill.good{background:rgba(52,211,153,.15);color:#4ADCA6}
    .pill.mid{background:rgba(224,164,74,.15);color:#E9B96A}
    .pill.low{background:rgba(242,109,109,.15);color:#F58A8A}
    .note{margin:9px 0 0;color:var(--slate);font-size:12px;line-height:1.5}
    .timeline{display:grid;gap:11px;margin:0;padding:0;list-style:none}
    .timeline li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:11px;font-size:13px;line-height:1.45}
    .when{color:var(--slate);font:500 11px/1.5 var(--mono);white-space:nowrap}
    .what{overflow-wrap:anywhere;color:var(--ice)}
    .what small{display:block;margin-top:2px;color:var(--slate);font-size:11.5px}
    .note-form{display:grid;gap:9px}
    .note-form textarea{min-height:78px;padding:11px 12px;border:1px solid var(--hair);border-radius:9px;background:var(--void);color:var(--ice);font:500 13.5px/1.5 var(--sans);resize:vertical}
    .note-form textarea:focus{border-color:rgba(124,108,246,.65);outline:none}
    .note-form button{justify-self:start;padding:9px 16px;border:0;border-radius:8px;background:var(--grad-signal);color:var(--ice);font:700 12.5px var(--sans);cursor:pointer}
    .note-form button:disabled{cursor:wait;opacity:.6}
    .saved-notes{display:grid;gap:11px;margin-top:14px}
    .saved-note{padding:11px 13px;border:1px solid var(--hair);border-radius:10px;background:var(--carbon-2)}
    .saved-note p{overflow-wrap:anywhere;margin:0;color:var(--ice);font-size:13.5px;line-height:1.5;white-space:pre-wrap}
    .saved-note span{display:block;margin-top:6px;color:var(--slate);font:500 10.5px/1 var(--mono);letter-spacing:.06em}
    /* The send block is styled as a statement of destination, not a launcher.
       The address it will reach is the largest thing in it. */
    .send-box{padding:15px 16px;border:1px solid rgba(52,211,153,.28);border-radius:12px;background:rgba(52,211,153,.06)}
    .send-box.blocked{border-color:rgba(242,109,109,.3);background:rgba(242,109,109,.06)}
    .send-to{overflow-wrap:anywhere;margin:0 0 4px;color:var(--pulse);font-size:14.5px;font-weight:700;line-height:1.4}
    .send-box.blocked .send-to{color:#F58A8A}
    .send-why{margin:0;color:var(--slate);font-size:12.5px;line-height:1.55}
    .send-button{width:100%;margin-top:13px;padding:12px 16px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:700 13.5px var(--sans);cursor:pointer}
    .send-button:disabled{cursor:not-allowed;opacity:.5}
    .send-result{margin:11px 0 0;color:var(--ice);font-size:12.5px;line-height:1.5}
    .send-result.bad{color:#F58A8A}
    .drawer-loading{padding:40px 0;color:var(--slate);font-size:13px;text-align:center}

    @keyframes card-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}

    @media(max-width:760px){
      .masthead{align-items:flex-start;flex-wrap:wrap}.masthead-note{width:100%;margin-left:73px;justify-content:flex-start}
      .intro{display:block}.result-note{margin-top:14px;text-align:left}
      .controls{position:static;grid-template-columns:1fr;align-items:stretch;gap:12px}.tabs{width:100%}.search-wrap{order:2}.filter-wrap{order:3}.sort-wrap{order:4}.archive-control{order:5}
    }
    @media(max-width:480px){
      .shell{padding:18px 14px 44px}.mark{width:50px;height:50px;border-radius:13px}.mark svg{width:38px;height:38px}
      .masthead{gap:12px;padding-bottom:17px}.masthead-note{margin-left:0}.intro{padding:26px 0 18px}.intro p{font-size:13px}
      .controls{padding:13px}.tabs{gap:19px;overflow-x:auto}.tab{font-size:10px}.catalog-note{display:none}
      .gallery{gap:12px}.state-panel{min-height:210px;padding:32px 16px}
      .drawer-head{padding:16px 15px 13px}.drawer-body{padding:4px 15px 26px}
      .row{grid-template-columns:1fr;gap:2px}.row dt{font-size:11px}
      .timeline li{grid-template-columns:1fr;gap:2px}
      /* At 390 the bar becomes a stacked block: the count on its own line and
         a full-width send button, so nothing shrinks below its own text. */
      .batch-bar{bottom:12px;width:calc(100vw - 20px);padding:12px 13px}
      .batch-count{flex:1 1 100%}
      .batch-plain,.batch-go{flex:1 1 auto;text-align:center}
      .confirm{padding:12px}.confirm-card{padding:18px}
      .confirm-card h2{font-size:19px}.confirm-to{font-size:14px}
      .confirm-foot{flex-wrap:wrap}.confirm-summary{width:100%;order:3}
      .confirm-cancel,.confirm-go{flex:1 1 auto;text-align:center}
    }
    @media(prefers-reduced-motion:reduce){
      *,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      .site-card:hover{transform:none}
    }
    @media print{
      .access,.controls,.menu,.load-zone,.copy-status,.skip-link,.select-box,.batch-bar,.confirm,.confirm-scrim{display:none!important}
      .shell{max-width:none;padding:0}.site-card{break-inside:avoid}.gallery{grid-template-columns:repeat(3,1fr)}
    }
  </style>
</head>
<body>
  ${operatorNav("gallery")}
  <div class="shell locked" id="galleryShell" inert>
    <a class="skip-link" href="#galleryMain">Skip to gallery</a>
    <header class="masthead">
      <div class="mark" aria-label="WSS Labs mark">
        <svg width="42" height="42" viewBox="8 14 48 34" fill="none" aria-hidden="true">
          <defs><linearGradient id="wssSignal" x1="12" y1="42" x2="50" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#4A6CF7"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs>
          <path d="M12 24 L21 42 L30 26 L39 42 L50 20" stroke="url(#wssSignal)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="50" cy="20" r="3.4" fill="#34D399"/>
        </svg>
      </div>
      <div>
        <p class="eyebrow">WSS Command Center</p>
        <h1>Site Gallery</h1>
      </div>
      <div class="masthead-note">
        <span class="readonly">Emails come to you only</span>
        <span class="catalog-note">Static previews · live factory records</span>
      </div>
    </header>

    <main id="galleryMain">
      <section class="intro" aria-labelledby="galleryTitle">
        <div class="intro-copy">
          <h2 id="galleryTitle">Your websites, at a glance.</h2>
          <p>Every site we built, newest first. Open a website, fix a wrong name or trade, leave yourself a private note, rebuild, or archive what you are done with. Under the three dots you can email yourself the before-and-after proof, and "Everything we know" opens the full file on the business — their phone, their email, why we picked them, and what is wrong with the site they have now.</p>
          <p class="intro-send" id="ownerNote">Every email on this page goes to your own inbox. The business is never emailed.</p>
        </div>
        <div class="result-note" id="resultNote" aria-live="polite">Waiting for operator access</div>
      </section>

      <!-- THE LIVE CAMPAIGN CLOCK. Filled only when the factory snapshot
           carries a stamped timing record for the newest active batch; hidden
           otherwise. One line, monospace: the campaign's real pace. -->
      <p class="campaign-clock" id="campaignClock" role="status" aria-live="polite" hidden></p>

      <section class="controls" aria-label="Gallery controls">
        <div class="tabs" role="tablist" aria-label="Gallery views">
          <button class="tab" id="clientsTab" type="button" role="tab" aria-selected="false" aria-controls="galleryRegion" tabindex="-1" data-tab="clients">Clients <span class="tab-count" id="clientsCount">0</span></button>
          <button class="tab active" id="buildsTab" type="button" role="tab" aria-selected="true" aria-controls="galleryRegion" tabindex="0" data-tab="builds">All builds <span class="tab-count" id="buildsCount">0</span></button>
        </div>
        <label class="search-wrap" for="searchInput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
          <input class="search" id="searchInput" type="search" autocomplete="off" placeholder="Search name, city, vertical, or ID" aria-label="Search sites by business name, city, state, vertical, or prospect ID">
        </label>
        <label class="filter-wrap" for="tradeFilter">
          <span class="sort-label" aria-hidden="true">Show only</span>
          <select class="sort" id="tradeFilter" aria-label="Show only one trade">
            <option value="" selected>All trades</option>
          </select>
        </label>
        <label class="filter-wrap" for="statusFilter">
          <span class="sort-label" aria-hidden="true">Status</span>
          <select class="sort" id="statusFilter" aria-label="Show only one status, in plain English">
            <option value="" selected>Any status</option>
          </select>
        </label>
        <label class="sort-wrap" for="sortSelect">
          <span class="sort-label" aria-hidden="true">Sort</span>
          <select class="sort" id="sortSelect" aria-label="Sort sites">
            <option value="newest" selected>Newest first</option>
            <option value="name">Business name (A–Z)</option>
            <option value="vertical">Trade</option>
          </select>
        </label>
        <label class="archive-control" id="archiveControl" for="showArchived">
          <input id="showArchived" type="checkbox">
          <span>Show archived <span class="tab-count" id="archivedCount"></span></span>
        </label>
      </section>

      <section id="galleryRegion" role="tabpanel" aria-labelledby="buildsTab">
        <div class="state-panel" id="statePanel">
          <div class="state-inner">
            <div class="state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>
            </div>
            <h3>Loading gallery</h3>
            <p>Reading the latest factory snapshot.</p>
          </div>
        </div>
        <div class="gallery" id="galleryGrid" role="list" aria-live="polite" hidden></div>
        <div class="load-zone" id="loadZone" hidden>
          <button class="load-more" id="loadMore" type="button">Load 60 more</button>
          <span class="load-hint" id="loadHint"></span>
          <span id="loadSentinel" aria-hidden="true"></span>
        </div>
      </section>
    </main>
  </div>

  <div class="access" id="accessGate" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
    <form class="access-card" id="accessForm">
      <h2 id="accessTitle">Operator access</h2>
      <p>Paste your admin token to open the site gallery. It stays in this browser only.</p>
      <input id="tokenInput" type="password" autocomplete="current-password" aria-label="Admin token" required>
      <button id="accessButton" type="submit">Open site gallery</button>
      <p class="access-status" id="accessStatus" role="alert" aria-live="polite"></p>
    </form>
  </div>

  <div class="copy-status" id="copyStatus" role="status" aria-live="polite" hidden></div>

  <!-- The batch bar appears only once a card is picked. The email button's
       words are about your own inbox — nothing here can address a business —
       and Archive / Restore are the reversible pair from gallery-manage. -->
  <div class="batch-bar" id="batchBar" role="region" aria-label="Selected sites" hidden>
    <div class="batch-count"><span id="batchCount">0 selected</span><small id="batchNote">Every one of these emails comes to you.</small></div>
    <button class="batch-plain" id="batchSelectAll" type="button">Pick all shown</button>
    <button class="batch-plain" id="batchClear" type="button">Clear</button>
    <button class="batch-plain" id="batchArchive" type="button">Archive</button>
    <button class="batch-plain" id="batchRestore" type="button">Restore</button>
    <button class="batch-go" id="batchSend" type="button">Email proofs to me</button>
  </div>

  <!-- ONE CONFIRMATION, SHARED BY THE SINGLE SEND AND THE BATCH. It answers the
       two questions worth answering before a press — how many, and to whom —
       and then becomes the progress list for the same run, so the result lands
       in the same place the decision was made. -->
  <div class="confirm-scrim" id="confirmScrim" hidden></div>
  <div class="confirm" id="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" hidden>
    <div class="confirm-card">
      <h2 id="confirmTitle">Email this proof to yourself</h2>
      <p class="confirm-to" id="confirmTo"></p>
      <p class="confirm-why" id="confirmWhy"></p>
      <div class="confirm-list" id="confirmList"></div>
      <div class="confirm-foot">
        <p class="confirm-summary" id="confirmSummary" role="status" aria-live="polite"></p>
        <button class="confirm-cancel" id="confirmCancel" type="button">Cancel</button>
        <button class="confirm-cancel" id="confirmCheck" type="button">Check first</button>
        <button class="confirm-go" id="confirmGo" type="button">Send</button>
      </div>
    </div>
  </div>

  <!-- THE ASK. One small dialog for the two decisions that deserve their own
       screen: starting a rebuild, and Delete forever. The delete variant
       shows a typed-name input — the business's own name, exactly as the
       card shows it — because "gone for good" should never be one click. -->
  <div class="confirm-scrim" id="askScrim" hidden></div>
  <div class="confirm" id="askDialog" role="dialog" aria-modal="true" aria-labelledby="askTitle" hidden>
    <div class="confirm-card">
      <h2 id="askTitle"></h2>
      <p class="confirm-why" id="askWhy"></p>
      <input class="confirm-input" id="askInput" type="text" autocomplete="off" spellcheck="false" hidden>
      <div class="confirm-foot">
        <p class="confirm-summary" id="askSummary" role="status" aria-live="polite" hidden></p>
        <button class="confirm-cancel" id="askCancel" type="button">Cancel</button>
        <button class="confirm-go" id="askGo" type="button"></button>
      </div>
    </div>
  </div>

  <!-- The drawer is built empty and filled per business from an admin-gated
       POST. No contact detail is ever rendered into the page source, put in the
       URL, or left behind after it closes. -->
  <div class="scrim" id="drawerScrim" hidden></div>
  <aside class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" hidden>
    <header class="drawer-head">
      <div>
        <h2 id="drawerTitle">Business</h2>
        <p class="drawer-sub" id="drawerSub"></p>
      </div>
      <button class="drawer-close" id="drawerClose" type="button" aria-label="Close details">&times;</button>
    </header>
    <div class="drawer-body" id="drawerBody">
      <p class="drawer-loading">Opening the file on this business…</p>
    </div>
  </aside>

  <!-- Native templates keep every generated card semantic without a framework. -->
  <template id="siteShotTemplate"><img loading="lazy" decoding="async" alt=""></template>
  <template id="menuButtonTemplate"><button class="menu-button" type="button" aria-haspopup="menu" aria-expanded="false">•••</button></template>
  <template id="menuPanelTemplate"><div class="menu-panel" role="menu" hidden></div></template>
  <template id="openSiteTemplate"><a class="menu-item" data-action="open-site" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>Open website</a></template>
  <template id="openReportTemplate"><a class="menu-item" data-action="open-report" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/></svg>Open report</a></template>
  <template id="copySiteTemplate"><button class="menu-item" data-action="copy-site" type="button" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>Copy site link</button></template>
  <template id="copyIdTemplate"><button class="menu-item" data-action="copy-id" type="button" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8zM4 16V4h12"/></svg>Copy prospect ID</button></template>
  <template id="detailsTemplate"><button class="menu-item" data-action="details" type="button" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01"/></svg>Everything we know</button></template>
  <!-- The send lives in the kebab, first, because that is where an operator
       looks for it. Both labels name the destination as "me": there is exactly
       one send route on this page and it addresses the owner's own inbox. -->
  <template id="sendProofTemplate"><button class="menu-item" data-action="send-proof" type="button" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 7 9-7"/></svg>Email this proof to me</button></template>
  <template id="resendProofTemplate"><button class="menu-item" data-action="resend-proof" type="button" role="menuitem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg>Email it to me again</button></template>
  <template id="selectBoxTemplate"><label class="select-box"><input type="checkbox"></label></template>

  <script>
  (function(){
    "use strict";
    var KEY="wsl_admin_token";
    var PAGE_SIZE=60;
    var SEARCH_DEBOUNCE=120;
    var MAX_BATCH=100;
    // routing is what the server says about the ONE send route this page can
    // reach. It starts empty and is never guessed: until the snapshot answers,
    // no send action is offered at all.
    var state={clients:[],builds:[],activeTab:"builds",query:"",sort:"newest",tradeFilter:"",statusFilter:"",showArchived:false,visibleLimit:PAGE_SIZE,loaded:false,liveness:{},routing:{recipient:"",canSend:false,headline:""},picked:{}};
    var loadInFlight=null;
    var livenessInFlight=null;
    var copyTimer=null;
    var searchTimer=null;
    var animateNextRender=true;
    var galleryShell=document.getElementById("galleryShell");
    var accessGate=document.getElementById("accessGate");
    var accessForm=document.getElementById("accessForm");
    var accessButton=document.getElementById("accessButton");
    var tokenInput=document.getElementById("tokenInput");
    var accessStatus=document.getElementById("accessStatus");
    var galleryGrid=document.getElementById("galleryGrid");
    var statePanel=document.getElementById("statePanel");
    var resultNote=document.getElementById("resultNote");
    var loadZone=document.getElementById("loadZone");
    var loadMore=document.getElementById("loadMore");
    var loadHint=document.getElementById("loadHint");
    var searchInput=document.getElementById("searchInput");
    var sortSelect=document.getElementById("sortSelect");
    var tradeFilter=document.getElementById("tradeFilter");
    var statusFilter=document.getElementById("statusFilter");
    var archiveControl=document.getElementById("archiveControl");
    var showArchived=document.getElementById("showArchived");
    var archivedCount=document.getElementById("archivedCount");
    var galleryRegion=document.getElementById("galleryRegion");
    var ownerNote=document.getElementById("ownerNote");
    var campaignClock=document.getElementById("campaignClock");
    var drawer=document.getElementById("detailDrawer");
    var drawerScrim=document.getElementById("drawerScrim");
    var drawerTitle=document.getElementById("drawerTitle");
    var drawerSub=document.getElementById("drawerSub");
    var drawerBody=document.getElementById("drawerBody");
    var drawerClose=document.getElementById("drawerClose");
    var batchBar=document.getElementById("batchBar");
    var batchCount=document.getElementById("batchCount");
    var batchNote=document.getElementById("batchNote");
    var batchSelectAll=document.getElementById("batchSelectAll");
    var batchClear=document.getElementById("batchClear");
    var batchArchive=document.getElementById("batchArchive");
    var batchRestore=document.getElementById("batchRestore");
    var batchSend=document.getElementById("batchSend");
    var confirmScrim=document.getElementById("confirmScrim");
    var confirmDialog=document.getElementById("confirmDialog");
    var confirmTitle=document.getElementById("confirmTitle");
    var confirmTo=document.getElementById("confirmTo");
    var confirmWhy=document.getElementById("confirmWhy");
    var confirmList=document.getElementById("confirmList");
    var confirmSummary=document.getElementById("confirmSummary");
    var confirmCancel=document.getElementById("confirmCancel");
    var confirmCheck=document.getElementById("confirmCheck");
    var confirmGo=document.getElementById("confirmGo");
    var confirmReturnFocus=null;
    var askScrim=document.getElementById("askScrim");
    var askDialog=document.getElementById("askDialog");
    var askTitle=document.getElementById("askTitle");
    var askWhy=document.getElementById("askWhy");
    var askInput=document.getElementById("askInput");
    var askSummary=document.getElementById("askSummary");
    var askCancel=document.getElementById("askCancel");
    var askGo=document.getElementById("askGo");
    var askReturnFocus=null;
    var askBusy=false;
    var askSubmit=null;
    var sendInFlight=false;
    var drawerRequest=0;
    var drawerReturnFocus=null;
    var drawerItem=null;
    var menuSequence=0;
    var previewMarkSequence=0;
    // prospect id -> the card's "last emailed" line, so a send can update the
    // card it came from without hunting the DOM for it.
    var sentLines={};

    function token(){try{return localStorage.getItem(KEY)||"";}catch(_){return "";}}
    function setToken(value){try{localStorage.setItem(KEY,value);}catch(_){}}
    function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}
    function errorWithStatus(message,status,payload){var error=new Error(message);error.status=status;error.payload=payload;return error;}

    function api(path,opts){
      opts=opts||{};
      if(!token())return Promise.reject(errorWithStatus("Operator token required",401));
      opts.headers=Object.assign({},opts.headers||{});
      opts.headers["x-admin-token"]=token();
      opts.cache="no-store";
      return fetch(path,opts).then(function(response){
        return response.text().then(function(raw){
          var payload={};
          try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
          if(!response.ok)throw errorWithStatus(payload.message||payload.error||("Request failed ("+response.status+")"),response.status,payload);
          return payload;
        });
      });
    }

    // =====================================================================
    // THE LIVE CAMPAIGN CLOCK. The newest active batch's own stopwatch —
    // stamped moments the factory record already carries — as one line the
    // owner can read while a campaign runs: when it fired, how long each
    // first took, how many have gone out. Every value is derived from the
    // snapshot's campaignTiming record; an absent, unparseable, or pre-start
    // stamp hides its segment, and no record at all hides the whole strip.
    // =====================================================================
    function campaignClockTimeOfDay(ms){
      var at=new Date(ms);
      function two(n){return String(n).padStart(2,"0");}
      return two(at.getHours())+":"+two(at.getMinutes());
    }
    function campaignClockElapsedText(startMs,iso){
      var at=Date.parse(text(iso,""));
      if(!isFinite(at)||at<startMs)return "";
      var seconds=Math.floor((at-startMs)/1000);
      var hours=Math.floor(seconds/3600);
      var minutes=Math.floor((seconds%3600)/60);
      function two(n){return String(n).padStart(2,"0");}
      return "+"+(hours?hours+":"+two(minutes):String(minutes))+":"+two(seconds%60);
    }
    function campaignClockText(timing){
      var record=timing&&typeof timing==="object"?timing:null;
      var startMs=Date.parse(text(record&&record.startedAt,""));
      if(!isFinite(startMs))return "";
      var parts=["fire "+campaignClockTimeOfDay(startMs)];
      var lead=campaignClockElapsedText(startMs,record.firstQualifiedAt);
      if(lead)parts.push("first lead "+lead);
      var build=campaignClockElapsedText(startMs,record.firstBuiltAt);
      if(build)parts.push("first build "+build);
      var email=campaignClockElapsedText(startMs,record.firstSentAt);
      if(email)parts.push("first email "+email);
      var sent=Math.max(0,Number(record&&record.sentCount)||0);
      var goal=Math.max(0,Number(record&&record.requested)||0);
      if(goal>0)parts.push("sent "+sent+"/"+goal);
      return "Campaign clock: "+parts.join(" · ");
    }
    function paintCampaignClock(timing){
      if(!campaignClock)return;
      var sentence=campaignClockText(timing);
      campaignClock.hidden=!sentence;
      if(sentence)campaignClock.textContent=sentence;
    }

    // The clock rides the SAME snapshots this page already fetches — the
    // first load and every live-refresh poll. Wrapping api() here (the live
    // refresh script shares this scope and calls it on every poll) keeps the
    // clock current without a second request, a second timer, or any change
    // to the refresh lane itself. The wrap is pass-through: a paint problem
    // is swallowed, never shown as a failed gallery load.
    var apiForSnapshot=api;
    api=function(path,opts){
      return apiForSnapshot(path,opts).then(function(payload){
        if(path==="/api/admin/gallery-data"){
          try{paintCampaignClock(payload&&payload.campaignTiming);}catch(_){/* the clock is annotation, never a failure */}
        }
        return payload;
      });
    };

    function showGate(message){
      accessGate.hidden=false;
      galleryShell.classList.add("locked");
      galleryShell.inert=true;
      galleryShell.setAttribute("inert","");
      accessStatus.textContent=message||"";
      accessButton.disabled=false;
      accessButton.textContent="Open site gallery";
      window.setTimeout(function(){tokenInput.focus();},0);
    }

    function hideGate(){
      accessGate.hidden=true;
      galleryShell.classList.remove("locked");
      galleryShell.inert=false;
      galleryShell.removeAttribute("inert");
      accessStatus.textContent="";
      tokenInput.value="";
      window.setTimeout(function(){searchInput.focus();},0);
    }

    function text(value,fallback){
      var normalized=String(value==null?"":value).trim();
      return normalized||fallback||"";
    }

    function safeHttpUrl(value){
      var raw=text(value,"");
      if(!raw)return "";
      try{
        var parsed=new URL(raw,window.location.origin);
        return parsed.protocol==="http:"||parsed.protocol==="https:"?parsed.href:"";
      }catch(_){return "";}
    }

    // Shareable view state. ONLY view params (tab/q/sort/archived) ever touch
    // the URL — the operator token lives in localStorage and nowhere else.
    function readUrlState(){
      try{
        var params=new URLSearchParams(window.location.search);
        var tab=params.get("tab");
        if(tab==="clients"||tab==="builds")state.activeTab=tab;
        var query=text(params.get("q"),"");
        if(query){state.query=query.toLowerCase();searchInput.value=query;}
        var sort=params.get("sort");
        if(sort==="name"||sort==="vertical"){state.sort=sort;sortSelect.value=sort;}
        if(params.get("archived")==="1"){state.showArchived=true;showArchived.checked=true;}
      }catch(_){}
    }

    function writeUrlState(){
      try{
        var params=new URLSearchParams();
        if(state.activeTab!=="builds")params.set("tab",state.activeTab);
        if(state.query)params.set("q",state.query);
        if(state.sort!=="newest")params.set("sort",state.sort);
        if(state.showArchived)params.set("archived","1");
        var qs=params.toString();
        window.history.replaceState(null,"",qs?"?"+qs:window.location.pathname);
      }catch(_){}
    }

    // Verticals arrive as raw DB tokens ("hvac", "med spa", "TREE SERVICE").
    // Display-case them without touching the searchable raw value.
    function displayVertical(value){
      var raw=text(value,"");
      if(!raw)return "";
      return raw.toLowerCase()
        .replace(/[a-z0-9][a-z0-9']*/g,function(word){return word.charAt(0).toUpperCase()+word.slice(1);})
        .replace(/\\bHvac\\b/g,"HVAC")
        .replace(/\\bLlc\\b/g,"LLC");
    }

    function icon(path){
      var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 24 24");
      svg.setAttribute("fill","none");
      svg.setAttribute("stroke","currentColor");
      svg.setAttribute("stroke-width","1.8");
      svg.setAttribute("stroke-linecap","round");
      svg.setAttribute("stroke-linejoin","round");
      svg.setAttribute("aria-hidden","true");
      var node=document.createElementNS("http://www.w3.org/2000/svg","path");
      node.setAttribute("d",path);
      svg.appendChild(node);
      return svg;
    }

    // THE PLAIN VOICE, SNAPSHOT AT BUILD TIME. VOICE.chips carries the label
    // and tone for every status this factory serves, resolved from
    // lib/operator-voice when that shared module is present and from this
    // page's own fallback map when it is not. The owner never sees
    // "line_queued"; he sees "Waiting for your OK", amber dot and all.
    var VOICE=${JSON.stringify(VOICE)};
    function rawStatusText(value){
      return text(value,"Status not set").replace(/[_-]+/g," ").replace(/\\b\\w/g,function(letter){return letter.toUpperCase();});
    }
    function statusTone(raw,item){
      var value=text(raw,"").toLowerCase();
      if((item&&item.archived)||/(?:^|[_ -])completed?(?:$|[_ -])/.test(value))return "done";
      if(/error|fail|reject|blocked/.test(value))return "bad";
      if(/ready|live|built|delivered|paid|active/.test(value))return "ok";
      if(/pending|queue|review|hold|wait/.test(value))return "warn";
      return "";
    }
    // One chip decision for one card: archived wins (it is where the owner
    // put the card, not what the factory last did), then the plain-voice
    // table, then an honest title-casing of the raw code with the tone rules
    // this page has always used. A raw truth beats a wrong translation.
    function voiceChip(item){
      if(item&&item.archived)return {label:"Archived",tone:"done",raw:"archived_legacy",known:true};
      var raw=text(item&&item.status,"");
      var entry=VOICE.chips[raw.toLowerCase()];
      if(entry&&entry.label)return {label:entry.label,tone:entry.tone||"",raw:raw,known:true};
      return {label:raw?rawStatusText(raw):"Status not set",tone:statusTone(raw,item),raw:raw,known:false};
    }
    // Statuses in the filter dropdown read "plain (factory code)" so the
    // jargon stays findable without being the sentence the owner reads.
    function chipLabelWithCode(item){
      var chip=voiceChip(item);
      return chip.raw&&chip.label.toLowerCase()!==chip.raw.toLowerCase()
        ?chip.label+" ("+chip.raw+")"
        :chip.label;
    }
    // Trades: the shared voice map may carry a plain name for a DB token
    // ("hvac" -> "Heating & cooling"); otherwise display-case the token.
    function plainTrade(value){
      var raw=text(value,"");
      if(!raw)return "";
      var hit=VOICE.plain[raw.toLowerCase()];
      return typeof hit==="string"&&hit?hit:displayVertical(raw);
    }

    // A HALTED BATCH'S REASON, IN THE OWNER'S WORDS. The two codes the sweeper
    // and the owner's own halt actually write are translated; anything else
    // passes through with its underscores aired — a raw truth beats a wrong
    // translation. The superseded flag lets the badge say the sharper word.
    function plainHaltReason(code){
      var raw=text(code,"");
      if(!raw)return {plain:"",superseded:false};
      if(raw.indexOf("superseded_by_newer_practice_run:")===0)
        return {plain:"superseded by a newer run ("+raw.slice("superseded_by_newer_practice_run:".length)+")",superseded:true};
      if(raw==="owner_cleared_stuck_batch")
        return {plain:"you cleared this batch as stuck",superseded:false};
      return {plain:raw.replace(/[_-]+/g," "),superseded:false};
    }

    // SITE BUILT, EMAIL PENDING. gate_passed means the site is finished while
    // its release write and send lane have not caught up; a halted batch is
    // the measured reason that lane is parked. The card says the true state in
    // one sentence instead of letting a finished site read as done, and an
    // honest "waiting" when no reason is on file.
    function pendingSentence(item){
      var value=text(item&&item.status,"").toLowerCase();
      if(value!=="gate_passed"&&value!=="line_gate_passed"&&value!=="mirrored")return "";
      if(text(item&&item.batchState,"")==="halted"){
        var reason=plainHaltReason(item&&item.batchHaltReason).plain||"halted";
        return value==="mirrored"
          ?"Site built, waiting on final inspection — its batch is halted: "+reason+"."
          :"Site built, email pending — its batch is halted: "+reason+".";
      }
      return value==="mirrored"
        ?"Site built — waiting on final inspection."
        :"Site built, email pending — waiting for its send run to pick it up.";
    }

    function matches(item,query){
      if(!query)return true;
      var haystack=[item.businessName,item.city,item.state,item.vertical,item.prospectId].map(function(value){return text(value,"").toLowerCase();}).join(" ");
      return haystack.indexOf(query)>=0;
    }

    function passesFilters(item){
      if(state.tradeFilter&&text(item.vertical,"").toLowerCase()!==state.tradeFilter)return false;
      if(state.statusFilter){
        var raw=text(item.status,"").toLowerCase();
        if(item.archived){if(state.statusFilter!=="archived_legacy")return false;}
        else if(raw!==state.statusFilter)return false;
      }
      return true;
    }

    function byName(a,b){
      return text(a.businessName,"").toLowerCase().localeCompare(text(b.businessName,"").toLowerCase());
    }

    function sortRows(rows){
      if(state.sort==="name")return rows.slice().sort(byName);
      if(state.sort==="vertical")return rows.slice().sort(function(a,b){
        return text(a.vertical,"").toLowerCase().localeCompare(text(b.vertical,"").toLowerCase())||byName(a,b);
      });
      return rows;
    }

    function activeRows(){
      var source=state.activeTab==="clients"?state.clients:state.builds;
      return sortRows(source.filter(function(item){
        if(state.activeTab==="clients"&&item.archived)return false;
        if(state.activeTab==="builds"&&!state.showArchived&&item.archived)return false;
        return passesFilters(item)&&matches(item,state.query);
      }));
    }

    function closeMenus(except){
      document.querySelectorAll(".menu-button[aria-expanded='true']").forEach(function(button){
        if(button===except)return;
        button.setAttribute("aria-expanded","false");
        var panel=button.parentNode.querySelector(".menu-panel");
        if(panel)panel.hidden=true;
      });
    }

    function notify(message,isError){
      var node=document.getElementById("copyStatus");
      window.clearTimeout(copyTimer);
      node.textContent=message;
      // Failures are a different color and stay longer: a refusal that flashes
      // past in the success green reads as a confirmation.
      node.classList.toggle("bad",isError===true);
      node.hidden=false;
      copyTimer=window.setTimeout(function(){node.hidden=true;},isError===true?3200:1800);
    }

    function legacyCopy(value){
      return new Promise(function(resolve,reject){
        var area=document.createElement("textarea");
        area.value=value;
        area.setAttribute("readonly","");
        area.style.position="fixed";
        area.style.opacity="0";
        document.body.appendChild(area);
        area.select();
        try{
          var copied=document.execCommand("copy");
          document.body.removeChild(area);
          copied?resolve():reject(new Error("Copy failed"));
        }catch(error){document.body.removeChild(area);reject(error);}
      });
    }

    function copyText(value,label){
      var operation=navigator.clipboard&&window.isSecureContext?navigator.clipboard.writeText(value):legacyCopy(value);
      operation.then(function(){notify(label+" copied");}).catch(function(){notify("Copy failed");});
    }

    // ---------------------------------------------------------------------
    // SENDING, FROM THE CARD.
    //
    // There is one send route on this page: /api/admin/send-mirror-proof. It
    // passes internalOwnerProof:true, which makes lib/email.js REPLACE the
    // recipient with GHOST_AGENCY_OWNER_EMAIL, force cc and bcc empty, and then
    // refuse the send unless the resolved address already equals the owner's.
    // No argument this page can pass reaches a business.
    //
    // So the UI's whole job here is to say that out loud BEFORE the press, and
    // to only offer the action where the route would actually accept it.
    // ---------------------------------------------------------------------

    // ONE place that turns a stored timestamp into something readable, and one
    // place that decides what to do when it is not a timestamp at all: print
    // the raw value rather than "Invalid Date" over the top of it.
    function formatWhen(value,options){
      var raw=text(value,"");
      if(!raw)return "";
      var parsed=new Date(raw);
      if(isNaN(parsed.getTime()))return raw;
      return parsed.toLocaleString(undefined,options);
    }

    // The short form, for a card face. The year is dropped for anything from
    // this year, which is every send an operator is actually looking at.
    function shortWhen(value){
      var parsed=new Date(text(value,""));
      var sameYear=!isNaN(parsed.getTime())&&parsed.getFullYear()===new Date().getFullYear();
      return formatWhen(value,sameYear
        ?{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}
        :{month:"short",day:"numeric",year:"numeric"});
    }

    // WHETHER THIS CARD MAY BE SENT, decided the same way the server decides.
    // item.sendable is the server's own preview-host-guard verdict; offline is our
    // own measurement that the host stopped answering. An offline mirror is
    // excluded for the reason "Open live site" is: mailing a proof that opens
    // on a dead host is worse than not offering the button.
    function canSendItem(item){
      return Boolean(state.routing&&state.routing.canSend)
        &&Boolean(item&&item.sendable)
        &&Boolean(text(item&&item.prospectId,""))
        &&!isOffline(item);
    }

    // WHY A SEND WAS REFUSED, IN THE SERVER'S OWN WORDS.
    //
    // /api/admin/send-mirror-proof answers 422 with the sentence that says what
    // to do — "This prospect has no forge job at stage done with a deployed
    // alias. Re-mirror it first." — nested at payload.send.message. The generic
    // api() error carries only the status line, so reading it alone printed
    // "Request failed (422)" beside a business name and threw the actionable
    // half away. Measured in the browser before this existed.
    //
    // The code is translated where we have a sentence for it, because these are
    // not rare: dry-running all 80 built mirrors on 2026-08-11 produced 57
    // "before_image_capture_source_unrecorded", 7 "no_before_after_visuals" and
    // 5 "contact_confidence_review_hold". An unknown code passes through raw —
    // a raw truth beats a wrong translation.
    var REFUSALS=${JSON.stringify(PLAIN_REFUSAL)};
    function refusalReason(error,payload){
      var body=(payload&&typeof payload==="object"?payload:null)
        ||(error&&error.payload&&typeof error.payload==="object"?error.payload:null)
        ||{};
      var send=body.send&&typeof body.send==="object"?body.send:{};
      var code=text(send.blocked,"")||text(send.reason,"")||text(body.error,"");
      return REFUSALS[code]
        ||text(send.message,"")||code||text(body.message,"")
        ||text(error&&error.message,"")
        ||"the server gave no reason";
    }

    function notSent(error,payload,check){
      return (check?"Would not send — ":"Not sent — ")+refusalReason(error,payload);
    }

    function sentLabel(item){
      var when=shortWhen(item&&item.lastSentAt);
      if(!when)return "";
      return (item.lastSentKind==="business"?"Emailed the business":"Proof emailed to you")+" · "+when;
    }

    function menuItem(action,handler,href){
      var templateIds={"open-site":"openSiteTemplate","open-report":"openReportTemplate","copy-site":"copySiteTemplate","copy-id":"copyIdTemplate","details":"detailsTemplate","send-proof":"sendProofTemplate","resend-proof":"resendProofTemplate"};
      var template=document.getElementById(templateIds[action]);
      var node=template.content.firstElementChild.cloneNode(true);
      if(href){
        node.href=href;
        node.target="_blank";
        node.rel="noopener noreferrer";
      }else{
        node.addEventListener("click",handler);
      }
      node.addEventListener("click",function(){closeMenus();});
      return node;
    }

    function makeMenu(item){
      // AN ACTION THAT IS OFFERED MUST WORK. A measured-offline host loses
      // "Open live site" outright rather than keeping a link that opens a 404 —
      // 93 of the archived cards were doing exactly that. "Copy site link"
      // stays, because the URL is still the operator's evidence of which host
      // died; it just is not presented as somewhere to go.
      var liveUrl=isOffline(item)?"":safeHttpUrl(item.previewUrl);
      var reportUrl=safeHttpUrl(item.reportUrl);
      var wrap=document.createElement("div");
      wrap.className="menu";
      var button=document.getElementById("menuButtonTemplate").content.firstElementChild.cloneNode(true);
      button.setAttribute("aria-label","Actions for "+text(item.businessName,"site"));
      button.setAttribute("aria-haspopup","menu");
      button.setAttribute("aria-expanded","false");
      var panel=document.getElementById("menuPanelTemplate").content.firstElementChild.cloneNode(true);
      panel.setAttribute("role","menu");
      panel.id="siteMenu"+(++menuSequence);
      button.setAttribute("aria-controls",panel.id);
      // The send sits FIRST. The owner opened this menu looking for it and it
      // was not here; burying it under four read-only actions would repeat the
      // same mistake more politely.
      if(canSendItem(item)){
        if(text(item.lastSentAt,""))panel.appendChild(menuItem("resend-proof",function(){askThenSend([item]);}));
        else panel.appendChild(menuItem("send-proof",function(){askThenSend([item]);}));
      }
      if(text(item.prospectId,""))panel.appendChild(menuItem("details",function(){openDrawer(item);}));
      if(liveUrl)panel.appendChild(menuItem("open-site",null,liveUrl));
      if(reportUrl)panel.appendChild(menuItem("open-report",null,reportUrl));
      if(liveUrl)panel.appendChild(menuItem("copy-site",function(){copyText(liveUrl,"Site link");}));
      if(text(item.prospectId,""))panel.appendChild(menuItem("copy-id",function(){copyText(String(item.prospectId),"Prospect ID");}));
      button.addEventListener("click",function(event){
        event.stopPropagation();
        var open=button.getAttribute("aria-expanded")==="true";
        closeMenus(button);
        button.setAttribute("aria-expanded",String(!open));
        panel.hidden=open;
        if(!open){var first=panel.querySelector(".menu-item");if(first)first.focus();}
      });
      panel.addEventListener("click",function(event){
        event.stopPropagation();
        if(event.target.closest&&event.target.closest(".menu-item"))window.setTimeout(function(){button.focus();},0);
      });
      panel.addEventListener("keydown",function(event){
        if(event.key==="Escape"){
          event.preventDefault();
          panel.hidden=true;
          button.setAttribute("aria-expanded","false");
          button.focus();
          return;
        }
        if(event.key!=="ArrowDown"&&event.key!=="ArrowUp"&&event.key!=="Home"&&event.key!=="End")return;
        var items=Array.prototype.slice.call(panel.querySelectorAll(".menu-item"));
        if(!items.length)return;
        var current=items.indexOf(document.activeElement);
        var next=event.key==="Home"?0:(event.key==="End"?items.length-1:(event.key==="ArrowDown"?(current+1+items.length)%items.length:(current-1+items.length)%items.length));
        event.preventDefault();
        items[next].focus();
      });
      wrap.appendChild(button);
      wrap.appendChild(panel);
      return wrap;
    }

    // The empty tile SAYS WHICH NOTHING IT IS. "Preview unavailable" was one
    // caption doing three jobs — never photographed, host is gone, image failed
    // to load — and the operator could not tell a queue backlog from a dead
    // mirror. It renders our own mark and our own words only: whatever else is
    // true, a card must never fill its frame with another business's picture.
    function previewFallback(label){
      var fallback=document.createElement("div");
      fallback.className="preview-empty";
      fallback.setAttribute("role","img");
      fallback.setAttribute("aria-label",label||"Preview unavailable");
      var inner=document.createElement("div");
      inner.className="preview-empty-inner";
      var namespace="http://www.w3.org/2000/svg";
      var mark=document.createElementNS(namespace,"svg");
      mark.setAttribute("viewBox","8 14 48 34");
      mark.setAttribute("fill","none");
      mark.setAttribute("aria-hidden","true");
      var gradientId="galleryPreviewSignal"+(++previewMarkSequence);
      var defs=document.createElementNS(namespace,"defs");
      var gradient=document.createElementNS(namespace,"linearGradient");
      gradient.setAttribute("id",gradientId);
      gradient.setAttribute("x1","12");
      gradient.setAttribute("y1","42");
      gradient.setAttribute("x2","50");
      gradient.setAttribute("y2","20");
      gradient.setAttribute("gradientUnits","userSpaceOnUse");
      var start=document.createElementNS(namespace,"stop");
      start.setAttribute("stop-color","#4A6CF7");
      var end=document.createElementNS(namespace,"stop");
      end.setAttribute("offset","1");
      end.setAttribute("stop-color","#8B5CF6");
      gradient.appendChild(start);
      gradient.appendChild(end);
      defs.appendChild(gradient);
      mark.appendChild(defs);
      var glow=document.createElementNS(namespace,"circle");
      glow.setAttribute("cx","50");
      glow.setAttribute("cy","20");
      glow.setAttribute("r","7");
      glow.setAttribute("fill","#34D399");
      glow.setAttribute("opacity",".14");
      var path=document.createElementNS(namespace,"path");
      path.setAttribute("d","M12 24 L21 42 L30 26 L39 42 L50 20");
      path.setAttribute("stroke","url(#"+gradientId+")");
      path.setAttribute("stroke-width","4.5");
      path.setAttribute("stroke-linecap","round");
      path.setAttribute("stroke-linejoin","round");
      var dot=document.createElementNS(namespace,"circle");
      dot.setAttribute("cx","50");
      dot.setAttribute("cy","20");
      dot.setAttribute("r","4");
      dot.setAttribute("fill","#34D399");
      mark.appendChild(glow);
      mark.appendChild(path);
      mark.appendChild(dot);
      var caption=document.createElement("span");
      caption.className="preview-empty-text";
      caption.textContent=label||"Preview unavailable";
      inner.appendChild(mark);
      inner.appendChild(caption);
      fallback.appendChild(inner);
      return fallback;
    }

    function relabelFallback(fallback,label){
      var caption=fallback.querySelector(".preview-empty-text");
      if(caption)caption.textContent=label;
      fallback.setAttribute("aria-label",label);
    }

    function setPreviewState(preview,image,fallback,ready){
      if(ready){
        fallback.hidden=true;
        preview.dataset.previewState="image";
        return;
      }
      fallback.hidden=false;
      preview.dataset.previewState="fallback";
    }

    // What the liveness probe measured for this card's host, or null when it
    // has not answered yet. Null is not "offline" — an unanswered probe must
    // never take an action away.
    function liveness(item){
      var url=text(item&&item.previewUrl,"");
      var hit=url?state.liveness[url]:null;
      return hit&&hit.state?hit:null;
    }

    function isOffline(item){
      var hit=liveness(item);
      return Boolean(hit&&hit.state==="offline");
    }

    function makeCard(item,index,animate){
      var article=document.createElement("article");
      article.className="site-card"+(item.archived?" archived":"");
      article.setAttribute("role","listitem");
      if(animate)article.style.animationDelay=Math.min(index,11)*24+"ms";
      else article.style.animation="none";
      if(text(item.prospectId,""))article.dataset.prospectId=text(item.prospectId,"");
      var offline=isOffline(item);
      var liveUrl=offline?"":safeHttpUrl(item.previewUrl);
      var preview=document.createElement("div");
      preview.className="preview";
      preview.dataset.previewState="fallback";
      // Three different nothings, three different sentences. A host that is
      // gone is not a screenshot backlog, and saying so is the difference
      // between "we owe this card a picture" and "this mirror no longer exists".
      var fallback=previewFallback(offline?"Site no longer live":"No preview yet — one is captured at inspection");
      var shotUrl=safeHttpUrl(item.shotUrl);
      if(shotUrl){
        var image=document.getElementById("siteShotTemplate").content.firstElementChild.cloneNode(true);
        image.alt="Homepage preview for "+text(item.businessName,"Website");
        image.loading="lazy";
        image.decoding="async";
        image.addEventListener("error",function(){
          if(!offline)relabelFallback(fallback,"Preview unavailable");
          setPreviewState(preview,image,fallback,false);
        });
        image.addEventListener("load",function(){
          var ready=image.naturalWidth>=50&&image.naturalHeight>=50;
          // A 1x1 spacer is what /api/media/preview-shot serves when nothing was
          // ever captured, and it arrives as a healthy HTTP 200. It is a
          // MISSING screenshot, not a broken one.
          if(!ready&&!offline)relabelFallback(fallback,"No preview yet — one is captured at inspection");
          setPreviewState(preview,image,fallback,ready);
        });
        image.src=shotUrl;
        preview.appendChild(image);
      }
      preview.appendChild(fallback);
      if(liveUrl){
        var previewLink=document.createElement("a");
        previewLink.className="preview-link";
        previewLink.href=liveUrl;
        previewLink.target="_blank";
        previewLink.rel="noopener noreferrer";
        previewLink.setAttribute("aria-label","Open the live site for "+text(item.businessName,"this business")+" in a new tab");
        previewLink.appendChild(preview);
        article.appendChild(previewLink);
      }else{
        article.appendChild(preview);
      }

      // The picker sits on every card that names a business. Selection used
      // to exist only for the owner-proof email batch; the bar now carries
      // Archive and Restore too, and picking must not depend on whether a
      // send would succeed.
      if(text(item.prospectId,"")){
        var picker=document.getElementById("selectBoxTemplate").content.firstElementChild.cloneNode(true);
        var box=picker.querySelector("input");
        box.checked=state.picked[item.prospectId]===true;
        box.setAttribute("aria-label","Select "+text(item.businessName,"this business"));
        if(box.checked)article.classList.add("picked");
        box.addEventListener("click",function(event){event.stopPropagation();});
        box.addEventListener("change",function(){
          setPicked(item,box.checked);
          article.classList.toggle("picked",box.checked);
        });
        article.appendChild(picker);
      }

      var body=document.createElement("div");
      body.className="card-body";
      var heading=document.createElement("div");
      heading.className="card-heading";
      var titleWrap=document.createElement("div");
      var title=document.createElement("h3");
      title.className="business-name";
      title.textContent=text(item.businessName,"Unnamed business");
      titleWrap.appendChild(title);
      // PLAIN LINE ONE OF TWO: "Plumbing · Tulsa, OK" — trade first, because
      // the trade is what the owner thinks in and filters by. The old pair of
      // separate location/vertical chips made him parse two labels; this is
      // one phrase he can read in one glance.
      var metadata=document.createElement("div");
      metadata.className="metadata";
      var place=[text(item.city,""),text(item.state,"")].filter(Boolean).join(", ");
      metadata.textContent=[text(item.vertical,"")?plainTrade(item.vertical):"",place].filter(Boolean).join(" · ")
        ||"Trade and city not set — Edit details can add them";
      titleWrap.appendChild(metadata);
      heading.appendChild(titleWrap);
      heading.appendChild(makeMenu(item));
      body.appendChild(heading);

      // PLAIN LINE TWO OF TWO: the status chip. The owner's words, a colored
      // dot, and the factory's code tucked into the tooltip where it is still
      // findable for support without being the sentence anyone has to read.
      var chip=voiceChip(item);
      var statusLine=document.createElement("div");
      statusLine.className="status-line";
      var status=document.createElement("span");
      status.className="status"+(chip.tone?" "+chip.tone:"");
      status.textContent=chip.label;
      var explainSentence=VOICE.plain[String(chip.raw||"").toLowerCase()];
      status.title=([typeof explainSentence==="string"&&explainSentence?explainSentence:"",chip.raw?"("+chip.raw+")":""].filter(Boolean).join(" "))||chip.label;
      statusLine.appendChild(status);
      if(offline){
        var hit=liveness(item);
        var dead=document.createElement("span");
        dead.className="status offline";
        dead.textContent=hit&&hit.status?"Offline · "+hit.status:"Offline";
        dead.title="This host did not answer 200 when the gallery last checked";
        statusLine.appendChild(dead);
      }
      // THE BATCH BADGE. A halted batch parks every row inside it — including
      // finished sites waiting on the send lane — and that fact belongs on the
      // card, not in a different console. Superseded gets its own word because
      // "halted" would hide the one case where a newer run replaced it.
      if(text(item.batchState,"")==="halted"){
        var halt=plainHaltReason(item.batchHaltReason);
        var haltedBadge=document.createElement("span");
        haltedBadge.className="status warn";
        haltedBadge.textContent=halt.superseded?"Superseded run":"Batch halted";
        haltedBadge.title="This site's build batch was halted"+(halt.plain?" — "+halt.plain:"")+", so nothing emails from it until it runs again. ("+text(item.campaign,"batch unknown")+")";
        statusLine.appendChild(haltedBadge);
      }
      body.appendChild(statusLine);

      // SITE BUILT, EMAIL PENDING. Tonight's known pain, said out loud: a
      // gate_passed row stuck behind its release write or a halted batch reads
      // "Site built, email pending — <reason>", never as a silent finish.
      var pending=pendingSentence(item);
      if(pending){
        var pendingLine=document.createElement("p");
        pendingLine.className="card-pending";
        pendingLine.textContent=pending;
        body.appendChild(pendingLine);
      }

      // The last send, if there was one. It sits ABOVE the foot on purpose:
      // .card-foot keeps margin-top:auto, so every card in a row still shares
      // one baseline whether or not it has ever been emailed.
      var sent=document.createElement("p");
      sent.className="card-sent";
      paintSentLine(sent,item);
      if(text(item.prospectId,""))sentLines[item.prospectId]=sent;
      body.appendChild(sent);

      // THE FOOT IS THE CONTROL STRIP: the four things the owner actually
      // does to a website, as labeled buttons on the card face. Active cards
      // offer Archive; archived cards offer Restore and — the only permanent
      // act on this page — Delete forever, typed confirmation and all.
      var foot=document.createElement("div");
      foot.className="card-foot";
      var hasId=text(item.prospectId,"");
      var nameFor=text(item.businessName,"this business");
      if(liveUrl){
        var openSite=document.createElement("a");
        openSite.className="card-action primary";
        openSite.href=liveUrl;
        openSite.target="_blank";
        openSite.rel="noopener noreferrer";
        openSite.textContent="Open website";
        openSite.setAttribute("aria-label","Open the website for "+nameFor+" in a new tab");
        foot.appendChild(openSite);
      }
      if(hasId){
        var editButton=document.createElement("button");
        editButton.type="button";
        editButton.className="card-action";
        editButton.textContent="Edit details";
        editButton.setAttribute("aria-label","Edit the name, trade, city, or your private notes for "+nameFor);
        editButton.addEventListener("click",function(event){
          event.preventDefault();
          event.stopPropagation();
          openEditor(article,item);
        });
        foot.appendChild(editButton);

        var rebuildButton=document.createElement("button");
        rebuildButton.type="button";
        rebuildButton.className="card-action";
        rebuildButton.textContent="Rebuild";
        rebuildButton.title="Build this website again from scratch. No email is sent.";
        rebuildButton.addEventListener("click",function(event){
          event.preventDefault();
          event.stopPropagation();
          askRebuild(item);
        });
        foot.appendChild(rebuildButton);

        if(item.archived){
          var restoreButton=document.createElement("button");
          restoreButton.type="button";
          restoreButton.className="card-action";
          restoreButton.textContent="Restore";
          restoreButton.title="Put this website back in the active gallery. Nothing is rebuilt and no email is sent.";
          restoreButton.addEventListener("click",function(event){
            event.preventDefault();
            event.stopPropagation();
            manageOne("restore",item);
          });
          foot.appendChild(restoreButton);

          var deleteButton=document.createElement("button");
          deleteButton.type="button";
          deleteButton.className="card-action danger";
          deleteButton.textContent="Delete forever";
          deleteButton.title="Permanently remove this record. You will be asked to type the business name first.";
          deleteButton.addEventListener("click",function(event){
            event.preventDefault();
            event.stopPropagation();
            askDeleteForever(item);
          });
          foot.appendChild(deleteButton);
        }else{
          var archiveButton=document.createElement("button");
          archiveButton.type="button";
          archiveButton.className="card-action";
          archiveButton.textContent="Archive";
          archiveButton.title="Move this website out of the active gallery. Reversible any time; nothing is deleted and no email is sent.";
          archiveButton.addEventListener("click",function(event){
            event.preventDefault();
            event.stopPropagation();
            manageOne("archive",item);
          });
          foot.appendChild(archiveButton);
        }
      }
      body.appendChild(foot);
      // The last send, if there was one. Absent means exactly that — nothing
      // has been emailed about this business — because the snapshot reads both
      // send channels and reports which of them it managed to read.
      article.appendChild(body);
      return article;
    }

    function paintSentLine(node,item){
      var label=sentLabel(item);
      node.hidden=!label;
      node.textContent=label;
    }

    // After a send lands, the card it came from must stop saying nothing. The
    // row object is the same object the renderer reads, so the change also
    // survives the next re-render instead of being undone by it; the node map
    // is only how the line already on screen catches up without a repaint.
    function markSent(item,when){
      item.lastSentAt=text(when,"")||new Date().toISOString();
      item.lastSentKind="proof";
      var line=sentLines[item.prospectId];
      if(line&&document.contains(line))paintSentLine(line,item);
    }

    // ---------------------------------------------------------------------
    // THE OWNER'S REAL POWERS: EDIT, ARCHIVE, RESTORE, REBUILD, DELETE.
    //
    // Every write goes through /api/admin/gallery-manage except the rebuild,
    // which uses the dedicated no-send /api/admin/rebuild-mirror queue. The
    // console's build-preview door is intentionally consent-gated because it
    // can create an owner proof flow; using it here made a no-send rebuild
    // refuse before the mirror lane even started. The delete is the
    // one permanent act on this page, so it is behind archived-only AND a
    // typed-name confirmation, and the button for it simply does not exist on
    // an active card.
    // ---------------------------------------------------------------------

    // The same business can be normalized into both tabs' arrays as two
    // objects. A change the server confirms has to land on every copy, or the
    // other tab would go on showing the stale truth.
    function eachCopy(prospectId,fn){
      state.builds.concat(state.clients).forEach(function(item){
        if(item&&text(item.prospectId,"")===prospectId)fn(item);
      });
    }

    function applyResultStatus(prospectId,result){
      eachCopy(prospectId,function(item){
        item.archived=result==="archived_legacy";
        if(result)item.status=result;
      });
    }

    function manageOne(action,item){
      var id=text(item&&item.prospectId,"");
      var name=text(item&&item.businessName,"this website");
      if(!id)return;
      notify(action==="archive"?"Archiving "+name+"…":"Restoring "+name+"…");
      api("/api/admin/gallery-manage",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:action,prospectIds:[id]})
      }).then(function(payload){
        var result=payload&&Array.isArray(payload.results)?payload.results[0]:null;
        if(payload&&payload.ok&&result&&result.ok){
          applyResultStatus(id,result.status||"");
          delete state.picked[id];
          updateView();
          notify(result.changed
            ?(action==="archive"
              ?"Archived "+name+" — find it under Show archived."
              :"Restored "+name+" to the active gallery.")
            :result.reason==="already_archived"||result.reason==="already_active"
              ?name+" was already "+(action==="archive"?"archived":"active")+"."
              :"Nothing needed to change for "+name+".");
        }else{
          notify("Could not "+action+" "+name+" — "+text(result&&result.reason,payload&&payload.error||"the server said no"),true);
        }
      }).catch(function(error){
        notify("Could not "+action+" "+name+" — "+text(error&&error.message,"the server could not be reached"),true);
      });
    }

    function runBatchManage(action,rows){
      var ids=rows.map(function(item){return text(item.prospectId,"");}).filter(Boolean);
      if(!ids.length)return;
      notify((action==="archive"?"Archiving ":"Restoring ")+ids.length.toLocaleString()+"…");
      api("/api/admin/gallery-manage",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:action,prospectIds:ids})
      }).then(function(payload){
        (payload&&Array.isArray(payload.results)?payload.results:[]).forEach(function(result){
          if(result&&result.ok)applyResultStatus(result.prospectId,result.status||"");
        });
        clearPicks();
        updateView();
        var changed=Number(payload&&payload.changed||0);
        var failed=Number(payload&&payload.failed||0);
        notify((action==="archive"?"Archived ":"Restored ")+changed.toLocaleString()
          +(changed===1?" website":" websites")
          +(failed?" · "+failed.toLocaleString()+" could not be changed":".")
          ,failed>0);
      }).catch(function(error){
        notify("Could not "+action+" — "+text(error&&error.message,"the server could not be reached"),true);
      });
    }

    // ---------------------------------------------------------------------
    // THE ASK: one small dialog for rebuild and delete-forever.
    // ---------------------------------------------------------------------

    function closeAsk(){
      if(askBusy)return;
      askDialog.hidden=true;
      askScrim.hidden=true;
      askInput.value="";
      askInput.hidden=true;
      askSummary.textContent="";
      askSummary.hidden=true;
      askGo.classList.remove("danger");
      document.body.style.overflow="";
      askSubmit=null;
      if(askReturnFocus&&document.contains(askReturnFocus)){
        try{askReturnFocus.focus();}catch(_){}
      }
      askReturnFocus=null;
    }

    // config: {title, why, confirmLabel, danger, typedName (require typing this
    // exact business name), busyLabel, run: function(done) — call done(ok)}. The
    // typed confirmation compares collapsed-case names the same way the server
    // does, but the server checks again: nothing here is trusted.
    function openAsk(config){
      askReturnFocus=document.activeElement;
      askSubmit=config.run;
      askTitle.textContent=config.title;
      askWhy.textContent=config.why||"";
      askGo.textContent=config.confirmLabel||"Confirm";
      askGo.classList.toggle("danger",config.danger===true);
      askInput.hidden=!config.typedName;
      askInput.value="";
      if(config.typedName){
        askInput.placeholder="Type \u201c"+config.typedName+"\u201d to confirm";
        askInput.setAttribute("aria-label","Type the business name "+config.typedName+" to confirm");
      }
      askSummary.textContent="";
      askSummary.hidden=true;
      askGo.disabled=true;
      askGo.onclick=function(){
        if(askGo.disabled)return;
        askBusy=true;
        askGo.disabled=true;
        askCancel.disabled=true;
        askGo.textContent=config.busyLabel||"Working…";
        askSubmit(function(ok){
          askBusy=false;
          askCancel.disabled=false;
          if(ok===false){
            askGo.textContent=config.confirmLabel||"Confirm";
            askGo.disabled=Boolean(config.typedName);
            return;
          }
          askDialog.hidden=true;
          askScrim.hidden=true;
          askInput.hidden=true;
          askInput.value="";
          askGo.classList.remove("danger");
          document.body.style.overflow="";
          askSubmit=null;
          if(askReturnFocus&&document.contains(askReturnFocus)){
            try{askReturnFocus.focus();}catch(_){}
          }
          askReturnFocus=null;
        });
      };
      // With a typed confirmation the destructive button stays inert until
      // the name matches; without one it is armed immediately.
      if(config.typedName){
        var check=function(){
          var typed=askInput.value.trim().toLowerCase().replace(/\s+/g," ");
          var wanted=String(config.typedName).trim().toLowerCase().replace(/\s+/g," ");
          askGo.disabled=typed!==wanted||askBusy;
        };
        askInput.oninput=check;
        check();
      }else{
        askGo.disabled=false;
      }
      askScrim.hidden=false;
      askDialog.hidden=false;
      document.body.style.overflow="hidden";
      window.setTimeout(function(){(config.typedName?askInput:askGo).focus();},0);
    }

    function askRebuild(item){
      var id=text(item&&item.prospectId,"");
      if(!id)return;
      var name=text(item&&item.businessName,"this website");
      openAsk({
        title:"Rebuild "+name+"?",
        why:"This sends the website back through the real build queue, from scratch. No email is sent, and nothing on this card changes until the build finishes.",
        confirmLabel:"Start the rebuild",
        busyLabel:"Starting…",
        run:function(done){
          api("/api/admin/rebuild-mirror",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({prospect_id:id,mode:"queue"})
          }).then(function(payload){
            if(payload&&payload.ok===true){
              notify("Rebuild started for "+name+". The card updates when the build finishes.");
              done(true);
            }else{
              askSummary.textContent="The rebuild could not be started — "+text(payload&&payload.error,"the server said no")+".";
              askSummary.hidden=false;
              done(false);
            }
          }).catch(function(error){
            askSummary.textContent="The rebuild could not be started — "+text(error&&error.message,"the server could not be reached")+".";
            askSummary.hidden=false;
            done(false);
          });
        }
      });
    }

    // DELETE FOREVER. Reached only from an archived card, asked again here,
    // checked a third time by the server (archived + exact name), and the
    // DELETE itself filters on archived at the database. The endpoint returns
    // no undo path — a hard delete is gone — so the confirmation says exactly
    // that rather than offering a take-back that does not exist.
    function askDeleteForever(item){
      var id=text(item&&item.prospectId,"");
      if(!id)return;
      var name=text(item&&item.businessName,"this website");
      openAsk({
        title:"Delete "+name+" forever?",
        why:"This retires "+name+" permanently. Its public legacy site, hostname, and generated source are removed before the record is marked retired. If any outside cleanup fails, the record stays tombstoned and blocked from rebuilding. Type the business name to confirm.",
        confirmLabel:"Retire forever",
        busyLabel:"Retiring…",
        danger:true,
        typedName:name,
        run:function(done){
          api("/api/admin/gallery-manage",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"delete",prospectId:id,confirm:name})
          }).then(function(payload){
            if(payload&&payload.ok&&(payload.deleted||payload.teardownPending)){
              state.builds=state.builds.filter(function(row){return text(row.prospectId,"")!==id;});
              state.clients=state.clients.filter(function(row){return text(row.prospectId,"")!==id;});
              delete state.picked[id];
              updateTabs();
              updateView();
              notify(payload.deleted?name+" retired forever.":name+" removed from inventory; external teardown is pending.");
              done(true);
            }else{
              var code=text(payload&&payload.error,"");
              askSummary.textContent=code==="not_archived"
                ?"This website is not archived any more, so it cannot be deleted. Refresh and try again if you still want to."
                :code==="confirm_name_mismatch"
                  ?"That does not match the business name. Type it exactly as the card shows it."
                  :"It could not be deleted — "+text(payload&&payload.message,payload&&payload.error||"the server said no")+". Nothing was removed.";
              askSummary.hidden=false;
              done(false);
            }
          }).catch(function(error){
            askSummary.textContent="It could not be deleted — "+text(error&&error.message,"the server could not be reached")+". Nothing was removed.";
            askSummary.hidden=false;
            done(false);
          });
        }
      });
    }

    // ---------------------------------------------------------------------
    // THE INLINE EDITOR.
    //
    // "Edit details" turns the card itself into the form. Five fields, no
    // others: the name, the city, the state, the trade, and the owner's own
    // private notes. The server writes only what it is given and hands back
    // the record it saved; the card re-renders from THAT, not from what was
    // typed. On failure the form keeps the operator's words — they are the
    // one thing here we cannot regenerate.
    // ---------------------------------------------------------------------

    function editField(label,inputId,value,maxlength,wide){
      var field=document.createElement("div");
      field.className="edit-field"+(wide?" wide":"");
      var labelNode=document.createElement("label");
      labelNode.setAttribute("for",inputId);
      labelNode.textContent=label;
      var input=document.createElement(maxlength>=2000?"textarea":"input");
      if(input.tagName==="TEXTAREA"){
        input.rows=3;
      }else{
        input.type="text";
      }
      input.id=inputId;
      input.maxLength=maxlength;
      input.value=value==null?"":value;
      field.appendChild(labelNode);
      field.appendChild(input);
      return {field:field,input:input};
    }

    function openEditor(article,item){
      closeMenus();
      var id=text(item.prospectId,"");
      if(!id)return;
      var body=article.querySelector(".card-body");
      if(!body)return;

      var form=document.createElement("form");
      form.className="edit-form";
      form.setAttribute("aria-label","Edit details for "+text(item.businessName,"this business"));
      var nameField=editField("Business name","editName"+id,item.businessName,120,false);
      var tradeField=editField("Trade","editTrade"+id,item.vertical,120,false);
      var cityField=editField("City","editCity"+id,item.city,120,false);
      var stateField=editField("State","editState"+id,item.state,120,false);
      var notesField=editField("Your private notes","editNotes"+id,item.notes||"",2000,false);
      notesField.input.rows=3;
      var fields=document.createElement("div");
      fields.className="edit-fields";
      fields.appendChild(nameField.field);
      fields.appendChild(tradeField.field);
      fields.appendChild(cityField.field);
      fields.appendChild(stateField.field);
      fields.appendChild(notesField.field);
      form.appendChild(fields);

      var hint=document.createElement("p");
      hint.className="edit-hint";
      hint.textContent="Only you see these notes. Saving sends nothing to the business — no email ever leaves your own inbox from this page.";
      form.appendChild(hint);

      var foot=document.createElement("div");
      foot.className="edit-foot";
      var save=document.createElement("button");
      save.type="submit";
      save.className="card-action primary";
      save.textContent="Save changes";
      var cancel=document.createElement("button");
      cancel.type="button";
      cancel.className="card-action";
      cancel.textContent="Cancel";
      var status=document.createElement("span");
      status.className="edit-hint";
      status.id="editStatus"+id;
      foot.appendChild(save);
      foot.appendChild(cancel);
      foot.appendChild(status);
      form.appendChild(foot);

      cancel.addEventListener("click",function(event){
        event.preventDefault();
        updateView();
      });

      form.addEventListener("submit",function(event){
        event.preventDefault();
        save.disabled=true;
        status.textContent="Saving…";
        // The five fields the server accepts, and nothing invented. Notes are
        // omitted until the owner has them in hand (typed now, or returned by
        // a past save): an omitted field is preserved server-side, so an
        // untouched box can never wipe notes saved before this screen could
        // show them.
        var payload={action:"notes",prospectId:id};
        payload.business_name=text(nameField.input.value,"");
        payload.industry=text(tradeField.input.value,"");
        payload.city=text(cityField.input.value,"");
        payload.state=text(stateField.input.value,"");
        if(text(notesField.input.value,"")||item.notesKnown===true)payload.notes=notesField.input.value.trim();
        api("/api/admin/gallery-manage",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload)
        }).then(function(result){
          if(result&&result.ok&&result.site){
            eachCopy(id,function(copy){
              copy.businessName=text(result.site.businessName,copy.businessName);
              copy.city=text(result.site.city,copy.city);
              copy.state=text(result.site.state,copy.state);
              copy.vertical=text(result.site.vertical,copy.vertical);
              copy.notes=text(result.site.notes,"");
              copy.notesKnown=true;
            });
            updateView();
            notify("Saved your changes for "+text(result.site.businessName,"this business")+".");
          }else{
            save.disabled=false;
            status.textContent=text(result&&result.message,result&&result.error||"It could not be saved. Your changes are still in the form.");
          }
        }).catch(function(error){
          save.disabled=false;
          status.textContent=text(error&&error.message,"It could not be saved just now. Your changes are still in the form.");
        });
      });

      body.replaceChildren(form);
      var firstInput=form.querySelector("input,textarea");
      if(firstInput)firstInput.focus();
    }

    // ---------------------------------------------------------------------
    // SELECTION AND THE BATCH
    //
    // The bar does not exist until something is picked, and every word on it
    // and in the confirmation names the destination. The batch is not a
    // different kind of send: it is the same single-prospect route, run once
    // per business, so every gate that guards one send guards all of them and
    // one refusal cannot take the rest of the run down with it.
    // ---------------------------------------------------------------------

    function pickedIds(){
      return Object.keys(state.picked).filter(function(id){return state.picked[id]===true;});
    }

    function rowsById(ids){
      var wanted={};
      ids.forEach(function(id){wanted[id]=true;});
      var seen={};
      var out=[];
      // Search both tabs' rows: a card can be picked on All builds and still be
      // the same business the Clients tab is showing.
      state.builds.concat(state.clients).forEach(function(item){
        var id=text(item&&item.prospectId,"");
        if(!id||!wanted[id]||seen[id])return;
        seen[id]=true;
        out.push(item);
      });
      return out;
    }

    function setPicked(item,on){
      var id=text(item&&item.prospectId,"");
      if(!id)return;
      if(on)state.picked[id]=true;
      else delete state.picked[id];
      refreshBatchBar();
    }

    // Bring every checkbox on screen back into line with state.picked. Used
    // wherever the selection changes for a card the operator did not click:
    // pick-all, and the post-run unpick of everything that sent.
    function syncPickedBoxes(){
      galleryGrid.querySelectorAll(".site-card").forEach(function(card){
        var id=card.dataset.prospectId||"";
        var box=card.querySelector(".select-box input");
        if(!box||!id)return;
        box.checked=state.picked[id]===true;
        card.classList.toggle("picked",box.checked);
      });
    }

    function clearPicks(){
      state.picked={};
      syncPickedBoxes();
      refreshBatchBar();
    }

    function refreshBatchBar(){
      var count=pickedIds().length;
      batchBar.hidden=count===0;
      document.body.classList.toggle("batching",count>0);
      if(!count)return;
      var rows=rowsById(pickedIds());
      var activeCount=rows.filter(function(item){return !item.archived;}).length;
      var archivedCount=rows.filter(function(item){return item.archived;}).length;
      var sendableCount=rows.filter(canSendItem).length;
      batchCount.textContent=count===1?"1 selected":count.toLocaleString()+" selected";
      batchNote.textContent=state.routing.recipient
        ? (count===1
          ? "A proof email comes to "+state.routing.recipient+" — the business is not emailed."
          : "Proof emails come to "+state.routing.recipient+" — no business is emailed.")
        : "No owner inbox is configured, so nothing can be sent; archive and restore still work.";
      if(sendableCount&&sendableCount<count)batchNote.textContent+=" Only "+sendableCount.toLocaleString()+" of these can be emailed right now.";
      batchSend.disabled=!state.routing.canSend||!sendableCount;
      batchSend.textContent="Email proofs to me";
      batchArchive.disabled=!activeCount;
      batchArchive.textContent=activeCount?"Archive ("+activeCount.toLocaleString()+")":"Archive";
      batchRestore.disabled=!archivedCount;
      batchRestore.textContent=archivedCount?"Restore ("+archivedCount.toLocaleString()+")":"Restore";
      var showing=activeRows().slice(0,state.visibleLimit).filter(function(item){return text(item.prospectId,"");});
      var unpicked=showing.filter(function(item){return state.picked[item.prospectId]!==true;}).length;
      batchSelectAll.hidden=unpicked===0;
      batchSelectAll.textContent="Pick all "+showing.length.toLocaleString();
    }

    // ---------------------------------------------------------------------
    // THE CONFIRMATION, then the same panel as the progress report.
    // ---------------------------------------------------------------------

    // An empty summary must take no space. On a phone it wraps to its own row
    // under the buttons, so leaving it present-but-blank opened a band of dead
    // space under every confirmation that had not run yet.
    function setSummary(value){
      var line=text(value,"");
      confirmSummary.textContent=line;
      confirmSummary.hidden=!line;
    }

    function closeConfirm(){
      if(sendInFlight)return;
      confirmDialog.hidden=true;
      confirmScrim.hidden=true;
      confirmList.replaceChildren();
      setSummary("");
      document.body.style.overflow="";
      if(confirmReturnFocus&&document.contains(confirmReturnFocus)){
        try{confirmReturnFocus.focus();}catch(_){}
      }
      confirmReturnFocus=null;
    }

    function confirmRow(item){
      var row=element("div","confirm-row");
      row.appendChild(element("span","confirm-row-name",text(item.businessName,"Unnamed business")));
      var status=element("span","confirm-row-state","Waiting");
      row.appendChild(status);
      var why=element("p","confirm-row-why","");
      why.hidden=true;
      row.appendChild(why);
      return {node:row,status:status,why:why};
    }

    /**
     * Ask first, in plain words, then run. The items are already filtered to
     * cards the send route accepts, so the only thing left to decide is
     * whether the operator wants it — and the two facts he needs for that are
     * the count and the address.
     */
    function askThenSend(items){
      closeMenus();
      var list=(items||[]).filter(canSendItem);
      if(!list.length){
        // A selection can now contain cards picked for archiving rather than
        // emailing. Saying nothing here would look like a broken button.
        if((items||[]).length)notify("None of these can be emailed yet — nothing was sent.",true);
        return;
      }
      if(list.length>MAX_BATCH)list=list.slice(0,MAX_BATCH);
      confirmReturnFocus=document.activeElement;
      sendInFlight=false;

      var many=list.length>1;
      confirmTitle.textContent=many
        ?"Email "+list.length.toLocaleString()+" proofs to yourself"
        :"Email this proof to yourself";
      confirmTo.textContent=state.routing.recipient
        ? state.routing.recipient+" — your own inbox"
        : "No owner inbox is configured.";
      confirmWhy.textContent=many
        ? "One message per business, "+list.length.toLocaleString()+" in all. None of these "+list.length.toLocaleString()+" businesses is emailed — every message is addressed to you."
        : text(list[0].businessName,"This business")+" is not emailed. The message carries their own before-and-after, addressed to you.";
      confirmList.replaceChildren();
      var rows=list.map(function(item){
        var row=confirmRow(item);
        confirmList.appendChild(row.node);
        return row;
      });
      setSummary("");
      confirmCancel.textContent="Cancel";
      confirmCancel.disabled=false;
      confirmGo.hidden=false;
      confirmGo.disabled=!state.routing.canSend;
      confirmGo.textContent=many?"Send "+list.length.toLocaleString()+" to me":"Send it to me";
      confirmGo.onclick=function(){runSend(list,rows,false);};
      // A DRESS REHEARSAL, BECAUSE MOST OF THESE WILL NOT GO.
      //
      // Dry-running all 80 built mirrors on 2026-08-11 produced 11 that would
      // send and 69 that would not — 57 of them because the "before" picture
      // has no recorded capture source and cannot be proved to be their site.
      // Pressing send on a selection of eighty is therefore mostly a way to
      // generate sixty-nine refusals. The same run, with dryRun:true, composes
      // every email and delivers none, so it answers "which of these would
      // actually go?" without putting anything in an inbox.
      confirmCheck.hidden=false;
      confirmCheck.disabled=!state.routing.canSend;
      confirmCheck.textContent=many?"Check these first":"Check it first";
      confirmCheck.onclick=function(){runSend(list,rows,true);};

      confirmScrim.hidden=false;
      confirmDialog.hidden=false;
      document.body.style.overflow="hidden";
      window.setTimeout(function(){confirmGo.focus();},0);
    }

    /**
     * One request per business, in order, through the route that already
     * carries every gate. A refusal is written next to the business it belongs
     * to and the run continues: 11 sent and 1 refused is a useful outcome, and
     * an aborted run that hides which 11 landed is not.
     *
     * A truthy check argument runs the identical loop with dryRun:true, so the server composes
     * each email and delivers none, so the same gates answer in the same words
     * and nothing reaches an inbox — a rehearsal, not a simulation of one.
     */
    function runSend(list,rows,check){
      sendInFlight=true;
      confirmGo.disabled=true;
      confirmCheck.disabled=true;
      confirmCancel.disabled=true;
      if(check)confirmCheck.textContent="Checking…";
      else confirmGo.textContent="Sending…";
      var sent=0;
      var failed=0;
      var wordDone=check?" would go":" sent";
      var wordEach=check?"Would go":"Sent";
      var wordFail=check?"Would refuse":"Refused";

      function report(){
        setSummary(sent.toLocaleString()+wordDone+(failed?" · "+failed.toLocaleString()+" refused":"")
          +" · "+(list.length-sent-failed).toLocaleString()+" to go");
      }
      report();

      function step(index){
        if(index>=list.length){
          sendInFlight=false;
          confirmCancel.disabled=false;
          if(check){
            // Nothing was sent, so the panel goes back to being a decision:
            // the counts are now measured rather than hoped for, and Send is
            // still there to press.
            confirmGo.disabled=!state.routing.canSend;
            confirmGo.textContent=list.length>1?"Send "+list.length.toLocaleString()+" to me":"Send it to me";
            confirmCheck.hidden=true;
            setSummary(sent.toLocaleString()+" of "+list.length.toLocaleString()+" would go to "
              +text(state.routing.recipient,"your inbox")
              +(failed?" · "+failed.toLocaleString()+" would be refused. Nothing was sent.":". Nothing was sent."));
            confirmGo.focus();
            return;
          }
          confirmGo.hidden=true;
          confirmCheck.hidden=true;
          confirmCancel.textContent="Close";
          setSummary(failed
            ? sent.toLocaleString()+" sent to "+text(state.routing.recipient,"your inbox")+" · "+failed.toLocaleString()+" refused"
            : sent.toLocaleString()+(sent===1?" email is":" emails are")+" on the way to "+text(state.routing.recipient,"your inbox")+".");
          confirmCancel.focus();
          if(sent)notify(sent.toLocaleString()+(sent===1?" proof sent to you":" proofs sent to you"));
          // What went is unpicked; what was refused stays picked. Closing the
          // panel therefore leaves the selection holding exactly the ones that
          // still need something done about them, and a second press cannot
          // quietly re-send the ones that already landed.
          list.forEach(function(item,position){
            if(rows[position].status.textContent==="Sent")setPicked(item,false);
          });
          syncPickedBoxes();
          return;
        }
        var item=list[index];
        var row=rows[index];
        row.status.className="confirm-row-state";
        row.status.textContent=check?"Checking":"Sending";
        row.why.hidden=true;
        row.why.textContent="";
        api("/api/admin/send-mirror-proof",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({prospectId:item.prospectId,dryRun:check===true})
        }).then(function(payload){
          var result=payload&&payload.send;
          if(payload&&payload.ok&&result&&result.ok!==false){
            sent+=1;
            row.status.className="confirm-row-state ok";
            row.status.textContent=wordEach;
            if(!check)markSent(item,"");
          }else{
            failed+=1;
            row.status.className="confirm-row-state bad";
            row.status.textContent=wordFail;
            row.why.hidden=false;
            row.why.textContent=notSent(null,payload,check);
          }
        }).catch(function(error){
          failed+=1;
          row.status.className="confirm-row-state bad";
          row.status.textContent=wordFail;
          row.why.hidden=false;
          row.why.textContent=notSent(error,null,check);
        }).finally(function(){
          report();
          step(index+1);
        });
      }
      step(0);
    }

    // ---------------------------------------------------------------------
    // THE DETAIL DRAWER
    //
    // The miner has been writing contact details, a rating, a reason it picked
    // each business, and a list of what is wrong with their current site — for
    // every lead, for months — and the gallery showed a name, a city and a
    // status chip. This is where that work becomes visible.
    //
    // Everything below is built with DOM calls and textContent, never innerHTML
    // with data in it, so a business name carrying a stray angle bracket is
    // text and nothing else. Nothing is rendered that the server did not
    // measure: an empty field prints WHY it is empty instead of a blank line.
    // ---------------------------------------------------------------------

    function element(tag,className,content){
      var node=document.createElement(tag);
      if(className)node.className=className;
      if(content!=null)node.textContent=content;
      return node;
    }

    function whenText(value){
      return formatWhen(value,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
    }

    function block(title){
      var section=element("section","block");
      section.appendChild(element("h3",null,title));
      return section;
    }

    // One labelled line. When there is no value the line still appears, saying
    // in plain words why — "not empty because of a bug, empty because nobody
    // ever captured it" is information the operator needs.
    function detailRow(label,value,options){
      options=options||{};
      var row=document.createElement("div");
      row.className="row";
      row.appendChild(element("dt",null,label));
      var value_=text(value,"");
      var dd=document.createElement("dd");
      if(!value_){
        dd.className="missing";
        dd.textContent=options.missing||"Not on file";
      }else if(options.href){
        var link=document.createElement("a");
        link.href=options.href;
        link.textContent=value_;
        if(/^https?:/i.test(options.href)){link.target="_blank";link.rel="noopener noreferrer";}
        dd.appendChild(link);
      }else{
        dd.textContent=value_;
      }
      row.appendChild(dd);
      return row;
    }

    function bulletList(values,warn){
      var ul=element("ul","bullets"+(warn?" warn":""));
      values.forEach(function(value){ul.appendChild(element("li",null,text(value,"")));});
      return ul;
    }

    function gradeTone(grade){
      var letter=text(grade,"").charAt(0).toUpperCase();
      if(letter==="A")return "good";
      if(letter==="B")return "good";
      if(letter==="C")return "mid";
      if(letter==="D"||letter==="F")return "low";
      return "";
    }

    function pill(label,tone){
      return element("span","pill"+(tone?" "+tone:""),label);
    }

    function closeDrawer(){
      drawerRequest+=1;
      drawer.hidden=true;
      drawerScrim.hidden=true;
      drawerBody.replaceChildren();
      document.body.style.overflow="";
      if(drawerReturnFocus&&document.contains(drawerReturnFocus)){
        try{drawerReturnFocus.focus();}catch(_){}
      }
      drawerReturnFocus=null;
    }

    function openDrawer(item){
      closeMenus();
      var prospectId=text(item&&item.prospectId,"");
      if(!prospectId)return;
      drawerItem=item;
      drawerReturnFocus=document.activeElement;
      drawerTitle.textContent=text(item.businessName,"Business");
      drawerSub.textContent=[text(item.city,""),text(item.state,"")].filter(Boolean).join(", ");
      drawerBody.replaceChildren(element("p","drawer-loading","Opening the file on this business…"));
      drawer.hidden=false;
      drawerScrim.hidden=false;
      document.body.style.overflow="hidden";
      window.setTimeout(function(){drawerClose.focus();},0);

      var ticket=++drawerRequest;
      // The identifier travels in the BODY, never the query string: the
      // response carries a real phone number and a real email address, and a
      // URL is the one place they would survive in a log or a history entry.
      api("/api/admin/prospect-detail",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prospectId:prospectId})
      }).then(function(payload){
        if(ticket!==drawerRequest)return;
        renderDrawer(payload&&payload.detail,payload&&payload.sources,prospectId);
      }).catch(function(error){
        if(ticket!==drawerRequest)return;
        drawerBody.replaceChildren();
        var failed=block("Could not open this record");
        failed.appendChild(element("p","note",error&&error.status===404
          ?"This business is not in the lead table any more. The tile is showing an older snapshot."
          :(error&&error.message)||"The record could not be read just now."));
        drawerBody.appendChild(failed);
      });
    }

    function renderContactBlock(detail){
      var contact=detail.contact||{};
      var section=block("How to reach them");
      var rows=document.createElement("div");
      rows.className="rows";
      // Measured 0 of 198 live leads carry a person's name. Saying that out
      // loud is the difference between a missing field and a broken page.
      rows.appendChild(detailRow("Person",contact.person,{missing:"No name was ever captured for this business"}));
      rows.appendChild(detailRow("Phone",contact.phone,{href:contact.phone?"tel:"+text(contact.phone,"").replace(/[^+0-9]/g,""):""}));
      rows.appendChild(detailRow("Email",contact.email,{href:contact.email?"mailto:"+contact.email:"",missing:"No email address on file"}));
      rows.appendChild(detailRow("Address",contact.address));
      rows.appendChild(detailRow("Their website",contact.theirWebsite,{href:safeHttpUrl(contact.theirWebsite),missing:"They have no website we could find"}));
      rows.appendChild(detailRow("Google listing",contact.googleListing?"Open in Google Maps":"",{href:safeHttpUrl(contact.googleListing),missing:"No Google listing link saved"}));
      section.appendChild(rows);

      var socials=Array.isArray(contact.socials)?contact.socials:[];
      if(socials.length){
        var socialRow=document.createElement("div");
        socialRow.className="pill-row";
        socialRow.style.marginTop="11px";
        socials.forEach(function(entry){
          var url=safeHttpUrl(entry&&entry.url);
          if(!url)return;
          var link=document.createElement("a");
          link.className="pill";
          link.href=url;
          link.target="_blank";
          link.rel="noopener noreferrer";
          link.style.textDecoration="none";
          link.textContent=text(entry.label,"Profile");
          socialRow.appendChild(link);
        });
        if(socialRow.childNodes.length)section.appendChild(socialRow);
      }

      var hours=Array.isArray(contact.hours)?contact.hours:[];
      if(hours.length){
        var hoursWrap=document.createElement("div");
        hoursWrap.className="rows";
        hoursWrap.style.marginTop="11px";
        hours.forEach(function(entry){
          hoursWrap.appendChild(detailRow(text(entry.day,""),text(entry.text,"")));
        });
        section.appendChild(hoursWrap);
      }
      return section;
    }

    function renderPickBlock(detail){
      var pick=detail.pick||{};
      var reputation=detail.reputation||{};
      var section=block("Why we picked them");
      var pills=document.createElement("div");
      pills.className="pill-row";
      if(text(pick.tierPlain,""))pills.appendChild(pill(pick.tierPlain,pick.tier==="A"?"good":(pick.tier==="B"?"good":(pick.tier==="C"?"mid":"low"))));
      if(pick.score!=null)pills.appendChild(pill("Score "+pick.score+" out of 100"));
      if(text(pick.lanePlain,""))pills.appendChild(pill(pick.lanePlain));
      if(pills.childNodes.length)section.appendChild(pills);
      section.appendChild(element("p","note",text(reputation.sentence,"")));
      var reasons=Array.isArray(pick.reasons)?pick.reasons:[];
      if(reasons.length)section.appendChild(bulletList(reasons));
      else section.appendChild(element("p","note","The miner did not record a reason for this one."));
      var disqualifiers=Array.isArray(pick.disqualifiers)?pick.disqualifiers:[];
      if(disqualifiers.length){
        section.appendChild(element("p","note","Counting against them:"));
        section.appendChild(bulletList(disqualifiers,true));
      }
      return section;
    }

    function renderSiteBlock(detail){
      var site=detail.siteProblems||{};
      var section=block("What is wrong with the site they have now");
      var pills=document.createElement("div");
      pills.className="pill-row";
      var website=site.websiteGrade||{};
      var overall=site.overallGrade||{};
      if(text(website.grade,""))pills.appendChild(pill("Their website: "+website.grade+(website.score!=null?" ("+website.score+")":""),gradeTone(website.grade)));
      if(text(overall.grade,""))pills.appendChild(pill("Overall online: "+overall.grade+(overall.score!=null?" ("+overall.score+")":""),gradeTone(overall.grade)));
      if(text(site.builder,""))pills.appendChild(pill("Built on "+site.builder));
      if(site.loadMs!=null)pills.appendChild(pill("Loads in "+site.loadMs+"ms"));
      if(pills.childNodes.length)section.appendChild(pills);

      var signals=Array.isArray(site.signals)?site.signals:[];
      if(signals.length)section.appendChild(bulletList(signals,true));
      else section.appendChild(element("p","note","We have not looked at their current site yet."));
      if(text(website.grade,"")||text(overall.grade,"")){
        section.appendChild(element("p","note","These letters are a measurement, not a gate — nothing is skipped because of them."));
      }
      return section;
    }

    function renderWorkBlock(detail){
      var work=detail.ourWork||{};
      var section=block("What we have built for them");
      var rows=document.createElement("div");
      rows.className="rows";
      rows.appendChild(detailRow("Their new site",work.mirrorUrl?"Open it":"",{href:safeHttpUrl(work.mirrorUrl),missing:"Nothing built yet"}));
      rows.appendChild(detailRow("Their report",work.reportUrl?"Open it":"",{href:safeHttpUrl(work.reportUrl),missing:"No report has been generated"}));
      rows.appendChild(detailRow("Template used",work.donor));
      rows.appendChild(detailRow("Last checked",whenText(work.lastCheckedAt)));
      section.appendChild(rows);
      if(text(work.problem,"")){
        var problemWhen=whenText(work.problemAt);
        var problemLead=work.problemState==="site_present_with_unresolved_build_problem"
          ?"A successful Line build state and site URL are still on file. A rebuild problem was recorded"+(problemWhen?" on "+problemWhen:"")+", and no later successful-build timestamp is stored here, so it remains unresolved: "
          :(work.mirrorUrl
            ?"A build attempt recorded a problem"+(problemWhen?" on "+problemWhen:"")+". A site URL is still on file above; the URL and this recorded issue are separate facts: "
            :"Last build problem recorded"+(problemWhen?" on "+problemWhen:"")+": ");
        section.appendChild(element("p","note",problemLead+text(work.problem,"")));
      }
      return section;
    }

    // TEST RILEY — the owner's one-click spot-check of this client's Riley.
    // Nothing here is asserted: the phone is the resolved agency line (absent
    // when unset, with the reason printed), the Client ID is the same derived
    // code the email prints, and the chat link is the live mirror asked to open
    // its chat bubble (#chat). No mirror, no chat link — said out loud.
    function renderTestRileyBlock(detail){
      var riley=detail.testRiley||{};
      var section=block("Test Riley on this client");
      var rows=document.createElement("div");
      rows.className="rows";
      rows.appendChild(detailRow("Call Riley",riley.display||"",{
        href:riley.telHref&&/^tel:\+?[0-9]+$/.test(riley.telHref)?riley.telHref:"",
        missing:"No Riley line is configured"+(riley.phoneReason?" ("+text(riley.phoneReason,"")+")":"")
      }));
      rows.appendChild(detailRow("Read this ID to him",riley.clientId,{missing:"No Client ID could be derived"}));
      rows.appendChild(detailRow("Chat on their site",riley.chatUrl?"Open with chat":"",{
        href:safeHttpUrl(riley.chatUrl),
        missing:"No mirror is built, so there is no site chat to open"
      }));
      section.appendChild(rows);
      section.appendChild(element("p","note","Call the line, read the ID, ask for one visible change — then open the site and look. The chat link opens the client's own bubble (their AI receptionist), not Riley."));
      return section;
    }

    function renderHistoryBlock(detail,sources){
      var section=block("What has happened");
      var history=Array.isArray(detail.history)?detail.history:[];
      if(!history.length){
        section.appendChild(element("p","note",sources&&sources.sendHistoryRead===false
          ?"The history could not be read just now — this is not the same as nothing having happened."
          :(detail.ourWork&&detail.ourWork.mirrorUrl
            ?"A site URL is on file above, but no dated build or send events were recorded."
            :"No dated build or send events were recorded for this business.")));
        return section;
      }
      var ul=element("ul","timeline");
      history.slice(0,14).forEach(function(entry){
        var li=document.createElement("li");
        li.appendChild(element("span","when",whenText(entry.when)));
        var what=element("div","what",text(entry.what,""));
        if(text(entry.detail,""))what.appendChild(element("small",null,text(entry.detail,"")));
        li.appendChild(what);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      return section;
    }

    function renderHoldsBlock(detail){
      var holds=Array.isArray(detail.holds)?detail.holds:[];
      if(!holds.length)return null;
      var section=block("Held back because");
      section.appendChild(bulletList(holds.map(function(hold){return text(hold.plain,text(hold.code,""));}),true));
      return section;
    }

    function renderNotesBlock(detail,prospectId,sources){
      var section=block("Your notes");
      var form=document.createElement("form");
      form.className="note-form";
      var area=document.createElement("textarea");
      area.placeholder="What you want to remember about this one…";
      area.setAttribute("aria-label","Add a note about this business");
      var save=document.createElement("button");
      save.type="submit";
      save.textContent="Save note";
      var status=element("p","note","");
      form.appendChild(area);
      form.appendChild(save);
      form.appendChild(status);
      section.appendChild(form);

      var saved=document.createElement("div");
      saved.className="saved-notes";
      function paintNotes(notes){
        saved.replaceChildren();
        if(!notes.length){
          saved.appendChild(element("p","note",sources&&sources.notesRead===false
            ?"Saved notes could not be read just now."
            :"No notes yet."));
          return;
        }
        notes.forEach(function(note){
          var card=element("div","saved-note");
          card.appendChild(element("p",null,text(note.text,"")));
          card.appendChild(element("span",null,whenText(note.when)+" · "+text(note.who,"Operator")));
          saved.appendChild(card);
        });
      }
      var notes=Array.isArray(detail.notes)?detail.notes.slice():[];
      paintNotes(notes);
      section.appendChild(saved);

      form.addEventListener("submit",function(event){
        event.preventDefault();
        var value=area.value.trim();
        if(!value){status.textContent="Type something first.";return;}
        save.disabled=true;
        status.textContent="Saving…";
        api("/api/admin/prospect-note",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({prospectId:prospectId,note:value})
        }).then(function(payload){
          area.value="";
          status.textContent="Saved.";
          if(payload&&payload.note)notes.unshift(payload.note);
          paintNotes(notes);
        }).catch(function(error){
          // Never clear the box on a failure — the operator's words are the
          // one thing here we cannot regenerate.
          status.textContent=(error&&error.message)||"The note could not be saved. Your text is still in the box.";
        }).finally(function(){save.disabled=false;});
      });
      return section;
    }

    // THE SEND BLOCK.
    //
    // The button drives /api/admin/send-mirror-proof, which passes
    // internalOwnerProof:true. In lib/email.js that REPLACES the recipient with
    // GHOST_AGENCY_OWNER_EMAIL, forces cc and bcc empty, and then refuses the
    // send outright unless the resolved address already equals the owner
    // (owner_proof_recipient_gate_failed). There is no argument this page can
    // pass that reaches a business — so the destination is stated as a fact
    // before the press, not discovered afterwards.
    function renderSendBlock(detail,prospectId){
      var send=detail.send||{};
      var work=detail.ourWork||{};
      var section=block("Send the proof email");
      var box=element("div","send-box"+(send.canSend&&work.mirrorUrl?"":" blocked"));
      box.appendChild(element("p","send-to",text(send.headline,"")));

      var already=text(send.lastProofSentAt,"");
      var why=[];
      if(text(send.businessEmail,""))why.push("This business's own address ("+send.businessEmail+") is not used by this button.");
      if(!work.mirrorUrl)why.push("Nothing to show yet — this business has no built site, so there is no proof email to send.");
      if(Array.isArray(send.reasons)&&send.reasons.length)why.push(send.reasons.join(". ")+".");
      if(already)why.push("You last sent yourself this one on "+whenText(already)+".");
      why.push("It carries this business's own before-and-after, addressed to you.");
      box.appendChild(element("p","send-why",why.join(" ")));

      var button=document.createElement("button");
      button.className="send-button";
      button.type="button";
      button.textContent=send.canSend&&work.mirrorUrl
        ?(already?"Email it to me again":"Email this proof to me")
        :"Cannot send this one";
      button.disabled=!(send.canSend&&work.mirrorUrl);
      var result=element("p","send-result","");
      button.addEventListener("click",function(){
        button.disabled=true;
        button.textContent="Sending…";
        result.className="send-result";
        result.textContent="";
        api("/api/admin/send-mirror-proof",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({prospectId:prospectId})
        }).then(function(payload){
          var sent=payload&&payload.send;
          if(payload&&payload.ok&&sent&&sent.ok!==false){
            result.textContent="Sent to "+text(send.recipient,"your inbox")+". Give it a minute to land.";
            button.textContent="Sent — send again";
            // The card behind the drawer said "never emailed" a second ago.
            // Leaving it saying that is the same class of lie as never having
            // recorded the send at all.
            if(drawerItem&&text(drawerItem.prospectId,"")===prospectId)markSent(drawerItem,"");
          }else{
            result.className="send-result bad";
            result.textContent=notSent(null,payload);
            button.textContent="Try again";
          }
        }).catch(function(error){
          result.className="send-result bad";
          result.textContent=notSent(error,null);
          button.textContent="Try again";
        }).finally(function(){button.disabled=false;});
      });
      box.appendChild(button);
      box.appendChild(result);
      section.appendChild(box);
      return section;
    }

    function renderDrawer(detail,sources,prospectId){
      if(!detail){
        drawerBody.replaceChildren(element("p","drawer-loading","This record came back empty."));
        return;
      }
      drawerTitle.textContent=text(detail.businessName,"Business");
      drawerSub.textContent=[
        [text(detail.contact&&detail.contact.city,""),text(detail.contact&&detail.contact.state,"")].filter(Boolean).join(", "),
        text(detail.vertical,""),
        text(detail.statusPlain,"")
      ].filter(Boolean).join(" · ");

      var fragment=document.createDocumentFragment();
      var holds=renderHoldsBlock(detail);
      if(holds)fragment.appendChild(holds);
      fragment.appendChild(renderContactBlock(detail));
      fragment.appendChild(renderPickBlock(detail));
      fragment.appendChild(renderSiteBlock(detail));
      fragment.appendChild(renderWorkBlock(detail));
      fragment.appendChild(renderTestRileyBlock(detail));
      fragment.appendChild(renderSendBlock(detail,prospectId));
      fragment.appendChild(renderNotesBlock(detail,prospectId,sources));
      fragment.appendChild(renderHistoryBlock(detail,sources));
      drawerBody.replaceChildren(fragment);
      drawerBody.scrollTop=0;
    }

    // The friendly empty state. A screen with nothing on it is allowed to be
    // warm, and it owes the owner one honest next step — not a dead end.
    function stateMessage(title,message,isError,action){
      galleryGrid.hidden=true;
      galleryGrid.replaceChildren();
      loadZone.hidden=true;
      statePanel.hidden=false;
      statePanel.innerHTML="";
      var inner=document.createElement("div");
      inner.className="state-inner";
      var iconWrap=document.createElement("div");
      iconWrap.className="state-icon";
      iconWrap.appendChild(icon(isError?"M12 9v4M12 17h.01M10.3 3.7 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z":"M3 5h18v14H3zM3 9h18M8 5v4"));
      var heading=document.createElement("h3");
      heading.textContent=title;
      var copy=document.createElement("p");
      copy.textContent=message;
      inner.appendChild(iconWrap);
      inner.appendChild(heading);
      inner.appendChild(copy);
      if(action&&action.href){
        var link=document.createElement("a");
        link.className="retry";
        link.href=action.href;
        link.textContent=action.label||"Continue";
        link.style.marginTop="16px";
        link.style.display="inline-block";
        inner.appendChild(link);
      }
      if(isError){
        var retry=document.createElement("button");
        retry.type="button";
        retry.className="retry";
        retry.textContent="Try again";
        retry.style.marginTop="16px";
        retry.addEventListener("click",function(){load().catch(function(){});});
        inner.appendChild(retry);
      }
      statePanel.appendChild(inner);
    }

    // The two "Show only…" dropdowns are built from what actually arrived:
    // trades display-cased through the plain voice, statuses as "plain words
    // (factory code)". An option that lists a status the owner cannot see on
    // any card would be a lie by omission in the other direction.
    function populateFilters(){
      var trades={};
      var statuses={};
      state.builds.forEach(function(item){
        var trade=text(item.vertical,"").toLowerCase();
        if(trade)trades[trade]=true;
        var status=text(item.status,"").toLowerCase()||(item.archived?"archived_legacy":"");
        if(status)statuses[status]=true;
      });
      var tradeOptions=Object.keys(trades).sort();
      var statusOptions=Object.keys(statuses).sort();
      // Idempotent: keep the leading "All trades"/"Any status" option and
      // rebuild the rest, so a reload can never stack duplicates.
      while(tradeFilter.options.length>1)tradeFilter.remove(1);
      while(statusFilter.options.length>1)statusFilter.remove(1);
      // Two explicit loops: the trade list is plain display names, the status
      // list is "plain words (factory code)" — the jargon stays findable
      // without being the sentence the owner reads.
      tradeOptions.forEach(function(key){
        var option=document.createElement("option");
        option.value=key;
        option.textContent=plainTrade(key);
        tradeFilter.appendChild(option);
      });
      statusOptions.forEach(function(key){
        var option=document.createElement("option");
        option.value=key;
        option.textContent=chipLabelWithCode({status:key});
        statusFilter.appendChild(option);
      });
      tradeFilter.value=tradeOptions.indexOf(state.tradeFilter)>=0?state.tradeFilter:"";
      statusFilter.value=statusOptions.indexOf(state.statusFilter)>=0?state.statusFilter:"";
      state.tradeFilter=tradeFilter.value;
      state.statusFilter=statusFilter.value;
    }

    function updateTabs(){
      var clientTotal=state.clients.filter(function(item){return !item.archived;}).length;
      var buildTotal=state.builds.filter(function(item){return state.showArchived||!item.archived;}).length;
      var archivedTotal=state.builds.filter(function(item){return item.archived;}).length;
      document.getElementById("clientsCount").textContent=clientTotal.toLocaleString();
      document.getElementById("buildsCount").textContent=buildTotal.toLocaleString();
      archivedCount.textContent=archivedTotal?archivedTotal.toLocaleString():"";
      document.querySelectorAll(".tab").forEach(function(tab){
        var active=tab.getAttribute("data-tab")===state.activeTab;
        tab.classList.toggle("active",active);
        tab.setAttribute("aria-selected",String(active));
        tab.setAttribute("tabindex",active?"0":"-1");
      });
      archiveControl.hidden=state.activeTab!=="builds"||(state.loaded&&!archivedTotal);
      galleryRegion.setAttribute("aria-labelledby",state.activeTab==="clients"?"clientsTab":"buildsTab");
    }

    function updateView(){
      updateTabs();
      if(!state.loaded)return;
      closeMenus();
      writeUrlState();
      var animate=animateNextRender;
      animateNextRender=false;
      var rows=activeRows();
      var visible=rows.slice(0,state.visibleLimit);
      if(!rows.length){
        var hasQuery=Boolean(state.query);
        var hasFilter=Boolean(state.tradeFilter||state.statusFilter);
        if(state.activeTab==="clients"&&!state.clients.filter(function(item){return !item.archived;}).length){
          stateMessage("No paying customers yet","Every website lives in All builds. The moment a business pays, their card moves here on its own.",false,{label:"Find new customers",href:"/console"});
        }else if(hasQuery){
          stateMessage("Nothing matches that search","Try a business name, a city, or a trade — or clear the search to see everything.",false,{label:"Find new customers",href:"/console"});
        }else if(hasFilter){
          stateMessage("Nothing matches these filters","Try All trades and Any status to see the whole gallery again.",false,{label:"Find new customers",href:"/console"});
        }else if(state.activeTab==="builds"&&!state.showArchived&&state.builds.some(function(item){return item.archived;})){
          stateMessage("No active websites","Turn on Show archived to see the ones you have put away.",false);
        }else{
          stateMessage("No websites yet","When the factory finishes a build, its card appears here automatically.",false,{label:"Find new customers",href:"/console"});
        }
        resultNote.textContent="0 sites shown";
        return;
      }
      statePanel.hidden=true;
      galleryGrid.hidden=false;
      galleryGrid.replaceChildren();
      sentLines={};
      var fragment=document.createDocumentFragment();
      visible.forEach(function(item,index){fragment.appendChild(makeCard(item,index,animate));});
      galleryGrid.appendChild(fragment);
      var remaining=rows.length-visible.length;
      loadZone.hidden=remaining<=0;
      loadMore.textContent="Load "+Math.min(PAGE_SIZE,remaining)+" more";
      loadHint.textContent=remaining>0?(loadMore.hidden?remaining.toLocaleString()+" more load as you scroll":remaining.toLocaleString()+" sites remain"):"";
      var offlineCount=rows.filter(isOffline).length;
      var haltedCount=rows.filter(function(item){return text(item.batchState,"")==="halted";}).length;
      resultNote.textContent="Showing "+visible.length.toLocaleString()+" of "+rows.length.toLocaleString()+" sites"
        +(offlineCount?" · "+offlineCount.toLocaleString()+" offline":"")
        +(haltedCount?" · "+haltedCount.toLocaleString()+" in halted batches":"");
      refreshBatchBar();
    }

    function normalizeRows(rows){
      return (Array.isArray(rows)?rows:[]).map(function(row){
        row=row&&typeof row==="object"?row:{};
        return {
          prospectId:text(row.prospectId,""),
          businessName:text(row.businessName,""),
          city:text(row.city,""),
          state:text(row.state,""),
          vertical:text(row.vertical,""),
          status:text(row.status,""),
          previewUrl:text(row.previewUrl,""),
          reportUrl:text(row.reportUrl,""),
          shotUrl:text(row.shotUrl,""),
          archived:row.archived===true,
          // The server's own verdict on whether the send route would take this
          // one. Absent means no, never "probably".
          sendable:row.sendable===true,
          lastSentAt:text(row.lastSentAt,""),
          lastSentKind:text(row.lastSentKind,""),
          // The owner's private notes. The snapshot does not carry them, so
          // notesKnown stays false until a save returns the truth — an omitted
          // notes field is preserved server-side, and this flag is what keeps
          // the editor from ever wiping notes it has never seen.
          notes:text(row.notes,""),
          notesKnown:row.notesKnown===true||text(row.notes,"")!=="",
          // The durable Line batch this build belongs to ("" when the build
          // has no batch state to show). Only the Line row carries it.
          batchState:text(row.batchState,""),
          batchHaltReason:text(row.batchHaltReason,"")
        };
      });
    }

    // ANNOTATION, NEVER A DEPENDENCY. The catalog has already painted by the
    // time this runs; its only job is to take the "Open live site" action away
    // from hosts that are measurably gone. Every failure path here is a no-op,
    // so a slow or broken probe leaves the gallery exactly as it was rather
    // than blanking actions on a guess.
    function loadLiveness(){
      if(livenessInFlight)return livenessInFlight;
      livenessInFlight=api("/api/admin/gallery-liveness").then(function(payload){
        var map={};
        var rows=payload&&Array.isArray(payload.results)?payload.results:[];
        rows.forEach(function(row){
          var url=text(row&&row.previewUrl,"");
          if(!url||!row.state)return;
          map[url]={state:String(row.state),status:Number(row.status)||0};
        });
        state.liveness=map;
        if(state.loaded)updateView();
        return payload;
      }).catch(function(){}).finally(function(){livenessInFlight=null;});
      return livenessInFlight;
    }

    // THE SKELETON FIRST PAINT. While the snapshot is in flight the owner
    // sees the grid's real shape — same card silhouette, same 16/10 shot —
    // with no invented words on it. It is never shown after data has landed:
    // every later paint is either cards or an honest named state panel.
    function showSkeleton(){
      statePanel.hidden=true;
      galleryGrid.hidden=false;
      galleryGrid.replaceChildren();
      loadZone.hidden=true;
      var fragment=document.createDocumentFragment();
      for(var index=0;index<12;index+=1){
        var card=document.createElement("div");
        card.className="skeleton-card";
        card.setAttribute("aria-hidden","true");
        var shot=document.createElement("div");
        shot.className="skeleton-shot";
        card.appendChild(shot);
        var body_=document.createElement("div");
        body_.className="skeleton-body";
        var title=document.createElement("div");
        title.className="skeleton-line title";
        body_.appendChild(title);
        [62,44].forEach(function(width){
          var line=document.createElement("div");
          line.className="skeleton-line";
          line.style.width=width+"%";
          body_.appendChild(line);
        });
        card.appendChild(body_);
        fragment.appendChild(card);
      }
      galleryGrid.appendChild(fragment);
    }

    function load(){
      if(loadInFlight)return loadInFlight;
      resultNote.textContent="Loading factory records";
      showSkeleton();
      loadInFlight=api("/api/admin/gallery-data").then(function(payload){
        state.clients=normalizeRows(payload&&payload.clients);
        state.builds=normalizeRows(payload&&payload.builds);
        // The one destination for every email this page can send, straight from
        // the server that will send them. Nothing is offered until it arrives.
        var routing=payload&&payload.send&&typeof payload.send==="object"?payload.send:{};
        state.routing={
          recipient:text(routing.recipient,""),
          canSend:routing.canSend===true&&Boolean(text(routing.recipient,"")),
          headline:text(routing.headline,"")
        };
        if(state.routing.headline)ownerNote.textContent=state.routing.headline;
        state.picked={};
        state.loaded=true;
        state.visibleLimit=PAGE_SIZE;
        populateFilters();
        hideGate();
        updateView();
        loadLiveness();
        return payload;
      }).catch(function(error){
        if(error.status===401||error.status===403){
          clearToken();
          showGate("Token expired or rejected. Enter a current operator token.");
          resultNote.textContent="Operator access required";
        }else{
          hideGate();
          resultNote.textContent="Gallery failed to load";
          stateMessage("Gallery unavailable",error.message||"The factory snapshot could not be read.",true);
        }
        throw error;
      }).finally(function(){loadInFlight=null;});
      return loadInFlight;
    }

    accessForm.addEventListener("submit",function(event){
      event.preventDefault();
      var value=tokenInput.value.trim();
      if(!value){showGate("Paste the operator token first.");return;}
      setToken(value);
      accessButton.disabled=true;
      accessButton.textContent="Checking access…";
      accessStatus.textContent="Checking access…";
      load().catch(function(){});
    });

    document.querySelectorAll(".tab").forEach(function(tab){
      tab.addEventListener("click",function(){state.activeTab=tab.getAttribute("data-tab");state.visibleLimit=PAGE_SIZE;animateNextRender=true;updateView();});
      tab.addEventListener("keydown",function(event){
        if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight"&&event.key!=="Home"&&event.key!=="End")return;
        var tabs=Array.prototype.slice.call(document.querySelectorAll(".tab"));
        var current=tabs.indexOf(tab);
        var next=event.key==="Home"?0:(event.key==="End"?tabs.length-1:(event.key==="ArrowRight"?(current+1)%tabs.length:(current-1+tabs.length)%tabs.length));
        event.preventDefault();tabs[next].click();tabs[next].focus();
      });
    });
    searchInput.addEventListener("input",function(){window.clearTimeout(searchTimer);searchTimer=window.setTimeout(function(){state.query=searchInput.value.trim().toLowerCase();state.visibleLimit=PAGE_SIZE;updateView();},SEARCH_DEBOUNCE);});
    // Enter applies the search NOW instead of waiting out the debounce — the
    // one keystroke an operator presses when he expects the screen to move.
    // Still local: it re-renders from loaded data and fetches nothing.
    searchInput.addEventListener("keydown",function(event){
      if(event.key!=="Enter")return;
      event.preventDefault();
      window.clearTimeout(searchTimer);
      state.query=searchInput.value.trim().toLowerCase();
      state.visibleLimit=PAGE_SIZE;
      updateView();
    });
    sortSelect.addEventListener("change",function(){state.sort=sortSelect.value;state.visibleLimit=PAGE_SIZE;updateView();});
    tradeFilter.addEventListener("change",function(){state.tradeFilter=tradeFilter.value;state.visibleLimit=PAGE_SIZE;updateView();});
    statusFilter.addEventListener("change",function(){state.statusFilter=statusFilter.value;state.visibleLimit=PAGE_SIZE;updateView();});
    showArchived.addEventListener("change",function(){state.showArchived=showArchived.checked;state.visibleLimit=PAGE_SIZE;updateView();});
    loadMore.addEventListener("click",function(){state.visibleLimit+=PAGE_SIZE;updateView();});
    document.addEventListener("click",function(){closeMenus();});
    drawerClose.addEventListener("click",closeDrawer);
    drawerScrim.addEventListener("click",closeDrawer);
    drawer.addEventListener("click",function(event){event.stopPropagation();});

    batchClear.addEventListener("click",function(event){event.stopPropagation();clearPicks();});
    batchSelectAll.addEventListener("click",function(event){
      event.stopPropagation();
      // Only what is on screen right now. "All" that silently includes rows
      // below the fold — or on the other tab — is how a 12-email press becomes
      // a 200-email press.
      activeRows().slice(0,state.visibleLimit).forEach(function(item){
        if(text(item.prospectId,""))state.picked[item.prospectId]=true;
      });
      syncPickedBoxes();
      refreshBatchBar();
    });
    batchSend.addEventListener("click",function(event){
      event.stopPropagation();
      askThenSend(rowsById(pickedIds()));
    });
    batchArchive.addEventListener("click",function(event){
      event.stopPropagation();
      runBatchManage("archive",rowsById(pickedIds()).filter(function(item){return !item.archived;}));
    });
    batchRestore.addEventListener("click",function(event){
      event.stopPropagation();
      runBatchManage("restore",rowsById(pickedIds()).filter(function(item){return item.archived;}));
    });
    batchBar.addEventListener("click",function(event){event.stopPropagation();});

    askCancel.addEventListener("click",closeAsk);
    askScrim.addEventListener("click",closeAsk);
    // Enter in the typed-name box confirms, exactly like pressing the button —
    // but only once the typed name matches, because askGo is armed by the same
    // input check that gates the button.
    askInput.addEventListener("keydown",function(event){
      if(event.key!=="Enter")return;
      event.preventDefault();
      if(!askGo.disabled&&!askInput.hidden)askGo.click();
    });
    askDialog.addEventListener("click",function(event){
      event.stopPropagation();
      if(event.target===askDialog)closeAsk();
    });

    confirmCancel.addEventListener("click",closeConfirm);
    confirmScrim.addEventListener("click",closeConfirm);
    confirmDialog.addEventListener("click",function(event){
      event.stopPropagation();
      // Clicking the padding around the card is the same gesture as clicking
      // the scrim, and reads as one.
      if(event.target===confirmDialog)closeConfirm();
    });

    document.addEventListener("keydown",function(event){
      if(event.key!=="Escape")return;
      // Topmost surface first. A delete or rebuild in flight refuses to
      // close, the same way a running send does — there is no path that
      // abandons a destructive act half-reported.
      if(!askDialog.hidden){event.preventDefault();closeAsk();return;}
      if(!confirmDialog.hidden){event.preventDefault();closeConfirm();return;}
      if(!drawer.hidden){event.preventDefault();closeDrawer();return;}
      var open=document.querySelector(".menu-button[aria-expanded='true']");
      closeMenus();
      if(open)open.focus();
    });

    if("IntersectionObserver" in window){
      // The observer is the primary loader; showing the manual button too made
      // it flash for a beat before auto-load scrolled it away. It stays in the
      // DOM as the fallback for browsers without IntersectionObserver.
      loadMore.hidden=true;
      var observer=new IntersectionObserver(function(entries){
        if(entries.some(function(entry){return entry.isIntersecting;})&&!loadZone.hidden){state.visibleLimit+=PAGE_SIZE;updateView();}
      },{rootMargin:"240px 0px"});
      observer.observe(document.getElementById("loadSentinel"));
    }

    ${LIVE_REFRESH}

    readUrlState();
    if(token())load().catch(function(){});else showGate("");
  })();
  </script>
</body>
</html>`;
