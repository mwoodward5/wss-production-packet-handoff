"use strict";

// GET /api/reveal?token=&sig= — the email preview thumbnail/button target.
//
// Stage 1 (flag off, or the site was prebuilt): verify the signed link, record
// the click, and 302 to the prospect's /try/ preview.
//
// Stage 2 (SITEFORGE_BUILD_ON_CLICK on and the site is NOT prebuilt): serve a
// branded "building your site" loading page. The build is kicked ONLY by the
// page's JS-driven poll (?poll=1) — a scanner (Gmail/Outlook SafeLinks) that
// GETs the URL but does not run JS gets a harmless loading page and never
// triggers a paid build. The poll advances the durable build (idempotent per
// prospect) and, when the preview is ready, the page redirects to it.

const { verifyRevealLink } = require("../lib/reveal-links");
const { recordEvent } = require("../lib/store");
const { prospectPreviewUrl, revealRunId, loadProspectById } = require("../lib/build-on-click");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  return res.end();
}

// NARRATE THE BUILD THAT RUNS, NOT ONE THAT SOUNDS BETTER.
//
// Stage 5 used to read "Remastering your photos & generating your hero", with
// running notes "remastering your photos for retina displays" and "generating
// your AI hero image", and an INCLUDED card titled "Photo remastering & AI hero
// media". No code performs any of it (measured 2026-08-08):
// lib/mirror-engine/client-photos.js harvests the client's own photographs,
// proves ownership, refuses stock, dedupes and RANKS them, then passes their
// URLs on untouched — there is no image library in package.json and the one
// byte-level call, brand-assets.transcodePhoto(), is a container conversion
// needing an ffmpeg the serverless runtime does not carry. Nothing anywhere in
// this codebase generates an image.
//
// Colour-matching IS real and stays: capture-brand's applyBrandToCss and
// applyLiteralHues remap the donor's hues to the palette measured off the
// client's own logo.
//
// EVERYTHING BELOW THIS LINE IS SHIPPED TO A PROSPECT'S BROWSER, INCLUDING
// COMMENTS. The template literal is the page; a `//` note written inside it
// travels to the reader. Notes about this page's copy belong up here.
function loadingPage({ businessName, token, sig }) {
  const q = `token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sig)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Building the website for ${esc(businessName)}…</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070B14;color:#E8ECF8;font:16px/1.6 'Segoe UI',system-ui,sans-serif;overflow:hidden}
.aurora{position:fixed;inset:-40%;background:
 radial-gradient(38% 30% at 30% 30%, rgba(74,108,247,.20), transparent 70%),
 radial-gradient(34% 28% at 72% 62%, rgba(79,182,216,.16), transparent 70%),
 radial-gradient(30% 26% at 55% 25%, rgba(124,92,255,.12), transparent 70%);
 animation:drift 26s ease-in-out infinite alternate;pointer-events:none}
@keyframes drift{from{transform:translate3d(-2%,-1%,0) scale(1)}to{transform:translate3d(2%,1.5%,0) scale(1.06)}}
.grid-overlay{position:fixed;inset:0;background-image:linear-gradient(rgba(127,160,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(127,160,255,.045) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(70% 60% at 50% 45%,#000 30%,transparent 100%);pointer-events:none}
.card{position:relative;width:min(620px,calc(100% - 32px));text-align:center;padding:8px}
.mark{width:60px;height:60px;margin:0 auto 20px;filter:drop-shadow(0 0 18px rgba(74,108,247,.45))}
h1{font:700 clamp(24px,4.4vw,34px)/1.18 'Segoe UI',system-ui,sans-serif;margin:0 0 10px;letter-spacing:-.01em}
.sub{color:#9fb0c3;margin:0 0 30px;font-size:15px}
.stages{list-style:none;padding:0;margin:0 auto;max-width:420px;text-align:left}
.stages li{display:flex;align-items:center;gap:14px;padding:10px 0;color:#5c6b84;transition:color .35s,transform .35s;font-size:15px}
.stages li.active{color:#E8ECF8;transform:translateX(4px)}
.stages li.done{color:#4FB6D8}
.dot{width:22px;height:22px;border-radius:50%;border:2px solid currentColor;flex:0 0 auto;display:grid;place-items:center;font-size:11px;font-weight:700;transition:all .3s}
.stages li.active .dot{border-color:#4A6CF7;box-shadow:0 0 12px rgba(74,108,247,.6);color:#7FA0FF}
.stages li.done .dot{border-color:#4FB6D8;background:rgba(79,182,216,.12)}
.check{opacity:0;transition:opacity .3s}
.stages li.done .check{opacity:1}
.stages li.done .num{opacity:0;width:0}
.bar{height:8px;background:#131c2e;border-radius:99px;overflow:hidden;margin:28px auto 8px;max-width:420px;position:relative}
.bar span{display:block;height:100%;width:6%;background:linear-gradient(90deg,#4A6CF7,#4FB6D8,#7C5CFF);background-size:200% 100%;border-radius:99px;transition:width .7s cubic-bezier(.22,.9,.35,1);animation:shimmer 2.4s linear infinite}
@keyframes shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
.pct{font:700 13px/1 'Segoe UI',monospace;color:#7FA0FF;letter-spacing:.06em}
.readout{min-height:44px;margin-top:22px;font:400 13px/1.5 'Segoe UI',monospace;color:#5f7ba6;max-width:420px;margin-left:auto;margin-right:auto;transition:opacity .4s}
.readout b{color:#8fd8f0;font-weight:600}
.included{margin:26px auto 0;max-width:420px;text-align:left}
.inc-head{font:700 10.5px/1 'Segoe UI',Arial,sans-serif;letter-spacing:.14em;color:#54637e;padding-bottom:10px;text-align:center}
.inc-card{display:flex;gap:14px;align-items:flex-start;background:rgba(19,28,46,.72);border:1px solid rgba(127,160,255,.16);border-radius:14px;padding:14px 16px;min-height:74px;backdrop-filter:blur(6px);transition:opacity .35s,transform .35s}
.inc-card.swap{opacity:0;transform:translateY(6px)}
.inc-icon{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:16px;color:#7FA0FF;background:rgba(74,108,247,.14);border:1px solid rgba(127,160,255,.28)}
.inc-title{font:700 14px/1.3 'Segoe UI',Arial,sans-serif;color:#dbe6fb}
.inc-desc{font:400 12.5px/1.5 'Segoe UI',Arial,sans-serif;color:#8494b0;padding-top:3px}
.pulse-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4FB6D8;margin-right:8px;animation:pulse 1.6s ease-in-out infinite;vertical-align:middle}
@keyframes pulse{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
.safe{margin-top:26px;font-size:12.5px;color:#7f8ca0}
@media(prefers-reduced-motion:reduce){.aurora,.bar span,.pulse-dot{animation:none}.stages li{transition:none}}
</style></head><body>
<div class="aurora"></div><div class="grid-overlay"></div>
<div class="card">
<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#131318"/><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#4A6CF7" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="20" r="4" fill="#4A6CF7"/></svg>
<h1>Building the website for ${esc(businessName)}</h1>
<p class="sub">Live from your real business details — reviews, photos, services, your local market.</p>
<ul class="stages">
  <li data-s="0"><span class="dot"><span class="num">1</span><span class="check">✓</span></span><span class="lbl">Researching your local market &amp; competitors</span></li>
  <li data-s="1"><span class="dot"><span class="num">2</span><span class="check">✓</span></span><span class="lbl">Mining your reviews for the lines that sell you</span></li>
  <li data-s="2"><span class="dot"><span class="num">3</span><span class="check">✓</span></span><span class="lbl">Composing pages, services &amp; local keywords</span></li>
  <li data-s="3"><span class="dot"><span class="num">4</span><span class="check">✓</span></span><span class="lbl">Wiring voice-search schema &amp; call tracking</span></li>
  <li data-s="4"><span class="dot"><span class="num">5</span><span class="check">✓</span></span><span class="lbl">Placing your photos &amp; matching your brand colours</span></li>
  <li data-s="5"><span class="dot"><span class="num">6</span><span class="check">✓</span></span><span class="lbl">Publishing your private preview</span></li>
</ul>
<div class="bar"><span id="bar"></span></div>
<div class="pct" id="pct">6%</div>
<div class="readout" id="readout"><span class="pulse-dot"></span><span id="readoutText">initializing build pipeline…</span></div>
<div class="included" id="included">
  <div class="inc-head">GOING INTO YOUR BUILD</div>
  <div class="inc-card" id="incCard">
    <div class="inc-icon" id="incIcon">◈</div>
    <div class="inc-body">
      <div class="inc-title" id="incTitle">Cinematic site experience</div>
      <div class="inc-desc" id="incDesc">Motion, depth and polish that makes a local business look like a national brand.</div>
    </div>
  </div>
</div>
<p class="safe">🔒 This is your private preview from WSS Labs. Nothing to sign up for.</p>
</div>
<script>
(function(){
  var q=${JSON.stringify(q)};
  var stages=document.querySelectorAll('.stages li');
  var bar=document.getElementById('bar');
  var pctEl=document.getElementById('pct');
  var readout=document.getElementById('readoutText');
  var s=0,pct=6;
  var NOTES=[
    ['scanning <b>${esc(businessName)}</b> reviews across the local map…','pulling competitor gaps in your area…','checking who ranks for your services…'],
    ['found a review worth featuring on the homepage…','extracting the phrases customers actually use…','scoring your reputation vs the top 3 locals…'],
    ['writing your service pages with local keywords…','composing your headline around what you\u2019re best at…','laying out sections that convert calls…'],
    ['adding voice-search schema so assistants find you…','wiring call &amp; text tracking into every button…','structuring FAQ schema for instant answers…'],
    ['placing your own photographs into the layout…','ranking your shots so your best work leads…','color-matching the palette to your brand…'],
    ['running the final quality pass on real devices…','packaging your preview…','almost there — publishing now…']
  ];
  var noteIdx=0;
  var INCLUDED=[
    {icon:'◈', title:'Cinematic website experience', desc:'Motion, depth and polish that makes a local business look like a national brand.'},
    {icon:'◎', title:'Voice-AI ready', desc:'Built-in voice agent answers calls, texts back, and books jobs while you work.'},
    {icon:'◍', title:'Generative search optimization', desc:'Structured so ChatGPT, Gemini and voice assistants cite YOU as the local answer.'},
    {icon:'▣', title:'State-of-the-art lead funnel', desc:'Every scroll, tap and call tracked — leads land scored and routed, not lost.'},
    {icon:'✉', title:'Leads in your inbox automatically', desc:'New inquiries flow straight to your email with the caller\\'s details attached.'},
    {icon:'⬡', title:'Local keyword dominance', desc:'Pages engineered around the exact terms your neighbors type when they need you.'},
    {icon:'◉', title:'Your own photographs, front and centre', desc:'Your real work shots, taken from your own site and ranked best-first — never stock, never another company\\'s.'},
    {icon:'☰', title:'Same-day edits, forever', desc:'Call or text a change — watch your site update. No ticket queue, no waiting.'}
  ];
  var incCard=document.getElementById('incCard');
  var incIcon=document.getElementById('incIcon');
  var incTitle=document.getElementById('incTitle');
  var incDesc=document.getElementById('incDesc');
  var incIdx=0;
  function incTick(){
    incCard.classList.add('swap');
    setTimeout(function(){
      var item=INCLUDED[incIdx % INCLUDED.length];
      incIcon.textContent=item.icon;
      incTitle.textContent=item.title;
      incDesc.textContent=item.desc;
      incCard.classList.remove('swap');
      incIdx++;
    },380);
  }
  incTick(); setInterval(incTick, 4200);
  function paint(){
    stages.forEach(function(li,i){li.classList.toggle('active',i===s);li.classList.toggle('done',i<s);});
    bar.style.width=Math.min(pct,97)+'%';
    pctEl.textContent=Math.min(Math.round(pct),97)+'%';
  }
  function noteTick(){
    var bank=NOTES[Math.min(s,NOTES.length-1)];
    readout.innerHTML=bank[noteIdx % bank.length];
    noteIdx++;
  }
  paint(); noteTick();
  setInterval(noteTick, 3400);
  function tick(){ if(s<5)s++; pct+=13; paint(); }
  var creep=setInterval(function(){pct=Math.min(pct+1.6,95);bar.style.width=pct+'%';pctEl.textContent=Math.round(pct)+'%';},1500);
  function poll(){
    fetch('/api/reveal?'+q+'&poll=1',{headers:{'x-reveal-poll':'1'}}).then(function(r){return r.json();}).then(function(j){
      if(j&&j.ready&&j.preview_url){
        clearInterval(creep);s=5;pct=100;paint();
        pctEl.textContent='100%';
        readout.innerHTML='<b>your website is ready.</b>';
        setTimeout(function(){location.href=j.preview_url;},700);return;
      }
      tick(); setTimeout(poll, 6000);
    }).catch(function(){ setTimeout(poll, 8000); });
  }
  setTimeout(poll, 800);
})();
</script></body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const check = verifyRevealLink(req.query?.token, req.query?.sig);
  if (!check.ok) {
    res.statusCode = check.reason === "expired" ? 410 : 401;
    return res.end("This website preview link is no longer valid. Please reply to the email for a fresh link.");
  }
  const p = check.payload;
  const payloadPreview = /^https:\/\//i.test(String(p.preview_url || "")) ? p.preview_url : "";

  // ---- Stage 1 path: the token carries a real, prebuilt preview ----
  // ONLY redirect when we genuinely have the client's site.
  //
  // Previously this branch also fired when the build-on-click flag was OFF, and
  // its redirect fell back to the public app root. A prospect whose prebuild had
  // not landed clicked "Open your live preview" and was 302'd to a DIFFERENT
  // product's marketing site. That same clause also skipped the build-on-click
  // branch below, which already renders our branded loading page and can build
  // the site on demand.
  //
  // A prospect must NEVER be sent to an unrelated product. With no preview we
  // fall through, so the flow either finds/builds their site or shows our own
  // honest loading page.
  if (payloadPreview) {
    try {
      await recordEvent("preview.clicked", { prospectId: p.prospect_id, businessName: p.business_name, industry: p.industry, at: new Date().toISOString() });
    } catch { /* non-blocking */ }
    return redirect(res, payloadPreview);
  }

  // ---- Stage 2: build-on-click ----
  const prospect = p.prospect_id ? await loadProspectById(p.prospect_id) : null;
  const existing = prospect ? prospectPreviewUrl(prospect) : "";
  const isPoll = String(req.query?.poll || "") === "1";

  if (isPoll) {
    // The poll runs only from the loading page's JS — real browsers, not
    // scanners. It advances the durable build and reports readiness.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (existing) return res.end(JSON.stringify({ ready: true, preview_url: existing }));
    if (!prospect) return res.end(JSON.stringify({ ready: false, error: "prospect_not_found" }));
    try {
      const { buildPreviewForProspect } = require("../lib/full-run");
      const result = await buildPreviewForProspect(prospect, { runId: revealRunId(p.prospect_id), source: "reveal_click" });
      const ready = Boolean(result?.ok && result?.preview_url);
      if (ready) await recordEvent("preview.built_on_click", { prospectId: p.prospect_id, at: new Date().toISOString() });
      return res.end(JSON.stringify({ ready, preview_url: ready ? result.preview_url : "" }));
    } catch {
      return res.end(JSON.stringify({ ready: false }));
    }
  }

  // First (non-poll) GET: if already built, go straight there; else record the
  // click and serve the loading page. NO build is triggered here, so a scanner
  // prefetch is harmless.
  if (existing) {
    try { await recordEvent("preview.clicked", { prospectId: p.prospect_id, at: new Date().toISOString() }); } catch { /* non-blocking */ }
    return redirect(res, existing);
  }
  try { await recordEvent("preview.reveal_opened", { prospectId: p.prospect_id, businessName: p.business_name, at: new Date().toISOString() }); } catch { /* non-blocking */ }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(loadingPage({ businessName: p.business_name || "your business", token: req.query.token, sig: req.query.sig }));
};
