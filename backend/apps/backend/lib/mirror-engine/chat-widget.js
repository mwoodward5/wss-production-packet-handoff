"use strict";

// lib/mirror-engine/chat-widget.js — a visitor-to-business relay on every
// future mirror. This is deliberately a build-time, dependency-free injection:
// donor bundles differ, but every page has the same safe </body> seam already
// used by lead-capture.js.
//
// TRUTH LAW:
// - It never claims the business is online, that a message was seen, or that
//   somebody is typing. None of those signals exists.
// - It never invents an automated answer. This surface is visitor <-> owner.
// - The only visitor data rendered is the message that visitor typed.
// - The tenant slug is stamped at build time. It is never read from a form.

const DEFAULT_ENDPOINTS = Object.freeze({
  start: "https://ghost.wss-ai.com/api/connect/chat-start",
  post: "https://ghost.wss-ai.com/api/connect/chat-post",
  poll: "https://ghost.wss-ai.com/api/connect/chat-poll",
});

const OPEN_POLL_MS = 6000;
const CLOSED_POLL_MS = 30000;
const IDLE_STOP_MS = 10 * 60 * 1000;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ESC[char]);
const jsonEsc = (value) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const CHAT_WIDGET_CSS = `
#wss-chat-root,#wss-chat-root *{box-sizing:border-box}
#wss-chat-root{--wss-chat-brand:rgb(28,30,35);--wss-chat-on-brand:#fff;--wss-chat-clear:0px;--wss-chat-vh:100dvh;--wss-chat-keyboard:0px;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + var(--wss-chat-clear) + var(--wss-chat-keyboard));width:58px;height:58px;z-index:99990;font-family:var(--font-body,system-ui),-apple-system,"Segoe UI",sans-serif;line-height:1.4;color:#171717;pointer-events:none}
/* AUDIT A2 (doubled floating widget): the clean donors ship their own
   fixed "Call for an estimate" .floater anchored at the same bottom-right
   corner as this launcher, so the page rendered two stacked contact
   widgets (the launcher measured itself up and over the donor floater —
   DOM: two fixed elements at the same left, t=660 and t=716, every site).
   One corner, one contact affordance: where this chat ships, the donor's
   own floater stands down. :has() is a progressive enhancement — where it
   is unsupported the page keeps the previous stacked behaviour. */
body:has(#wss-chat-root) :is(.floater, a[class*="floater" i]):not([id^="wss-"]):not([class*="wss" i]){display:none!important}
#wss-chat-root button,#wss-chat-root textarea{font:inherit}
#wss-chat-root button{appearance:none;-webkit-appearance:none}
#wss-chat-root [hidden]{display:none!important}
#wss-chat-launcher{position:absolute;inset:0;width:58px;height:58px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:var(--wss-chat-brand);color:var(--wss-chat-on-brand);box-shadow:0 10px 30px rgba(0,0,0,.28);cursor:pointer;pointer-events:auto;transition:transform .18s ease,box-shadow .18s ease}
#wss-chat-launcher:hover{transform:translateY(-2px);box-shadow:0 13px 34px rgba(0,0,0,.32)}
#wss-chat-launcher svg{width:25px;height:25px;display:block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
#wss-chat-launcher .wss-chat__close-icon{display:none}
#wss-chat-root[data-open="true"] #wss-chat-launcher .wss-chat__bubble-icon{display:none}
#wss-chat-root[data-open="true"] #wss-chat-launcher .wss-chat__close-icon{display:block}
#wss-chat-panel{position:absolute;right:0;bottom:70px;width:min(380px,calc(100vw - 32px));height:min(600px,calc(var(--wss-chat-vh) - var(--wss-chat-clear) - 110px));max-height:calc(var(--wss-chat-vh) - var(--wss-chat-clear) - 40px);min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid rgba(17,17,17,.14);border-radius:20px;background:#fff;color:#171717;box-shadow:0 22px 64px rgba(0,0,0,.28);pointer-events:auto;isolation:isolate;animation:wss-chat-in .18s ease-out both}
.wss-chat__head{display:flex;align-items:center;gap:12px;padding:15px 14px 14px 17px;background:var(--wss-chat-brand);color:var(--wss-chat-on-brand)}
.wss-chat__identity{min-width:0;flex:1}
.wss-chat__identity h2{font-family:inherit;font-size:16px;line-height:1.25;font-weight:700;letter-spacing:0;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:inherit}
.wss-chat__identity p{font-family:inherit;font-size:12px;line-height:1.35;font-weight:500;margin:3px 0 0;color:inherit}
.wss-chat__head-close{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;padding:0;border:0;border-radius:12px;background:transparent;color:inherit;cursor:pointer}
.wss-chat__head-close:hover{background:rgba(127,127,127,.18)}
.wss-chat__head-close svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
#wss-chat-messages{min-height:0;margin:0;padding:17px 15px 10px;overflow:auto;overscroll-behavior:contain;background:#fff;scrollbar-width:thin}
.wss-chat__empty{max-width:28ch;margin:34px auto;text-align:center;color:#656565;font-family:inherit;font-size:14px;line-height:1.55;font-weight:500}
.wss-chat__message{display:flex;flex-direction:column;align-items:flex-start;margin:0 0 12px}
.wss-chat__message--visitor{align-items:flex-end}
.wss-chat__bubble{max-width:86%;padding:10px 12px;border-radius:15px 15px 15px 4px;background:#f0f1f2;color:#171717;font-family:inherit;font-size:14px;line-height:1.45;font-weight:500;overflow-wrap:anywhere;white-space:pre-wrap}
.wss-chat__message--visitor .wss-chat__bubble{border-radius:15px 15px 4px 15px;background:var(--wss-chat-brand);color:var(--wss-chat-on-brand)}
.wss-chat__meta{margin:4px 4px 0;color:#6b6b6b;font-family:inherit;font-size:10px;line-height:1.3;font-weight:600;letter-spacing:.02em}
#wss-chat-form{padding:10px 12px max(12px,env(safe-area-inset-bottom));border-top:1px solid #e8e8e8;background:#fff}
.wss-chat__compose{display:flex;align-items:flex-end;gap:8px}
#wss-chat-input{display:block;width:100%;min-height:44px;max-height:112px;resize:none;overflow:auto;border:1px solid #858585;border-radius:13px;padding:10px 11px;background:#fff;color:#171717;font-family:inherit;font-size:16px;line-height:1.35;font-weight:500;outline:0}
#wss-chat-input::placeholder{color:#6b6b6b;opacity:1}
#wss-chat-input:disabled{background:#f4f4f4;color:#4d4d4d}
#wss-chat-send{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border:0;border-radius:12px;padding:0;background:var(--wss-chat-brand);color:var(--wss-chat-on-brand);cursor:pointer}
#wss-chat-send svg{width:20px;height:20px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#wss-chat-send:disabled{cursor:not-allowed;opacity:.48}
#wss-chat-status{min-height:17px;margin:7px 3px 0;color:#5f5f5f;font-family:inherit;font-size:11px;line-height:1.4;font-weight:600}
#wss-chat-status[data-kind="error"]{color:#9f2525}
#wss-chat-root :focus-visible{outline:0;box-shadow:0 0 0 2px #fff,0 0 0 5px #000}
.wss-chat__sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
@keyframes wss-chat-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:480px){#wss-chat-root{right:max(10px,env(safe-area-inset-right));bottom:calc(max(10px,env(safe-area-inset-bottom)) + var(--wss-chat-clear) + var(--wss-chat-keyboard));width:54px;height:54px}#wss-chat-launcher{width:54px;height:54px}#wss-chat-panel{right:0;bottom:64px;width:calc(100vw - 20px);height:min(560px,calc(var(--wss-chat-vh) - var(--wss-chat-clear) - 88px));max-height:calc(var(--wss-chat-vh) - var(--wss-chat-clear) - 24px);border-radius:17px}.wss-chat__head{padding:12px 10px 11px 14px}#wss-chat-messages{padding:14px 12px 8px}#wss-chat-form{padding:9px 10px max(10px,env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){#wss-chat-root *,#wss-chat-root *::before,#wss-chat-root *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media print{#wss-chat-root{display:none!important}}
/* THE EXPERT LABEL — a visible "Chat" tag above the bubble so the trigger
   reads as an offer, not a passive icon. It sits in the right column above the
   launcher (never toward the floater on the left), and lifts with the root over
   the sticky call bar. Hidden while the panel is open. It carries an "AI" badge
   — the disclosure the owner allowed on the label — and never a presence dot,
   which would imply an availability this relay cannot promise. */
#wss-chat-cta{position:absolute;right:0;bottom:66px;display:flex;align-items:center;gap:9px;max-width:min(76vw,262px);padding:8px 13px 8px 9px;border:0;border-radius:15px 15px 5px 15px;background:var(--wss-chat-brand);color:var(--wss-chat-on-brand);box-shadow:0 12px 28px rgba(0,0,0,.28);cursor:pointer;pointer-events:auto;text-align:left;font-family:inherit;line-height:1.15;animation:wss-chat-cta-in .45s ease-out both;animation-delay:.9s;transition:transform .16s ease}
#wss-chat-cta:hover{transform:translateY(-1px)}
.wss-chat__cta-ai{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--wss-chat-on-brand) 20%,transparent);font-size:10px;font-weight:800;letter-spacing:.06em}
.wss-chat__cta-txt{display:flex;flex-direction:column;min-width:0}
.wss-chat__cta-strong{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wss-chat__cta-sub{font-size:11px;font-weight:500;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wss-chat-root[data-open="true"] #wss-chat-cta{display:none}
@keyframes wss-chat-cta-in{from{opacity:0;transform:translateY(7px) scale(.96)}to{opacity:1;transform:none}}
@media(max-width:480px){#wss-chat-cta{bottom:62px;gap:7px;padding:7px 11px 7px 7px;max-width:min(62vw,182px);border-radius:14px 14px 4px 14px}.wss-chat__cta-sub{display:none}}
`.trim();

