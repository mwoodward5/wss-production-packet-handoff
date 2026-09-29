(function () {
  "use strict";
  var STRIPE_LINK = "https://ghost-agency-backend.vercel.app/api/checkout-link?token=eyJ2IjoxLCJleHAiOjE3ODg5MTM2MDE5NDMsImpvYl9pZCI6InByb2R0ZXN0LTVjdXN0LXRla2xpbmUtcm9vZmluZy1zZWF0dGxlIiwicHJvc3BlY3RfaWQiOiJwbGFjZS1jaGlqZ3djYTJtemRrZnFycGxoMGFxbmE0dWUiLCJidXNpbmVzc19uYW1lIjoiVGVrbGluZSBSb29maW5nIiwiaW5kdXN0cnkiOiJyb29maW5nIiwiY2l0eSI6IlNlYXR0bGUiLCJzdGF0ZSI6IldBIn0&sig=zExNqFyMVfXEWwZFu-DIuoLZ-4ZpDFWd3QgJo08kbkk";
  var CONTACT_LINK = "mailto:hello@wss-ai.com?subject=Questions%20about%20my%20%24199%2Fmo%20site";
  // Riley's line. NO number is pinned here: this file shipped a literal
  // tel:+1949… onto every mirror built from this donor, and it kept dialing
  // long after that line was ours to give. The build injects
  // window.WSS_RILEY_TEL when a Riley line exists for the client; with nothing
  // injected (or an unsubstituted token) the Riley button and its proof blurb
  // are omitted entirely rather than rendering a dead href. Deliberately NOT a
  // double-brace token: an unmapped one hard-fails the hydrator, and mapping it
  // would widen the token contract for one button.
  var RILEY_TEL = (function () {
    var raw = String(window.WSS_RILEY_TEL || "").trim();
    if (!raw || raw.indexOf("{{") !== -1) return "";
    var d = raw.replace(/[^0-9]/g, "");
    if (d.length === 10) return "tel:+1" + d;
    if (d.length === 11 && d.charAt(0) === "1") return "tel:+" + d;
    if (raw.charAt(0) === "+" && d.length >= 11 && d.length <= 15) return "tel:+" + d;
    return "";
  })();
  var DOMAIN = "{{DOMAIN}}";

  var css = [
    "#wss-floater{position:fixed;left:16px;top:50%;transform:translateY(-50%);z-index:99999;",
    "font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;gap:10px;}",
    "#wss-floater .wss-card{width:252px;background:rgba(15,15,17,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);",
    "border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:13px 14px;",
    "box-shadow:0 8px 28px rgba(0,0,0,.45);color:#f2f2f2;position:relative;}",
    "#wss-floater .wss-brand{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.09);}",
    "#wss-floater .wss-brand svg{display:block;}",
    "#wss-floater .wss-brand .wss-brand-dot{animation:wssPulseSvg 1.8s ease-in-out infinite;transform-origin:center;transform-box:fill-box;}",
    "@keyframes wssPulseSvg{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(1.7);}}",
    "#wss-floater .wss-brand-name{font-size:11.5px;font-weight:800;color:#fff;letter-spacing:.02em;}",
    "#wss-floater .wss-brand-name small{font-weight:400;color:#9B9AA4;margin-left:4px;font-size:10px;}",
    "#wss-floater .wss-eyebrow{font-size:9.5px;letter-spacing:1.6px;font-weight:800;color:#e8c25a;",
    "text-transform:uppercase;margin-bottom:4px;}",
    "#wss-floater .wss-price-row{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;}",
    "#wss-floater .wss-price{font-size:27px;font-weight:900;color:#fff;letter-spacing:-.02em;}",
    "#wss-floater .wss-price small{font-size:11px;font-weight:600;color:#b7bcc4;letter-spacing:0;}",
    "#wss-floater .wss-waive{display:inline-block;margin-top:5px;font-size:10.5px;font-weight:800;color:#7ee2b8;",
    "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);border-radius:6px;padding:4px 8px;}",
    "#wss-floater .wss-waive s{color:#98a0a8;font-weight:600;}",
    "#wss-floater .wss-stack{margin:9px 0 4px;padding:0;list-style:none;}",
    "#wss-floater .wss-stack li{font-size:10.5px;color:#d7dbe0;line-height:1.45;padding-left:16px;position:relative;margin-bottom:3px;}",
    "#wss-floater .wss-stack li:before{content:'\\2713';position:absolute;left:0;color:#34D399;font-weight:900;}",
    "#wss-floater .wss-stack-note{font-size:9.5px;color:#e8c25a;font-weight:800;margin:2px 0 9px;letter-spacing:.04em;text-transform:uppercase;}",
    "#wss-floater .wss-btn{display:block;width:100%;text-align:center;padding:10px;border-radius:8px;",
    "font-size:12.5px;font-weight:800;text-decoration:none;box-sizing:border-box;}",
    "#wss-floater .wss-btn-primary{background:#d93025;color:#fff;font-size:13px;}",
    "#wss-floater .wss-btn-riley{background:#fff;color:#131318;margin-top:8px;line-height:1.35;padding:8px 10px;}",
    "#wss-floater .wss-btn-riley small{display:block;font-size:10px;font-weight:700;color:#0b7a4e;}",
    "#wss-floater .wss-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34D399;margin-right:5px;vertical-align:1px;",
    "box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:wssPulse 1.8s infinite;}",
    "#wss-floater .wss-proof{font-size:10px;color:#c7cbd1;line-height:1.4;margin-top:7px;background:rgba(255,255,255,.05);",
    "border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:7px 9px;}",
    "#wss-floater .wss-proof b{color:#fff;}",
    "#wss-floater .wss-domain-row{display:flex;align-items:center;gap:7px;background:#0b0f0c;",
    "border:1px solid #23392a;border-radius:7px;padding:7px 9px;margin-top:8px;}",
    "#wss-floater .wss-dot{width:7px;height:7px;border-radius:50%;background:#34D399;flex:0 0 auto;",
    "box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:wssPulse 1.8s infinite;}",
    "@keyframes wssPulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55);}",
    "70%{box-shadow:0 0 0 7px rgba(52,211,153,0);}100%{box-shadow:0 0 0 0 rgba(52,211,153,0);}}",
    "#wss-floater .wss-domain-text{font-size:11px;color:#d7dbe0;overflow:hidden;text-overflow:ellipsis;",
    "white-space:nowrap;flex:1;}",
    "#wss-floater .wss-domain-text b{color:#7ee2b8;}",
    "#wss-floater .wss-count{display:flex;align-items:center;gap:6px;margin-top:8px;padding:7px 9px;border-radius:7px;background:rgba(232,194,90,.12);border:1px solid rgba(232,194,90,.3);}",
    "#wss-floater .wss-count b{color:#e8c25a;font-size:12.5px;font-variant-numeric:tabular-nums;}",
    "#wss-floater .wss-count span{font-size:10px;color:#c7cbd1;}",
    "#wss-floater .wss-trust-row{font-size:9.5px;color:#7d838b;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;flex-wrap:wrap;gap:5px;}",
    "#wss-floater .wss-trust-row img{vertical-align:middle;display:inline-block;}",
    "#wss-floater .wss-trust-row .wss-trust-label{color:#9aa0a8;}",
    "#wss-pill{position:fixed;left:16px;bottom:16px;z-index:99999;display:none;background:rgba(15,15,17,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.18);border-radius:24px;padding:9px 16px;color:#fff;font:700 12.5px Arial;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.45);}",
    "#wss-pill b{color:#e8c25a;}",
    "#wss-floater .wss-close{position:absolute;top:6px;right:8px;background:none;border:none;",
    "color:#8a8f98;font-size:13px;cursor:pointer;line-height:1;}",
    "#wss-floater{transition:opacity .25s ease;}",
    "@media(max-width:760px){#wss-floater{left:10px;right:10px;top:auto;bottom:10px;transform:none;flex-direction:row;}",
    "#wss-floater .wss-card{width:auto;flex:1;min-width:150px;}}"
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var wrap = document.createElement("div");
  wrap.id = "wss-floater";
  wrap.innerHTML =
    '<div class="wss-card" id="wss-plan-card">' +
      '<button class="wss-close" aria-label="Minimize" title="Minimize">&#8211;</button>' +
      '<div class="wss-brand"><svg width="22" height="22" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle class="wss-brand-dot" cx="50" cy="20" r="5" fill="#34D399"/></svg><span class="wss-brand-name">WSS Labs<small>site &amp; AI team</small></span></div>' +
      '<div class="wss-eyebrow">This site was built for you</div>' +
      '<div class="wss-price-row"><span class="wss-price">&#36;199<small>.00/mo</small></span></div>' +
      '<span class="wss-waive"><s>&#36;499 setup fee</s> &mdash; WAIVED today</span>' +
      '<ul class="wss-stack">' +
        '<li>Your photos, logo &amp; brand &mdash; mined, excavated &amp; remastered</li>' +
        '<li>AI cinematic hero video &mdash; generated for your business</li>' +
        '<li>Local competitor &amp; search research &mdash; built into your pages</li>' +
        '<li>AI-generated imagery &amp; logo optimization</li>' +
        '<li>Hosting, SSL, lead capture &amp; unlimited edits</li>' +
      '</ul>' +
      '<div class="wss-stack-note">All included today</div>' +
      '<a class="wss-btn wss-btn-primary" href="' + STRIPE_LINK + '" target="_blank" rel="noopener">&#36; Launch my site now &#8594;</a>' +
      (RILEY_TEL
        ? '<a class="wss-btn wss-btn-riley" href="' + RILEY_TEL + '"><span class="wss-live-dot"></span>Call your own private web developer<small>Riley edits this site while you talk &mdash; 24/7, never a hold queue</small></a>' +
          '<div class="wss-proof"><b>Don&rsquo;t take our word &mdash; test it.</b> Call Riley and ask for one change: swap the video, reword a headline, change a photo. Watch your site update while you&rsquo;re on the phone.</div>'
        : "") +
      '<div class="wss-domain-row">' +
        '<span class="wss-dot"></span>' +
        '<span class="wss-domain-text"><b>' + DOMAIN + '</b> &mdash; included free</span>' +
      '</div>' +
      '<div class="wss-count"><b id="wss-timer">--</b><span>your preview is reserved &mdash; then it comes down</span></div>' +
      '<div class="wss-trust-row">' +
        '<img src="/assets/icons/ssl-lock.svg" width="12" height="12" alt="SSL secured">' +
        '<span class="wss-trust-label">Secured by Stripe</span>' +
        '<img src="/assets/icons/visa.svg" width="26" height="16" alt="Visa">' +
        '<img src="/assets/icons/mastercard.svg" width="26" height="16" alt="Mastercard">' +
        '<img src="/assets/icons/amex.svg" width="26" height="16" alt="American Express">' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  var pill = document.createElement("button");
  pill.id = "wss-pill";
  pill.innerHTML = "$199 site plan &middot; <b id=\"wss-timer-pill\">--</b>";
  document.body.appendChild(pill);

  wrap.querySelector(".wss-close").addEventListener("click", function () {
    wrap.style.opacity = "0";
    setTimeout(function () { wrap.style.display = "none"; pill.style.display = "block"; }, 250);
  });
  pill.addEventListener("click", function () {
    pill.style.display = "none";
    wrap.style.display = "flex";
    wrap.style.opacity = "1";
  });

  // 7-day reservation countdown, anchored to the visitor's first view so it is
  // a real, consistent deadline for them (persisted locally).
  var KEY = "wss_preview_deadline";
  var deadline = parseInt(localStorage.getItem(KEY) || "0", 10);
  if (!deadline || deadline < Date.now()) {
    deadline = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(KEY, String(deadline));
  }
  function tick() {
    var ms = Math.max(0, deadline - Date.now());
    var d = Math.floor(ms / 86400000);
    var h = Math.floor(ms % 86400000 / 3600000);
    var m = Math.floor(ms % 3600000 / 60000);
    var txt = d + "d " + h + "h " + m + "m";
    var el1 = document.getElementById("wss-timer");
    var el2 = document.getElementById("wss-timer-pill");
    if (el1) el1.textContent = txt;
    if (el2) el2.textContent = txt;
  }
  tick();
  setInterval(tick, 30000);
})();
