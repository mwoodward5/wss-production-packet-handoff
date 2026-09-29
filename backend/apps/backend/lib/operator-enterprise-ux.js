"use strict";

/**
 * Shared enterprise UX hardening for the server-rendered operator suite.
 *
 * The stylesheet fixes the typography and container defects once, after each
 * page's own rules. The script is deliberately gallery-only. It wraps the
 * gallery data response before the page consumes it, which lets the existing
 * renderer keep ownership of search, tabs, proof-email safety, pagination and
 * liveness while adding operator filters and reversible management actions.
 */

const OPERATOR_ENTERPRISE_STYLE = String.raw`<style id="wss-operator-enterprise-ux">
:root{
  --wss-copy:clamp(15.5px,.82vw,17px);
  --wss-control:clamp(15px,.78vw,16.5px);
  --wss-label:clamp(13.5px,.7vw,15px);
  --wss-name:clamp(18px,1.05vw,22px);
}
html{max-width:100%;overflow-x:hidden}
body,main,section,article,aside,header,footer,form,fieldset{min-width:0}
.shell,.wrap,.grid,.launch,.controls,.gallery{min-width:0;max-width:100%}
.grid{grid-template-columns:repeat(12,minmax(0,1fr))!important}
.grid>*,.launch>*,.controls>*,.gallery>*,.panel,.card,.pane,.rail,.table-card,.table-panel{min-width:0;max-width:100%}
.launch{grid-template-columns:repeat(12,minmax(0,1fr))!important}
.launch-note{grid-column:1/-1!important;max-width:100%!important;overflow-wrap:anywhere}
table{width:100%;max-width:100%;table-layout:auto}
.table-wrap,.table-scroll,.table-shell,.ledger-table,.rows-wrap,.data-table,.responsive-table{
  width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch
}
td,th{overflow-wrap:anywhere}
input,select,textarea,button{max-width:100%}
.business-name,.site-name,.camp-name,.campaign-name,.call-name,.identity strong{
  font-size:var(--wss-name)!important;line-height:1.28!important
}
.metadata,.card-sent,.status,.details-button,.menu-item,.batch-plain,.batch-go,
.confirm-row,.confirm-summary,.drawer-sub,.row,.note,.saved-note p,.send-why,
.send-button,.access-card p,.load-more,.retry{
  font-size:var(--wss-control)!important;line-height:1.5!important
}
.eyebrow,.readonly,.catalog-note,.result-note,.archive-control,.sort-label,
.tab-count,.status,.block h3,.when,.saved-note span,.load-hint{
  font-size:var(--wss-label)!important;line-height:1.4!important
}
.controls{
  grid-template-columns:auto minmax(260px,1.4fr) minmax(170px,auto) minmax(180px,auto)!important;
  align-items:end!important
}
.gallery{
  grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))!important;
  gap:20px!important
}
.site-card{min-width:0}
.card-body{padding:20px!important}
.card-heading{gap:14px!important}
.card-foot{flex-wrap:wrap}
.status{white-space:normal!important;text-align:left}
.menu-panel{width:min(250px,calc(100vw - 32px))!important}
.wss-gallery-filters{
  grid-column:1/-1;
  display:grid;
  grid-template-columns:repeat(4,minmax(150px,1fr)) auto minmax(190px,auto);
  align-items:end;
  gap:12px;
  padding-top:14px;
  border-top:1px solid rgba(255,255,255,.08)
}
.wss-filter-field{display:grid;gap:7px}
.wss-filter-field span{
  color:#B7B6C0;
  font:700 var(--wss-label)/1.2 'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif
}
.wss-filter-field select{
  width:100%;height:46px;padding:0 38px 0 13px;border:1px solid rgba(255,255,255,.11);
  border-radius:10px;background:#08080B;color:#F2F2F5;font-size:var(--wss-control)
}
.wss-filter-reset{
  min-height:46px;padding:0 15px;border:1px solid rgba(255,255,255,.12);border-radius:10px;
  background:transparent;color:#F2F2F5;font-size:var(--wss-control);font-weight:700;cursor:pointer
}
.wss-filter-reset:hover{border-color:rgba(124,108,246,.62);background:rgba(124,108,246,.08)}
.wss-filter-summary{
  align-self:center;margin:0;color:#B7B6C0;font-size:var(--wss-control);line-height:1.4;text-align:right
}
.wss-card-actions{
  position:relative;z-index:5;display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr) auto;
  align-items:center;gap:8px;padding:0 18px 18px
}
.wss-manage-select{
  display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 10px;border:1px solid rgba(255,255,255,.1);
  border-radius:9px;background:#17171D;color:#D7D6DE;font-size:var(--wss-label);font-weight:700;cursor:pointer
}
.wss-manage-select input{width:18px;height:18px;margin:0;accent-color:#7C6CF6}
.wss-card-action{
  min-height:42px;display:inline-flex;align-items:center;justify-content:center;padding:0 11px;
  border:1px solid rgba(255,255,255,.11);border-radius:9px;background:#17171D;color:#F2F2F5;
  font-size:var(--wss-control);font-weight:750;line-height:1.15;text-align:center;text-decoration:none;cursor:pointer
}
.wss-card-action:hover{border-color:rgba(124,108,246,.65);background:rgba(124,108,246,.1)}
.wss-card-action.danger{color:#FFABAB}
.wss-card-action.restore{color:#72E4B8}
.site-card.wss-manage-picked{border-color:rgba(124,108,246,.85)!important;box-shadow:0 0 0 1px rgba(124,108,246,.25)}
.wss-manage-bar{
  position:fixed;z-index:58;left:50%;bottom:18px;width:min(1120px,calc(100vw - 24px));
  display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:14px 16px;
  border:1px solid rgba(124,108,246,.5);border-radius:15px;background:rgba(19,19,24,.98);
  box-shadow:0 24px 70px rgba(0,0,0,.58);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  transform:translateX(-50%)
}
.wss-manage-bar[hidden]{display:none!important}
.wss-manage-summary{flex:1 1 250px;min-width:0}
.wss-manage-summary strong{display:block;font-size:var(--wss-control);line-height:1.25}
.wss-manage-summary span{display:block;margin-top:3px;color:#B7B6C0;font-size:var(--wss-label);line-height:1.4}
.wss-manage-button{
  min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.13);border-radius:9px;
  background:transparent;color:#F2F2F5;font-size:var(--wss-control);font-weight:750;white-space:nowrap;cursor:pointer
}
.wss-manage-button:hover:not(:disabled){border-color:rgba(124,108,246,.65);background:rgba(124,108,246,.1)}
.wss-manage-button.primary{border:0;background:linear-gradient(135deg,#4A6CF7,#8B5CF6)}
.wss-manage-button.danger{color:#FFABAB}
.wss-manage-button:disabled{opacity:.42;cursor:not-allowed}
.wss-action-scrim{
  position:fixed;z-index:92;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,8,11,.8);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)
}
.wss-action-scrim[hidden]{display:none!important}
.wss-action-dialog{
  width:min(560px,100%);max-height:min(82vh,720px);display:flex;flex-direction:column;padding:24px;
  border:1px solid rgba(255,255,255,.13);border-radius:18px;background:#131318;box-shadow:0 32px 90px rgba(0,0,0,.62)
}
.wss-action-dialog h2{margin:0;font-size:clamp(22px,2.2vw,30px);line-height:1.15}
.wss-action-dialog p{margin:11px 0 0;color:#B7B6C0;font-size:var(--wss-copy);line-height:1.55}
.wss-action-list{overflow:auto;margin:15px 0 0;padding:0;list-style:none;border-top:1px solid rgba(255,255,255,.08)}
.wss-action-list li{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:var(--wss-control);line-height:1.35}
.wss-action-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px}
.wss-action-foot button{
  min-height:44px;padding:0 16px;border-radius:10px;font-size:var(--wss-control);font-weight:800;cursor:pointer
}
.wss-dialog-cancel{border:1px solid rgba(255,255,255,.13);background:transparent;color:#F2F2F5}
.wss-dialog-confirm{border:0;background:linear-gradient(135deg,#4A6CF7,#8B5CF6);color:#fff}
.wss-dialog-confirm.danger{background:#9B3F48}
.wss-enterprise-toast{
  position:fixed;z-index:100;right:20px;bottom:20px;max-width:min(520px,calc(100vw - 40px));
  padding:13px 16px;border:1px solid rgba(52,211,153,.36);border-radius:11px;background:#131318;
  color:#7DE6BB;font-size:var(--wss-control);font-weight:700;line-height:1.45;box-shadow:0 18px 50px rgba(0,0,0,.48)
}
.wss-enterprise-toast.bad{border-color:rgba(242,109,109,.4);color:#FFABAB}
body.wss-managing .batch-bar{bottom:96px}
body.wss-managing .copy-status{bottom:150px}
@media(min-width:1500px){
  .gallery{grid-template-columns:repeat(4,minmax(0,1fr))!important}
}
@media(max-width:1180px){
  .controls{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .tabs,.wss-gallery-filters{grid-column:1/-1}
  .wss-gallery-filters{grid-template-columns:repeat(2,minmax(180px,1fr)) auto}
  .wss-filter-summary{grid-column:1/-1;text-align:left}
  .grid{grid-auto-flow:row}
}
@media(max-width:900px){
  :root{--wss-copy:15.5px;--wss-control:15px;--wss-label:13.5px;--wss-name:18px}
  .shell,.wrap{max-width:100%!important;padding-left:18px!important;padding-right:18px!important}
  table{display:block;overflow-x:auto;white-space:nowrap}
  .wss-card-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
  .wss-manage-select{justify-content:center}
}
@media(max-width:760px){
  .controls{grid-template-columns:1fr!important}
  .wss-gallery-filters{grid-template-columns:1fr}
  .wss-filter-reset{width:100%}
  .gallery{grid-template-columns:1fr!important}
  .wss-card-actions{grid-template-columns:1fr 1fr;padding:0 15px 16px}
  .wss-manage-bar{bottom:10px;width:calc(100vw - 20px);padding:12px}
  .wss-manage-summary{flex-basis:100%}
  .wss-manage-button{flex:1 1 calc(50% - 6px);white-space:normal}
}
@media(max-width:430px){
  .wss-card-actions{grid-template-columns:1fr}
  .wss-action-dialog{padding:19px}
  .wss-action-foot button{flex:1 1 auto}
}
@media print{
  .wss-gallery-filters,.wss-card-actions,.wss-manage-bar,.wss-action-scrim,.wss-enterprise-toast{display:none!important}
}
</style>`;