// Written as a literal browser program so the donor needs no runtime and no
// framework. Keep it silent: mirror render verification treats console errors
// as build failures. Text reaches the DOM only through textContent.
const CHAT_WIDGET_SCRIPT = `(function(){
"use strict";
try{
var C=window.__WSS_CHAT__,root=document.getElementById("wss-chat-root");
if(!C||!root||!C.slug||!C.endpoints)return;
if(/[?&]wssthumb=1(?:&|$)/.test(location.search)){root.remove();return;}
var launcher=document.getElementById("wss-chat-launcher"),panel=document.getElementById("wss-chat-panel"),headClose=panel&&panel.querySelector(".wss-chat__head-close"),list=document.getElementById("wss-chat-messages"),form=document.getElementById("wss-chat-form"),input=document.getElementById("wss-chat-input"),send=document.getElementById("wss-chat-send"),status=document.getElementById("wss-chat-status"),cta=document.getElementById("wss-chat-cta");
if(!launcher||!panel||!headClose||!list||!form||!input||!send||!status)return;
window.__WSS_CHAT_WIDGET__="v1";
var askLabel=C.trade?("Chat with "+C.businessName+" — free "+C.trade+" advice from their AI assistant."):("Chat with "+C.businessName+" — free advice from their AI assistant.");
var OPEN_MS=${OPEN_POLL_MS},CLOSED_MS=${CLOSED_POLL_MS},IDLE_MS=${IDLE_STOP_MS};
var storeKey="wss_chat_visitor_v1:"+C.slug,session=null,cursor=0,timer=null,polling=false,sending=false,opened=false,lastActive=Date.now(),known={},empty=list.querySelector(".wss-chat__empty");

function cleanText(value,cap){return String(value==null?"":value).replace(/\\r\\n?/g,"\\n").trim().slice(0,cap||1200);}
function goodToken(value){return typeof value==="string"&&value.length>=20&&value.length<=2048&&!/\\s/.test(value);}
function readSession(){try{var raw=localStorage.getItem(storeKey);if(!raw)return null;var data=JSON.parse(raw);if(!data||!goodToken(data.token))return null;return{token:data.token,threadId:String(data.threadId||"")};}catch(e){return null;}}
function writeSession(data){session=data;try{localStorage.setItem(storeKey,JSON.stringify({token:data.token,threadId:data.threadId||"",updatedAt:Date.now()}));}catch(e){}}
function clearSession(){session=null;cursor=0;try{localStorage.removeItem(storeKey);}catch(e){}}
session=readSession();

function setStatus(text,kind){status.textContent=text||"";if(kind)status.setAttribute("data-kind",kind);else status.removeAttribute("data-kind");}
function markActive(){lastActive=Date.now();}
function atBottom(){return list.scrollHeight-list.scrollTop-list.clientHeight<72;}
function scrollEnd(){try{list.scrollTop=list.scrollHeight;}catch(e){}}
function addMessage(message){
  if(!message)return;
  var id=String(message.id==null?"":message.id),direction=message.direction==="outbound"?"outbound":"inbound",body=cleanText(message.body,direction==="outbound"?5000:2000);
  if(!body||(id&&known[id]))return;
  var follow=atBottom()||direction==="inbound";
  if(id)known[id]=true;
  if(empty&&empty.parentNode){empty.parentNode.removeChild(empty);empty=null;}
  var row=document.createElement("div");row.className="wss-chat__message "+(direction==="inbound"?"wss-chat__message--visitor":"wss-chat__message--business");
  if(id)row.setAttribute("data-message-id",id);
  var bubble=document.createElement("div");bubble.className="wss-chat__bubble";bubble.textContent=body;
  var meta=document.createElement("div");meta.className="wss-chat__meta";meta.textContent=direction==="inbound"?"You":C.businessName;
  row.appendChild(bubble);row.appendChild(meta);list.appendChild(row);
  if(/^\d{1,20}$/.test(id)){try{if(BigInt(id)>BigInt(cursor))cursor=id;}catch(e){cursor=id;}}
  if(follow)scrollEnd();
}
function addOwn(body,id){addMessage({id:id,direction:"inbound",body:body});}

function parseReply(response){return response.json().catch(function(){return{};}).then(function(data){if(!response.ok||!data||data.ok!==true){var err=new Error("request_failed");err.status=response.status;err.code=String(data&&data.error||"request_failed");throw err;}return data;});}
function request(url,options){
  var controller=null,abortTimer=null;
  try{controller=new AbortController();abortTimer=setTimeout(function(){try{controller.abort();}catch(e){}},10000);}catch(e){}
  var init=options||{};init.mode="cors";init.credentials="omit";init.cache="no-store";init.redirect="error";init.headers=init.headers||{};init.headers.Accept="application/json";if(controller)init.signal=controller.signal;
  return fetch(url,init).then(parseReply).finally(function(){if(abortTimer)clearTimeout(abortTimer);});
}
function tokenHeaders(withBody){var headers={"x-connect-visitor-token":session&&session.token||""};if(withBody)headers["Content-Type"]="application/json";return headers;}
function saveStarted(data){
  var token=String(data&&data.token||""),threadId=String(data&&data.threadId||"");
  if(!goodToken(token)||!threadId)throw new Error("invalid_session_response");
  writeSession({token:token,threadId:threadId});
}
function startChat(body){return request(C.endpoints.start,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:C.slug,body:body,website:""})}).then(function(data){saveStarted(data);addOwn(body,data.messageId);return data;});}
function postChat(body){return request(C.endpoints.post,{method:"POST",headers:tokenHeaders(true),body:JSON.stringify({body:body,website:""})}).then(function(data){addOwn(body,data.messageId);return data;});}
function errorText(err){if(navigator.onLine===false)return"You're offline. Your message is still here.";if(err&&err.status===429)return"Too many messages right now. Please wait and try again.";return"That did not send. Please try again.";}
function finishSend(body){if(input.value===body)input.value="";input.style.height="";setStatus("Sent · they'll be notified","");markActive();schedule(700);}
function submit(){
  var body=cleanText(input.value,1200);if(!body||sending)return;
  sending=true;send.disabled=true;input.disabled=true;form.setAttribute("data-state","sending");setStatus("Sending…","");
  var operation=session?postChat(body):startChat(body);
  operation.catch(function(err){
    if(session&&(err.status===401||err.status===404)){clearSession();return startChat(body);}
    throw err;
  }).then(function(){finishSend(body);}).catch(function(err){setStatus(errorText(err),"error");}).finally(function(){sending=false;send.disabled=false;input.disabled=false;form.removeAttribute("data-state");});
}

function stopTimer(){if(timer){clearTimeout(timer);timer=null;}}
function idle(){return Date.now()-lastActive>=IDLE_MS;}
function schedule(delay){
  stopTimer();if(!session)return;
  if(idle()){if(opened)setStatus("Refresh paused after 10 minutes. Open chat again to continue.","");return;}
  timer=setTimeout(poll,typeof delay==="number"?delay:(opened&&document.visibilityState!=="hidden"?OPEN_MS:CLOSED_MS));
}
function poll(){
  stopTimer();if(!session||polling)return;if(idle()){if(opened)setStatus("Refresh paused after 10 minutes. Open chat again to continue.","");return;}
  polling=true;
  request(C.endpoints.poll+"?after="+encodeURIComponent(String(cursor)),{method:"GET",headers:tokenHeaders(false)}).then(function(data){
    var messages=Array.isArray(data.messages)?data.messages.slice(0,200):[];
    for(var i=0;i<messages.length;i++)addMessage(messages[i]);
    var next=String(data.cursor==null?"":data.cursor);if(/^\d{1,20}$/.test(next)){try{if(BigInt(next)>BigInt(cursor))cursor=next;}catch(e){cursor=next;}}
    if(opened)setStatus(messages.length?"Replies are up to date.":"No new replies yet.","");
  }).catch(function(err){
    if(err&&(err.status===401||err.status===404)){clearSession();if(opened)setStatus("This chat expired. Send a new message to start again.","error");return;}
    if(opened)setStatus(navigator.onLine===false?"You're offline. Replies will refresh when you're back.":"Could not refresh replies. We’ll try again.","error");
  }).finally(function(){polling=false;schedule();});
}

function setOpen(next,returnFocus){
  opened=!!next;root.setAttribute("data-open",opened?"true":"false");launcher.setAttribute("aria-expanded",opened?"true":"false");launcher.setAttribute("aria-label",opened?("Close chat with "+C.businessName):askLabel);panel.hidden=!opened;markActive();
  if(opened){setStatus(session?"Checking for replies…":"Write a message to start.","");setTimeout(function(){try{panel.focus();scrollEnd();}catch(e){}},0);if(session)schedule(0);}
  else{if(returnFocus){try{launcher.focus();}catch(e){}}schedule();}
}
launcher.addEventListener("click",function(){setOpen(!opened,false);});
if(cta)cta.addEventListener("click",function(){setOpen(true,false);});
headClose.addEventListener("click",function(){setOpen(false,true);});
form.addEventListener("submit",function(event){event.preventDefault();markActive();submit();});
input.addEventListener("input",function(){markActive();this.style.height="auto";this.style.height=Math.min(this.scrollHeight,112)+"px";});
input.addEventListener("keydown",function(event){markActive();if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();submit();}});
panel.addEventListener("keydown",function(event){if(event.key==="Escape"){event.preventDefault();setOpen(false,true);}});
document.addEventListener("keydown",function(event){if(event.key==="Escape"&&opened){event.preventDefault();setOpen(false,true);}});

function resolveColor(){
  try{
    var probe=document.createElement("span"),rgb="",measured=C.brand&&String(C.brand.accent||C.brand.primary||"").trim();
    if(!/^#[0-9a-f]{6}$/i.test(measured))return;
    probe.style.cssText="position:absolute;visibility:hidden;pointer-events:none";document.body.appendChild(probe);
    probe.style.backgroundColor=measured;var got=getComputedStyle(probe).backgroundColor;if(/^rgba?\\(/i.test(got))rgb=got;
    if(probe.parentNode)probe.parentNode.removeChild(probe);if(!rgb)return;
    var nums=rgb.match(/[\\d.]+/g);if(!nums||nums.length<3)return;var values=[Number(nums[0]),Number(nums[1]),Number(nums[2])];
    function lin(value){value=value/255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);}
    var light=.2126*lin(values[0])+.7152*lin(values[1])+.0722*lin(values[2]),white=1.05/(light+.05),dark=(light+.05)/.05,on=white>=dark?"#fff":"#000";
    root.style.setProperty("--wss-chat-brand",rgb);root.style.setProperty("--wss-chat-on-brand",on);
  }catch(e){}
}
function measureViewport(){try{var viewport=window.visualViewport,vh=viewport?viewport.height:window.innerHeight,inset=viewport?Math.max(0,window.innerHeight-(viewport.height+viewport.offsetTop)):0;root.style.setProperty("--wss-chat-vh",Math.max(240,vh)+"px");root.style.setProperty("--wss-chat-keyboard",Math.round(inset)+"px");}catch(e){}}
function syncOverlay(){try{var blocker=document.querySelector('[aria-modal="true"]:not(#wss-chat-panel)'),scrim=document.querySelector("#wss-"+"scrim.on"),hidden=false;if(blocker&&!root.contains(blocker)){var bs=getComputedStyle(blocker),br=blocker.getBoundingClientRect();hidden=bs.display!=="none"&&bs.visibility!=="hidden"&&br.width>0&&br.height>0;}if(scrim)hidden=true;root.style.visibility=hidden?"hidden":"";if(hidden)root.setAttribute("aria-hidden","true");else root.removeAttribute("aria-hidden");}catch(e){}}
var measureTimer=null,trailingTimer=null;
function measureObstruction(){
  measureTimer=null;
  try{
    var viewport=window.visualViewport,vh=viewport?viewport.height:window.innerHeight,vw=viewport?viewport.width:window.innerWidth,clear=0,candidates=[],xs=[vw-12,vw-56,vw-120,vw-220,vw-360],ys=[vh-2,vh-18,vh-42,vh-72,vh-108,vh-156];
    function collect(x,y){if(x<0||y<0||!document.elementsFromPoint)return;var stack=document.elementsFromPoint(x,y);for(var i=0;i<stack.length;i++){var node=stack[i];while(node&&node!==document.body&&!root.contains(node)){if(candidates.indexOf(node)<0)candidates.push(node);node=node.parentElement;}}}
    for(var xi=0;xi<xs.length;xi++)for(var yi=0;yi<ys.length;yi++)collect(xs[xi],ys[yi]);
    for(var i=0;i<candidates.length;i++){var el=candidates[i],id=el.id;if(id==="wss-"+"floater"||id==="wss-"+"scrim"||id==="wss-"+"pill")continue;if(el.hasAttribute&&el.hasAttribute("data-wss-theme-toggle"))continue;var style=getComputedStyle(el);if(style.position!=="fixed"&&style.position!=="sticky")continue;if(style.display==="none"||style.visibility==="hidden"||style.pointerEvents==="none")continue;var rect=el.getBoundingClientRect();if(rect.width<44||rect.height<24||rect.top>=vh||rect.bottom<vh-28)continue;if(rect.right<vw-Math.min(vw,420))continue;clear=Math.max(clear,vh-rect.top+12);}
    clear=Math.min(clear,Math.min(240,vh*.36));root.style.setProperty("--wss-chat-clear",Math.max(0,Math.round(clear))+"px");
    /* The clear is also published on the document root (audit A2, S5): the
       theme toggle rides this same lift so the bottom-right fixed stack
       (toggle above launcher) moves as one column instead of overlapping
       whenever a donor parks its own chrome in this corner. */
    try{document.documentElement.style.setProperty("--wss-chat-clear",Math.max(0,Math.round(clear))+"px");}catch(e){}
    measureViewport();syncOverlay();
  }catch(e){}
}
function queueMeasure(){if(measureTimer)clearTimeout(measureTimer);measureTimer=setTimeout(measureObstruction,80);}
function queueTrailingMeasure(){queueMeasure();if(trailingTimer)clearTimeout(trailingTimer);trailingTimer=setTimeout(measureObstruction,280);}
resolveColor();measureViewport();queueMeasure();setTimeout(queueMeasure,900);setTimeout(queueMeasure,2200);
window.addEventListener("resize",queueTrailingMeasure,{passive:true});window.addEventListener("scroll",queueTrailingMeasure,{passive:true});document.addEventListener("scroll",queueTrailingMeasure,true);if(window.visualViewport){window.visualViewport.addEventListener("resize",queueTrailingMeasure,{passive:true});window.visualViewport.addEventListener("scroll",queueTrailingMeasure,{passive:true});}
try{var host=document.getElementById("root")||document.getElementById("app")||document.body;var observer=new MutationObserver(function(records){for(var i=0;i<records.length;i++){if(!root.contains(records[i].target)){queueTrailingMeasure();return;}}});observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style","hidden","aria-hidden"]});}catch(e){}
document.addEventListener("visibilitychange",function(){schedule();});
window.addEventListener("offline",function(){if(opened)setStatus("You're offline. Replies will refresh when you're back.","error");});
window.addEventListener("online",function(){if(opened)setStatus("Back online. Checking for replies…","");markActive();schedule(0);});
if(typeof fetch!=="function"){input.disabled=true;send.disabled=true;setStatus("Chat is unavailable in this browser.","error");return;}
if(session)schedule(500);
}catch(e){}
})();`;

