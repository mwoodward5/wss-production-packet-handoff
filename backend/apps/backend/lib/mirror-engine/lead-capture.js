"use strict";

// lib/mirror-engine/lead-capture.js — server-side lead capture on every mirror.
//
// WHAT IT REPLACES
// Three of the donors submit their quote form with
//     window.location.href = "mailto:" + O.EMAIL + "?subject=…&body=…"
// which on a phone is where the client's new customer dies: no mail client
// opens, or one opens a draft nobody sends. Nothing is captured, so nothing can
// be counted, so "your site brought you 7 calls this month" — the renewal case
// for a $149/mo subscription — cannot be said. The other four donors DO post to
// /api/quote-request but have no fallback at all: if that request fails their
// form shows an error and the lead is gone.
//
// WHY THIS IS A BUILD-TIME INJECTION AND NOT AN EDIT TO SEVEN BUNDLES
// The donors are shipped as pre-compiled Vite output. Hand-patching a minified
// onSubmit in seven files is seven chances to corrupt a bundle, seven things to
// re-verify on every donor refresh, and zero coverage for donor number twelve.
// One capture-phase listener on `document` gets in front of ALL of them,
// because React 18 delegates its onSubmit to the root container — a descendant
// of document — so a capture listener here runs first and stopPropagation()
// means the donor's own handler, mailto: and all, never fires.
//
// THE FALLBACK IS THE POINT. A client must never lose a lead because our
// endpoint 500s, so a failed post does exactly what the donor used to do:
// opens the visitor's mail client with the message pre-filled. That path is
// strictly better than today for the four donors that never had it.
//
// NOTHING HERE INVENTS AN ADDRESS. The mailto: fallback uses the client's own
// verified email, stamped at build time from the same facts the page prints. If
// there is no verified email the fallback is a phone number, and if there is
// neither, the script leaves the form alone entirely rather than swallowing a
// submit it cannot honour.

const jsonEsc = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const DEFAULT_ENDPOINT = "https://ghost.wss-ai.com/api/quote-request";

// The browser half. Written as one string on purpose: it ships inline, it must
// never throw (a single console error fails the render gate), and it must not
// depend on anything the donor bundle does or does not provide.
const SCRIPT = [
  "(function(){",
  "try{",
  "var C=window.__WSS_LEAD__;if(!C||!C.endpoint||!C.slug)return;",
  // A proof shot is a picture of the client's site. Nothing we add may be able
  // to alter it, so on a thumbnail capture this never installs at all.
  "if(/[?&]wssthumb=1/.test(location.search))return;",
  "if(typeof fetch!=='function')return;",
  "window.__WSS_LEAD_CAPTURE__='v1';",

  // --- field reading -------------------------------------------------------
  // Donors disagree about how they name inputs: some use name=, the shadcn ones
  // use id= only, and the values live on controlled React inputs. Reading the
  // DOM value off every field and classifying by type-then-name covers all of
  // them, where new FormData(form) would silently return nothing for the
  // id-only donors.
  // A honeypot is a field a HUMAN cannot reach. Measured on the real donors:
  // the concrete donor parks its `website` input inside
  // aria-hidden + "absolute left-[-9999px] h-0 w-0 overflow-hidden" with
  // tabIndex -1, so it still reports a non-zero rect and a display of "block".
  // Checking only computed style called that field visible, which would have
  // made a bot's fill sail straight past the trap.
  "function vis(el){try{if(el.type==='hidden'||el.hidden)return false;",
  "if(el.getAttribute('tabindex')==='-1')return false;",
  "if(el.closest&&el.closest('[aria-hidden=\"true\"]'))return false;",
  "var r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;",
  "if(r.right<=0||r.bottom<=0||r.left>=(window.innerWidth||0))return false;",
  "var s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0')return false;",
  "return true;}catch(e){return true;}}",
  "function read(form){",
  "var out={name:'',phone:'',email:'',service:'',message:'',website:''};",
  "var els=form.querySelectorAll('input,textarea,select');",
  "for(var i=0;i<els.length;i++){var el=els[i];",
  "var t=String(el.type||'').toLowerCase();",
  "if(t==='submit'||t==='button'||t==='image'||t==='file'||t==='reset')continue;",
  "if(el.disabled)continue;",
  "if((t==='checkbox'||t==='radio')&&!el.checked)continue;",
  "var k=String(el.name||el.id||el.getAttribute('aria-label')||el.placeholder||'').toLowerCase();",
  "var v=el.value==null?'':String(el.value);",
  // A honeypot only counts as one when it is actually hidden from a human. A
  // VISIBLE "your website" field is a real question, and treating it as a bot
  // signal would make the endpoint answer 200 and drop a genuine lead.
  "if(/website|company_website|honey|hp_/.test(k)&&!vis(el)){if(v)out.website=v;continue;}",
  "if(!v.replace(/\\s+/g,''))continue;",
  "if(!out.email&&(t==='email'||/e-?mail/.test(k))){out.email=v;continue;}",
  "if(!out.phone&&(t==='tel'||/phone|tel|mobile|cell/.test(k))){out.phone=v;continue;}",
  "if(!out.message&&(el.tagName==='TEXTAREA'||/message|detail|note|project|describe|comment|inquiry|enquir/.test(k))){out.message=v;continue;}",
  "if(!out.service&&/service|job|trade|reason|subject|interest|help/.test(k)){out.service=v;continue;}",
  "if(!out.name&&/name|contact/.test(k)&&!/business|company/.test(k)){out.name=v;continue;}",
  "}",
  "return out;}",

  // --- the visitor-facing notes -------------------------------------------
  // Deliberately unstyled beyond inheriting the donor's own type and colour: a
  // hand-drawn card would look bolted on, and this appears inside somebody
  // else's design system.
  "function note(form,text){try{var d=document.createElement('div');",
  "d.setAttribute('role','status');d.setAttribute('data-wss-lead-note','1');",
  "d.style.cssText='margin:14px 0;padding:14px 16px;border:1px solid currentColor;border-radius:10px;font:500 15px/1.45 inherit;opacity:.92';",
  "d.textContent=text;var old=form.parentNode&&form.parentNode.querySelector('[data-wss-lead-note]');",
  "if(old&&old.parentNode)old.parentNode.removeChild(old);",
  "if(form.parentNode)form.parentNode.insertBefore(d,form);",
  "try{d.scrollIntoView({block:'nearest'});}catch(e){}return d;}catch(e){return null;}}",

  // --- the fallback the client used to have --------------------------------
  "function mailto(f){",
  "if(!C.email)return false;",
  "var s=encodeURIComponent('Quote'+(f.service?' \\u2014 '+f.service:''));",
  "var b=encodeURIComponent(['Name: '+f.name,'Phone: '+f.phone,'Email: '+f.email,'Service: '+f.service,'','' +f.message].join('\\n'));",
  "window.location.href='mailto:'+C.email+'?subject='+s+'&body='+b;return true;}",

  "function failed(form,f){",
  "if(mailto(f)){note(form,'We could not send that from the site, so your email app is opening with the message ready.');return;}",
  "note(form,C.phone?('Sorry \\u2014 that did not send. Please call '+C.phone+'.'):'Sorry \\u2014 that did not send. Please try again shortly.');}",

  // --- the interception ----------------------------------------------------
  "document.addEventListener('submit',function(ev){",
  "try{",
  "var form=ev.target;",
  "if(!form||form.tagName!=='FORM')return;",
  "if(form.hasAttribute('data-wss-no-capture'))return;",
  "if(String(form.getAttribute('role')||'').toLowerCase()==='search')return;",
  "var f=read(form);",
  // Our test for "is this a lead form" is the same as our test for "is this
  // lead answerable": a way to reach the person back. A search box, a newsletter
  // box with no contact field, or a half-filled form falls through untouched and
  // the donor's own validation shows its own errors.
  "if(!f.phone&&!f.email)return;",
  "ev.preventDefault();ev.stopPropagation();",
  "form.setAttribute('data-wss-lead','posting');",
  "var payload={slug:C.slug,site:C.slug,name:f.name,phone:f.phone,email:f.email,service:f.service,message:f.message,website:f.website,page:String(location.pathname||'/')};",
  "var ctl=null,timer=null;",
  "try{ctl=new AbortController();timer=setTimeout(function(){try{ctl.abort();}catch(e){}},9000);}catch(e){}",
  "fetch(C.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctl?ctl.signal:undefined})",
  ".then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok&&j&&j.ok===true};});})",
  ".then(function(r){if(timer)clearTimeout(timer);",
  "if(!r.ok){form.setAttribute('data-wss-lead','failed');failed(form,f);return;}",
  "form.setAttribute('data-wss-lead','sent');",
  "note(form,C.confirm);",
  "try{form.style.display='none';form.reset();}catch(e){}",
  "})",
  ".catch(function(){if(timer)clearTimeout(timer);form.setAttribute('data-wss-lead','failed');failed(form,f);});",
  "}catch(e){}",
  "},true);",
  "}catch(e){}",
  "})();",
].join("");