const OPERATOR_ENTERPRISE_SCRIPT = String.raw`<script id="wss-gallery-enterprise-ux">
(function(){
  "use strict";
  var path=String(window.location&&window.location.pathname||"").replace(/\/+$/,"")||"/";
  if(path!=="/gallery")return;
  var nativeFetch=window.fetch&&window.fetch.bind(window);
  if(!nativeFetch)return;

  var rowsById=Object.create(null);
  var facetData={trades:[],statuses:[],campaigns:[],total:0};
  var selected=Object.create(null);
  var busy=false;
  var toastTimer=null;
  var filterState=readFilters();

  function text(value){return String(value==null?"":value).trim();}
  function lower(value){return text(value).toLowerCase();}
  function idOf(row){return text(row&&row.prospectId);}
  function safeUrl(value){
    try{
      var parsed=new URL(text(value),window.location.origin);
      return parsed.protocol==="http:"||parsed.protocol==="https:"?parsed.href:"";
    }catch(_){return "";}
  }
  function human(value){
    var raw=text(value).replace(/[_-]+/g," ");
    return raw.replace(/\b\w/g,function(letter){return letter.toUpperCase();});
  }
  function tradeLabel(value){
    return human(value).replace(/\bHvac\b/g,"HVAC").replace(/\bLlc\b/g,"LLC");
  }
  function readFilters(){
    try{
      var params=new URLSearchParams(window.location.search);
      return {
        trade:lower(params.get("trade")),
        status:lower(params.get("status")),
        campaign:lower(params.get("campaign")),
        age:text(params.get("age"))
      };
    }catch(_){return {trade:"",status:"",campaign:"",age:""};}
  }
  function isGalleryData(input){
    var value=typeof input==="string"?input:(input&&input.url);
    return /\/api\/admin\/gallery-data(?:[?#]|$)/.test(String(value||""));
  }
  function uniqueOptions(rows,key,labeler){
    var map=Object.create(null);
    (rows||[]).forEach(function(row){
      var raw=text(row&&row[key]);
      var value=lower(raw);
      if(!value||map[value])return;
      map[value]={value:value,label:labeler?labeler(raw):raw};
    });
    return Object.keys(map).map(function(key_){return map[key_];}).sort(function(a,b){return a.label.localeCompare(b.label);});
  }
  function matchesFilters(row){
    if(filterState.trade&&lower(row&&row.vertical)!==filterState.trade)return false;
    if(filterState.status&&lower(row&&row.status)!==filterState.status)return false;
    if(filterState.campaign&&lower(row&&row.campaign)!==filterState.campaign)return false;
    var days=Number.parseInt(filterState.age,10);
    if(Number.isFinite(days)&&days>0){
      var when=Date.parse(text(row&&row.updatedAt));
      if(!Number.isFinite(when)||Date.now()-when>days*24*60*60*1000)return false;
    }
    return true;
  }
  function preparePayload(payload){
    if(!payload||typeof payload!=="object")return payload;
    var builds=Array.isArray(payload.builds)?payload.builds:[];
    var clients=Array.isArray(payload.clients)?payload.clients:[];
    rowsById=Object.create(null);
    builds.concat(clients).forEach(function(row){
      var id=idOf(row);
      if(id&&!rowsById[id])rowsById[id]=row;
    });
    facetData={
      trades:uniqueOptions(builds,"vertical",tradeLabel),
      statuses:uniqueOptions(builds,"status",human),
      campaigns:uniqueOptions(builds,"campaign",human),
      total:builds.length
    };
    window.__wssGalleryFacetData=facetData;
    window.__wssGalleryRowsById=rowsById;
    window.setTimeout(function(){
      try{window.dispatchEvent(new CustomEvent("wss:gallery-data",{detail:facetData}));}catch(_){}
    },0);
    var next=Object.assign({},payload);
    next.builds=builds.filter(matchesFilters);
    next.clients=clients.filter(matchesFilters);
    return next;
  }

  window.fetch=function(input,init){
    return nativeFetch(input,init).then(function(response){
      if(!isGalleryData(input)||!response||!response.ok||typeof response.clone!=="function")return response;
      return response.clone().json().then(function(payload){
        var next=preparePayload(payload);
        if(typeof Response!=="function")return response;
        var headers;
        try{
          headers=new Headers(response.headers);
          headers.set("content-type","application/json; charset=utf-8");
          headers.delete("content-length");
        }catch(_){headers=response.headers;}
        return new Response(JSON.stringify(next),{
          status:response.status,
          statusText:response.statusText,
          headers:headers
        });
      }).catch(function(){return response;});
    });
  };

  function leadingText(node,value){
    if(!node)return;
    var child=Array.prototype.find.call(node.childNodes,function(entry){return entry.nodeType===3;});
    if(child)child.nodeValue=value+" ";
  }
  function replaceMenuTemplate(id,label){
    var template=document.getElementById(id);
    var item=template&&template.content&&template.content.firstElementChild;
    if(!item)return;
    Array.prototype.slice.call(item.childNodes).forEach(function(node){
      if(node.nodeType===3&&text(node.nodeValue))node.nodeValue=label;
    });
  }
  function option(select,value,label){
    var node=document.createElement("option");
    node.value=value;
    node.textContent=label;
    select.appendChild(node);
  }
  function field(labelText,id){
    var label=document.createElement("label");
    label.className="wss-filter-field";
    label.setAttribute("for",id);
    var span=document.createElement("span");
    span.textContent=labelText;
    var select=document.createElement("select");
    select.id=id;
    select.setAttribute("aria-label",labelText);
    label.appendChild(span);
    label.appendChild(select);
    return {label:label,select:select};
  }
  function writeFilter(name,value){
    try{
      var url=new URL(window.location.href);
      if(value)url.searchParams.set(name,value);
      else url.searchParams.delete(name);
      window.location.assign(url.href);
    }catch(_){}
  }
  function activeFilterCount(){
    return ["trade","status","campaign","age"].filter(function(key){return Boolean(filterState[key]);}).length;
  }
  function populateSelect(select,items,first,current){
    while(select.firstChild)select.removeChild(select.firstChild);
    option(select,"",first);
    (items||[]).forEach(function(item){option(select,item.value,item.label);});
    select.value=current||"";
  }
  function buildFilters(){
    var controls=document.querySelector(".controls");
    if(!controls||document.getElementById("wssGalleryFilters"))return;
    var wrap=document.createElement("div");
    wrap.className="wss-gallery-filters";
    wrap.id="wssGalleryFilters";
    wrap.setAttribute("aria-label","Website filters");

    var trade=field("Trade","wssTradeFilter");
    var status=field("Status","wssStatusFilter");
    var date=field("Date updated","wssDateFilter");
    var campaign=field("Campaign","wssCampaignFilter");
    var reset=document.createElement("button");
    reset.type="button";
    reset.className="wss-filter-reset";
    reset.textContent="Clear filters";
    var summary=document.createElement("p");
    summary.className="wss-filter-summary";
    summary.id="wssFilterSummary";
    summary.setAttribute("aria-live","polite");

    populateSelect(date.select,[
      {value:"7",label:"Past 7 days"},
      {value:"30",label:"Past 30 days"},
      {value:"90",label:"Past 90 days"}
    ],"Any date",filterState.age);

    function paint(data){
      data=data||facetData;
      populateSelect(trade.select,data.trades,"All trades",filterState.trade);
      populateSelect(status.select,data.statuses,"All statuses",filterState.status);
      populateSelect(campaign.select,data.campaigns,"All campaigns",filterState.campaign);
      var count=activeFilterCount();
      summary.textContent=count
        ? count+" filter"+(count===1?"":"s")+" active across "+Number(data.total||0).toLocaleString()+" websites."
        : Number(data.total||0).toLocaleString()+" websites available.";
    }

    trade.select.addEventListener("change",function(){writeFilter("trade",trade.select.value);});
    status.select.addEventListener("change",function(){writeFilter("status",status.select.value);});
    date.select.addEventListener("change",function(){writeFilter("age",date.select.value);});
    campaign.select.addEventListener("change",function(){writeFilter("campaign",campaign.select.value);});
    reset.addEventListener("click",function(){
      try{
        var url=new URL(window.location.href);
        ["trade","status","campaign","age"].forEach(function(key){url.searchParams.delete(key);});
        window.location.assign(url.href);
      }catch(_){}
    });

    wrap.appendChild(trade.label);
    wrap.appendChild(status.label);
    wrap.appendChild(date.label);
    wrap.appendChild(campaign.label);
    wrap.appendChild(reset);
    wrap.appendChild(summary);
    controls.appendChild(wrap);
    paint(window.__wssGalleryFacetData||facetData);
    window.addEventListener("wss:gallery-data",function(event){paint(event&&event.detail);});
  }

  function plainLanguage(){
    leadingText(document.getElementById("clientsTab"),"Customers");
    leadingText(document.getElementById("buildsTab"),"Websites");
    var search=document.getElementById("searchInput");
    if(search){
      search.placeholder="Search business, city, or trade";
      search.setAttribute("aria-label","Search websites by business name, city, or trade");
    }
    var vertical=document.querySelector('#sortSelect option[value="vertical"]');
    if(vertical)vertical.textContent="Trade";
    var archive=document.querySelector("#archiveControl span");
    leadingText(archive,"Show archived websites");
    var catalog=document.querySelector(".catalog-note");
    if(catalog)catalog.textContent="Live website records";
    var introTitle=document.getElementById("galleryTitle");
    if(introTitle)introTitle.textContent="Your website gallery.";
    var intro=document.querySelector(".intro-copy > p:not(.intro-send)");
    if(intro)intro.textContent="Open a live site, review or edit its notes, rebuild it, archive it, or select several websites for safe batch work. Proof emails on this page still go only to your own inbox.";
    replaceMenuTemplate("copyIdTemplate","Copy reference number");
    replaceMenuTemplate("detailsTemplate","Edit notes and details");
  }

  function notify(message,bad){
    var node=document.getElementById("wssEnterpriseToast");
    if(!node){
      node=document.createElement("div");
      node.id="wssEnterpriseToast";
      node.className="wss-enterprise-toast";
      node.setAttribute("role","status");
      node.setAttribute("aria-live","polite");
      document.body.appendChild(node);
    }
    window.clearTimeout(toastTimer);
    node.classList.toggle("bad",bad===true);
    node.textContent=message;
    node.hidden=false;
    toastTimer=window.setTimeout(function(){node.hidden=true;},4200);
  }
  function token(){
    try{return localStorage.getItem("wsl_admin_token")||"";}catch(_){return "";}
  }
  function adminRequest(path_,body){
    var adminToken=token();
    if(!adminToken)return Promise.reject(new Error("Operator token required."));
    return nativeFetch(path_,{
      method:"POST",
      cache:"no-store",
      headers:{"Content-Type":"application/json","x-admin-token":adminToken},
      body:JSON.stringify(body||{})
    }).then(function(response){
      return response.text().then(function(raw){
        var payload={};
        try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
        if(!response.ok||payload.ok===false){
          throw new Error(text(payload.message||payload.error)||("Request failed ("+response.status+")"));
        }
        return payload;
      });
    });
  }

  var dialog;
  function ensureDialog(){
    if(dialog)return dialog;
    var scrim=document.createElement("div");
    scrim.className="wss-action-scrim";
    scrim.id="wssActionScrim";
    scrim.hidden=true;
    var card=document.createElement("div");
    card.className="wss-action-dialog";
    card.setAttribute("role","dialog");
    card.setAttribute("aria-modal","true");
    card.setAttribute("aria-labelledby","wssActionTitle");
    var title=document.createElement("h2");
    title.id="wssActionTitle";
    var copy=document.createElement("p");
    copy.id="wssActionCopy";
    var list=document.createElement("ul");
    list.className="wss-action-list";
    list.id="wssActionList";
    var foot=document.createElement("div");
    foot.className="wss-action-foot";
    var cancel=document.createElement("button");
    cancel.type="button";
    cancel.className="wss-dialog-cancel";
    cancel.textContent="Cancel";
    var confirm=document.createElement("button");
    confirm.type="button";
    confirm.className="wss-dialog-confirm";
    foot.appendChild(cancel);
    foot.appendChild(confirm);
    card.appendChild(title);
    card.appendChild(copy);
    card.appendChild(list);
    card.appendChild(foot);
    scrim.appendChild(card);
    document.body.appendChild(scrim);
    dialog={scrim:scrim,card:card,title:title,copy:copy,list:list,cancel:cancel,confirm:confirm};
    return dialog;
  }
  function ask(config){
    var d=ensureDialog();
    var returnFocus=document.activeElement;
    d.title.textContent=config.title;
    d.copy.textContent=config.copy;
    d.confirm.textContent=config.confirm;
    d.confirm.classList.toggle("danger",config.danger===true);
    d.list.replaceChildren();
    (config.rows||[]).slice(0,10).forEach(function(row){
      var li=document.createElement("li");
      li.textContent=text(row&&row.businessName)||text(row&&row.prospectId)||"Website";
      d.list.appendChild(li);
    });
    if((config.rows||[]).length>10){
      var more=document.createElement("li");
      more.textContent="Plus "+((config.rows||[]).length-10).toLocaleString()+" more";
      d.list.appendChild(more);
    }
    d.scrim.hidden=false;
    document.body.style.overflow="hidden";
    return new Promise(function(resolve){
      function finish(value){
        d.scrim.hidden=true;
        document.body.style.overflow="";
        d.cancel.removeEventListener("click",cancel);
        d.confirm.removeEventListener("click",confirm);
        d.scrim.removeEventListener("click",outside);
        document.removeEventListener("keydown",key);
        if(returnFocus&&document.contains(returnFocus)){try{returnFocus.focus();}catch(_){}}
        resolve(value);
      }
      function cancel(){finish(false);}
      function confirm(){finish(true);}
      function outside(event){if(event.target===d.scrim)finish(false);}
      function key(event){if(event.key==="Escape"){event.preventDefault();finish(false);}}
      d.cancel.addEventListener("click",cancel);
      d.confirm.addEventListener("click",confirm);
      d.scrim.addEventListener("click",outside);
      document.addEventListener("keydown",key);
      window.setTimeout(function(){d.confirm.focus();},0);
    });
  }

  var manageBar,manageCount,manageNote,selectAllButton,archiveButton,restoreButton,rebuildButton,clearButton;
  function selectedIds(){return Object.keys(selected).filter(function(id){return selected[id]===true;});}
  function rowsFor(ids){
    return ids.map(function(id){return rowsById[id]||{prospectId:id,businessName:id,archived:false};});
  }
  function syncCards(){
    document.querySelectorAll(".site-card[data-prospect-id]").forEach(function(card){
      var id=text(card.dataset.prospectId);
      var checked=selected[id]===true;
      card.classList.toggle("wss-manage-picked",checked);
      var box=card.querySelector(".wss-manage-select input");
      if(box)box.checked=checked;
    });
  }
  function refreshManageBar(){
    if(!manageBar)return;
    var rows=rowsFor(selectedIds());
    var active=rows.filter(function(row){return row.archived!==true;});
    var archived=rows.filter(function(row){return row.archived===true;});
    manageBar.hidden=rows.length===0;
    document.body.classList.toggle("wss-managing",rows.length>0);
    if(!rows.length)return;
    manageCount.textContent=rows.length===1?"1 website selected":rows.length.toLocaleString()+" websites selected";
    if(!busy)manageNote.textContent="Management selection is separate from the owner-only proof-email checkboxes.";
    archiveButton.disabled=busy||active.length===0;
    archiveButton.textContent=active.length?"Archive "+active.length.toLocaleString():"Archive";
    restoreButton.disabled=busy||archived.length===0;
    restoreButton.textContent=archived.length?"Restore "+archived.length.toLocaleString():"Restore";
    rebuildButton.disabled=busy||rows.length===0;
    selectAllButton.disabled=busy;
    clearButton.disabled=busy;
  }
  function setSelected(id,on){
    if(!id)return;
    if(on)selected[id]=true;
    else delete selected[id];
    syncCards();
    refreshManageBar();
  }
  function clearSelected(){
    selected=Object.create(null);
    syncCards();
    refreshManageBar();
  }
  function visibleCards(){
    return Array.prototype.slice.call(document.querySelectorAll(".site-card[data-prospect-id]")).filter(function(card){
      return !card.hidden&&card.offsetParent!==null;
    });
  }
  function ensureManageBar(){
    if(manageBar)return;
    manageBar=document.createElement("div");
    manageBar.className="wss-manage-bar";
    manageBar.id="wssManageBar";
    manageBar.hidden=true;
    manageBar.setAttribute("role","region");
    manageBar.setAttribute("aria-label","Selected website actions");
    var summary=document.createElement("div");
    summary.className="wss-manage-summary";
    manageCount=document.createElement("strong");
    manageNote=document.createElement("span");
    summary.appendChild(manageCount);
    summary.appendChild(manageNote);
    function button(label,className){
      var node=document.createElement("button");
      node.type="button";
      node.className="wss-manage-button"+(className?" "+className:"");
      node.textContent=label;
      return node;
    }
    selectAllButton=button("Select all visible");
    rebuildButton=button("Rebuild selected","primary");
    archiveButton=button("Archive selected","danger");
    restoreButton=button("Restore selected");
    clearButton=button("Clear");
    manageBar.appendChild(summary);
    manageBar.appendChild(selectAllButton);
    manageBar.appendChild(rebuildButton);
    manageBar.appendChild(archiveButton);
    manageBar.appendChild(restoreButton);
    manageBar.appendChild(clearButton);
    document.body.appendChild(manageBar);
    selectAllButton.addEventListener("click",function(){
      visibleCards().forEach(function(card){
        var id=text(card.dataset.prospectId);
        if(id)selected[id]=true;
      });
      syncCards();
      refreshManageBar();
    });
    clearButton.addEventListener("click",clearSelected);
    archiveButton.addEventListener("click",function(){
      runArchive("archive",rowsFor(selectedIds()).filter(function(row){return row.archived!==true;}));
    });
    restoreButton.addEventListener("click",function(){
      runArchive("restore",rowsFor(selectedIds()).filter(function(row){return row.archived===true;}));
    });
    rebuildButton.addEventListener("click",function(){runRebuild(rowsFor(selectedIds()));});
  }
  function setBusy(value,message){
    busy=value;
    if(manageNote&&message)manageNote.textContent=message;
    refreshManageBar();
  }
  function runArchive(action,rows){
    if(busy||!rows.length)return;
    var restoring=action==="restore";
    ask({
      title:restoring?"Restore these websites?":"Archive these websites?",
      copy:restoring
        ?"They will return to the active gallery. No website is rebuilt and no email is sent."
        :"They will leave the active gallery but remain available under Show archived websites. No email is sent.",
      confirm:restoring?"Restore websites":"Archive websites",
      danger:!restoring,
      rows:rows
    }).then(function(approved){
      if(!approved)return;
      setBusy(true,(restoring?"Restoring ":"Archiving ")+rows.length.toLocaleString()+" websites…");
      return adminRequest("/api/admin/gallery-manage",{
        action:action,
        prospectIds:rows.map(function(row){return row.prospectId;})
      }).then(function(payload){
        var changed=Number(payload.changed||0);
        var failed=Number(payload.failed||0);
        notify((restoring?"Restored ":"Archived ")+changed.toLocaleString()+" website"+(changed===1?"":"s")+(failed?" · "+failed+" could not be changed":"")+".",failed>0);
        window.setTimeout(function(){window.location.reload();},450);
      }).catch(function(error){
        notify(error.message||"The websites could not be updated.",true);
      }).finally(function(){setBusy(false,"");});
    });
  }
  function runRebuild(rows){
    if(busy||!rows.length)return;
    ask({
      title:"Start fresh rebuilds?",
      copy:"This sends each selected website to the real build queue. The gallery will only show Live after the backend records a successful build. No email is sent.",
      confirm:"Start rebuilds",
      danger:false,
      rows:rows
    }).then(function(approved){
      if(!approved)return;
      var started=0;
      var failed=0;
      var index=0;
      setBusy(true,"Starting rebuild 1 of "+rows.length.toLocaleString()+"…");
      function next(){
        if(index>=rows.length)return Promise.resolve();
        var row=rows[index];
        index+=1;
        manageNote.textContent="Starting rebuild "+index.toLocaleString()+" of "+rows.length.toLocaleString()+" — "+text(row.businessName||row.prospectId);
        return adminRequest("/api/admin/build-preview",{
          prospectId:row.prospectId,
          forceFreshDispatch:true,
          source:"gallery_bulk_rebuild"
        }).then(function(payload){
          if(payload&&payload.ok===true)started+=1;
          else failed+=1;
        }).catch(function(){failed+=1;}).then(next);
      }
      return next().then(function(){
        clearSelected();
        notify("Started "+started.toLocaleString()+" rebuild"+(started===1?"":"s")+(failed?" · "+failed.toLocaleString()+" could not be started":"")+". Completion will appear only after the backend reports it.",failed>0);
      }).finally(function(){setBusy(false,"");});
    });
  }

  function cardRow(card){
    var id=text(card&&card.dataset&&card.dataset.prospectId);
    return rowsById[id]||{prospectId:id,businessName:"",archived:card&&card.classList.contains("archived")};
  }
  function addCardActions(card){
    if(!card||card.dataset.wssEnterprise==="1")return;
    var id=text(card.dataset.prospectId);
    if(!id)return;
    card.dataset.wssEnterprise="1";
    var row=cardRow(card);
    var details=card.querySelector(".details-button");
    if(details){
      details.textContent="Edit details";
      details.setAttribute("title","Open business details and editable operator notes");
    }
    var strip=document.createElement("div");
    strip.className="wss-card-actions";

    var selectLabel=document.createElement("label");
    selectLabel.className="wss-manage-select";
    var checkbox=document.createElement("input");
    checkbox.type="checkbox";
    checkbox.checked=selected[id]===true;
    checkbox.setAttribute("aria-label","Select "+text(row.businessName||"this website")+" for website management");
    var selectText=document.createElement("span");
    selectText.textContent="Select";
    selectLabel.appendChild(checkbox);
    selectLabel.appendChild(selectText);
    checkbox.addEventListener("change",function(){setSelected(id,checkbox.checked);});
    strip.appendChild(selectLabel);

    var preview=card.querySelector(".preview-link");
    var live=safeUrl((preview&&preview.href)||row.previewUrl);
    if(live){
      var open=document.createElement("a");
      open.className="wss-card-action";
      open.href=live;
      open.target="_blank";
      open.rel="noopener noreferrer";
      open.textContent="Open live";
      open.setAttribute("aria-label","Open live website for "+text(row.businessName||"this business"));
      strip.appendChild(open);
    }else{
      var unavailable=document.createElement("button");
      unavailable.type="button";
      unavailable.className="wss-card-action";
      unavailable.textContent="Site offline";
      unavailable.disabled=true;
      strip.appendChild(unavailable);
    }

    var edit=document.createElement("button");
    edit.type="button";
    edit.className="wss-card-action";
    edit.textContent="Edit";
    edit.title="Open details and editable notes";
    edit.addEventListener("click",function(){
      var target=card.querySelector(".details-button");
      if(target)target.click();
    });
    strip.appendChild(edit);

    var archive=document.createElement("button");
    archive.type="button";
    archive.className="wss-card-action "+(row.archived===true?"restore":"danger");
    archive.textContent=row.archived===true?"Restore":"Archive";
    archive.addEventListener("click",function(){
      if(row.archived===true)runArchive("restore",[row]);
      else runArchive("archive",[row]);
    });
    strip.appendChild(archive);
    card.appendChild(strip);
    card.classList.toggle("wss-manage-picked",selected[id]===true);
  }

  function decorateCards(){
    document.querySelectorAll(".site-card[data-prospect-id]").forEach(addCardActions);
    syncCards();
    refreshManageBar();
  }
  function fixDynamicCopy(){
    var result=document.getElementById("resultNote");
    if(result&&result.textContent==="Loading factory records")result.textContent="Loading websites";
    var state=document.getElementById("statePanel");
    if(state){
      state.querySelectorAll("p").forEach(function(node){
        if(/factory snapshot/i.test(node.textContent))node.textContent="Reading the latest website list.";
      });
    }
    var proofAll=document.getElementById("batchSelectAll");
    if(proofAll&&/^Pick all\b/.test(proofAll.textContent)){
      proofAll.textContent=proofAll.textContent.replace(/^Pick all\b/,"Select all visible for proof");
    }
  }
  function observeGallery(){
    var grid=document.getElementById("galleryGrid");
    if(!grid)return;
    var observer=new MutationObserver(function(){
      decorateCards();
      fixDynamicCopy();
    });
    observer.observe(grid,{childList:true,subtree:true});
    var result=document.getElementById("resultNote");
    if(result)observer.observe(result,{childList:true,characterData:true,subtree:true});
    var state=document.getElementById("statePanel");
    if(state)observer.observe(state,{childList:true,subtree:true});
    var proofAll=document.getElementById("batchSelectAll");
    if(proofAll)observer.observe(proofAll,{childList:true,characterData:true,subtree:true});
  }

  function boot(){
    plainLanguage();
    buildFilters();
    ensureManageBar();
    observeGallery();
    decorateCards();
    fixDynamicCopy();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();
</script>`;

module.exports = { OPERATOR_ENTERPRISE_STYLE, OPERATOR_ENTERPRISE_SCRIPT };