function resolveChatWidgetConfig({ facts = {}, slug = "", brand = {}, trade = "" } = {}) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(cleanSlug)) {
    return { ok: false, config: null, reason: "no_site_slug_to_route_chat_to" };
  }
  const businessName = String(facts.business_name || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!businessName) {
    return { ok: false, config: null, reason: "no_verified_business_name_for_chat" };
  }
  const accent = /^#[0-9a-f]{6}$/i.test(String(brand.accent || "").trim())
    ? String(brand.accent).trim().toLowerCase()
    : "";
  const primary = /^#[0-9a-f]{6}$/i.test(String(brand.primary || "").trim())
    ? String(brand.primary).trim().toLowerCase()
    : "";
  // The trade frames Riley as an expert on the trigger ("free HVAC advice").
  // tradeLabel already display-cases it upstream; kept verbatim, empty is fine
  // and the copy falls back to "advice".
  const tradeName = String(trade || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return {
    ok: true,
    reason: "",
    config: {
      version: "wss-chat-v1",
      slug: cleanSlug,
      businessName,
      ...(tradeName ? { trade: tradeName } : {}),
      brand: { ...(accent ? { accent } : {}), ...(primary ? { primary } : {}) },
      endpoints: DEFAULT_ENDPOINTS,
    },
  };
}