/**
 * resolveLeadCaptureConfig({ facts, slug, phoneDigits, env })
 *   -> { ok, config, reason }
 *
 * `ok:false` is a real answer: with no slug there is nothing to route a lead
 * to, and installing a capture that posts an empty slug would turn a working
 * mailto: into a 400 and lose the lead. The donor's own behaviour is the
 * correct thing to leave alone in that case.
 */
function resolveLeadCaptureConfig({ facts = {}, slug = "", env = process.env } = {}) {
  const clean = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(clean)) {
    return { ok: false, config: null, reason: "no_site_slug_to_route_leads_to" };
  }
  const endpoint = String(env.GHOST_AGENCY_LEAD_ENDPOINT || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
  const email = String(facts.email || "").trim();
  const phone = String(facts.phone_human || facts.phone || "").trim();
  const business = String(facts.business_name || "").trim();
  return {
    ok: true,
    reason: "",
    config: {
      endpoint,
      slug: clean,
      // The fallback address. Empty is legitimate — some verified businesses
      // publish no email — and the script then falls back to the phone rather
      // than to a mailto: nobody can receive.
      email,
      phone,
      business,
      confirm: business
        ? `Thanks — your request has been received. ${business} has your details.`
        : "Thanks — your request has been received.",
    },
  };
}

/**
 * buildLeadCapture(config) -> "" | html
 * The stamped config plus the script, ready to sit before </body>.
 */
function buildLeadCapture(config) {
  if (!config || !config.endpoint || !config.slug) return "";
  return `<script id="wss-lead-config" type="application/json">${jsonEsc(config)}</script>`
    + `<script>try{var e=document.getElementById("wss-lead-config");if(e)window.__WSS_LEAD__=JSON.parse(e.textContent)}catch(x){}</script>`
    + `<script>${SCRIPT}</script>`;
}

module.exports = {
  DEFAULT_ENDPOINT,
  LEAD_CAPTURE_SCRIPT: SCRIPT,
  buildLeadCapture,
  resolveLeadCaptureConfig,
};
