const CACHE_NAME = "wss-labs-shell-v8";
const SHELL = [
  "/","/intake","/products","/managed-website","/answercrew","/activate","/legal","/offline.html","/site.css","/site.js",
  "/assets/wss-mark.svg","/assets/wss-og.png","/assets/answercrew-mark.svg","/assets/fonts/instrument-sans-latin.woff2","/assets/fonts/martian-mono-latin.woff2","/assets/icon-192.png",
  "/assets/dashboard-enhance.css","/assets/dashboard-enhance.js"
];
self.addEventListener("install",(event)=>{event.waitUntil(caches.open(CACHE_NAME).then((cache)=>Promise.all(SHELL.map((url)=>cache.add(url).catch(()=>undefined)))));self.skipWaiting();});
self.addEventListener("activate",(event)=>{event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key)))));self.clients.claim();});

const NEVER_CACHE=[/^\/console(\/|$)/,/^\/line(\/|$)/,/^\/api\//];
const DASHBOARD_NAV=[/^\/dashboard(\/|$)/,/^\/customer\/dashboard(\/|$)/];

function widenDashboardUploads(html){
  let body=String(html||"");
  body=body.replace(
    'accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"',
    'accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,.docx,.txt,.md,.html,.htm,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,.svg,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg"'
  );
  const oldBlock='var isPdf=type==="application/pdf";\n    if(!isImage&&!isPdf){ chatError("We can take photos (JPEG, PNG, GIF or WebP) and PDFs."); return; }';
  const newBlock='var isPdf=type==="application/pdf";\n    var isRich=/\\.(svg|docx|txt|md|html?|mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(String(file.name||""));\n    if(!isImage&&!isPdf&&!isRich){ chatError("Use an image, SVG, PDF, DOCX, TXT, Markdown, HTML, video or audio file."); return; }';
  if(body.includes(oldBlock))body=body.replace(oldBlock,newBlock);
  return body;
}

async function enhanceDashboardResponse(response){
  if(!response||!response.ok)return response;
  const type=String(response.headers.get("content-type")||"");if(!/text\/html/i.test(type))return response;
  let html=await response.text();if(!/<\/head>/i.test(html)||!/<\/body>/i.test(html))return new Response(html,response);
  html=widenDashboardUploads(html);
  const marker='data-wss-dashboard-enhancement="v2"';
  if(!html.includes(marker)){
    const css=`<link rel="stylesheet" href="/assets/dashboard-enhance.css?v=2" ${marker}>`;
    const js=`<script src="/assets/dashboard-enhance.js?v=2" defer ${marker}></script>`;
    html=html.replace(/<\/head>/i,`${css}</head>`).replace(/<\/body>/i,`${js}</body>`);
  }
  const headers=new Headers(response.headers);headers.delete("content-length");headers.delete("content-encoding");headers.set("cache-control","no-store");
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener("fetch",(event)=>{
  const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(request.mode==="navigate"&&DASHBOARD_NAV.some((re)=>re.test(url.pathname))){event.respondWith(fetch(request).then(enhanceDashboardResponse).catch(()=>caches.match("/offline.html")));return;}
  if(NEVER_CACHE.some((re)=>re.test(url.pathname)))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).then((response)=>{const copy=response.clone();caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy));return response;}).catch(()=>caches.match(request).then((cached)=>cached||caches.match("/offline.html"))));return;
  }
  event.respondWith(caches.match(request).then((cached)=>cached||fetch(request)));
});

const DASHBOARD_PATH="/dashboard";
function pushText(value,max){return String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);}
function pushThreadId(value){const text=String(value==null?"":value).trim();return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text)?text:"";}
function threadDestination(threadId){return threadId?`${DASHBOARD_PATH}#thread=${encodeURIComponent(threadId)}`:DASHBOARD_PATH;}
self.addEventListener("push",(event)=>{
  let payload={};if(event.data){try{payload=event.data.json()||{};}catch(_){payload={body:event.data.text()};}}
  const title=pushText(payload.title,80)||"New lead in your Command Center";const body=pushText(payload.body,120)||"Open your Command Center to read it.";const threadId=pushThreadId(payload.threadId);
  event.waitUntil(self.registration.showNotification(title,{body,icon:"/assets/icon-192.png",badge:"/assets/icon-192.png",tag:threadId?`wss-lead-${threadId}`:"wss-lead",renotify:Boolean(threadId),data:{threadId,destination:threadDestination(threadId)}}));
});
self.addEventListener("notificationclick",(event)=>{
  event.notification.close();const data=event.notification.data||{};const threadId=pushThreadId(data.threadId);const target=new URL(threadDestination(threadId),self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async(windows)=>{
    const open=windows.find((client)=>{try{return new URL(client.url).pathname.startsWith(DASHBOARD_PATH);}catch(_){return false;}});
    if(open){if("navigate" in open){const navigated=await open.navigate(target).catch(()=>null);if(navigated)return navigated.focus();}return open.focus();}
    return self.clients.openWindow(target);
  }));
});