function buildChatWidget(config) {
  if (!config || !config.slug || !config.businessName || !config.endpoints) return "";
  const businessName = esc(config.businessName);
  // CHAT TRIGGER (owner, 2026-08-14): the visible trigger button reads "Chat"
  // for now — the panel identity still explains Riley in full. The launcher's
  // accessible name describes opening a chat with the business's AI assistant
  // (no "Ask Riley" on the trigger), still disclosing AI (SB 243).
  const tradeAdvice = config.trade ? `free ${esc(config.trade)} advice` : "free advice";
  const askAria = `Chat with ${businessName} — ${tradeAdvice} from their AI assistant.`;
  const emptyMsg = config.trade
    ? `Ask Riley anything about ${esc(config.trade)} — type your question below.`
    : "Ask Riley a question to start.";
  const cta = `<button id="wss-chat-cta" class="wss-chat__cta" type="button" aria-hidden="true" tabindex="-1">`
    + `<span class="wss-chat__cta-ai" aria-hidden="true">AI</span>`
    + `<span class="wss-chat__cta-txt"><span class="wss-chat__cta-strong">Chat</span>`
    + `<span class="wss-chat__cta-sub">${config.trade ? `Free ${esc(config.trade)} advice` : "Free advice"}</span></span></button>`;
  return `<style id="wss-chat-css">${CHAT_WIDGET_CSS}</style>`
    + `<div id="wss-chat-root" data-wss-chat="v1" data-open="false">`
    + `<section id="wss-chat-panel" role="dialog" aria-modal="false" aria-labelledby="wss-chat-title" tabindex="-1" hidden>`
    + `<header class="wss-chat__head"><div class="wss-chat__identity"><h2 id="wss-chat-title">Ask Riley</h2><p>Riley is ${businessName}'s AI assistant. Ask a question — the team or Riley replies here.</p></div>`
    + `<button class="wss-chat__head-close" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>`
    + `<div id="wss-chat-messages" role="log" aria-live="polite" aria-relevant="additions text"><p class="wss-chat__empty">${emptyMsg}</p></div>`
    + `<form id="wss-chat-form" novalidate><div class="wss-chat__compose"><label class="wss-chat__sr" for="wss-chat-input">Your message</label>`
    + `<textarea id="wss-chat-input" rows="1" maxlength="1200" enterkeyhint="send" autocomplete="off" placeholder="Ask Riley…" required></textarea>`
    + `<button id="wss-chat-send" type="submit" aria-label="Send message"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg></button></div>`
    + `<div id="wss-chat-status" role="status" aria-live="polite">Ask Riley a question to start.</div></form></section>`
    + `<button id="wss-chat-launcher" type="button" aria-label="${askAria}" aria-controls="wss-chat-panel" aria-expanded="false">`
    + `<svg class="wss-chat__bubble-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.6V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v7Z"/></svg>`
    + `<svg class="wss-chat__close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>${cta}</div>`
    + `<script id="wss-chat-config" type="application/json">${jsonEsc(config)}</script>`
    + `<script>try{var e=document.getElementById("wss-chat-config");if(e)window.__WSS_CHAT__=JSON.parse(e.textContent)}catch(x){}</script>`
    + `<script>${CHAT_WIDGET_SCRIPT}</script>`;
}

module.exports = {
  DEFAULT_ENDPOINTS,
  OPEN_POLL_MS,
  CLOSED_POLL_MS,
  IDLE_STOP_MS,
  CHAT_WIDGET_CSS,
  CHAT_WIDGET_SCRIPT,
  resolveChatWidgetConfig,
  buildChatWidget,
};
