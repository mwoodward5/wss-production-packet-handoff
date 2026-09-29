"use strict";

function stableSerialize(value, seen) {
  try {
    if (value === null) return "null";
    var type = typeof value;
    if (type === "string") return JSON.stringify(value);
    if (type === "number") {
      if (value !== value) return '"[NaN]"';
      if (value === Infinity) return '"[Infinity]"';
      if (value === -Infinity) return '"[-Infinity]"';
      if (value === 0 && 1 / value === -Infinity) return "-0";
      return String(value);
    }
    if (type === "boolean") return value ? "true" : "false";
    if (type === "undefined") return '"[Undefined]"';
    if (type === "function") return '"[Function]"';
    if (type === "symbol") return '"[Symbol]"';
    if (type === "bigint") return JSON.stringify(String(value) + "n");
    if (type !== "object") return JSON.stringify(String(value));

    var tag;
    try { tag = Object.prototype.toString.call(value); } catch (_) { tag = ""; }
    if (tag === "[object Date]") {
      var time = value.getTime();
      return isFinite(time) ? JSON.stringify(value.toISOString()) : '"[InvalidDate]"';
    }

    seen = Array.isArray(seen) ? seen : [];
    if (seen.indexOf(value) !== -1) return '"[Circular]"';
    seen.push(value);

    var output;
    if (Array.isArray(value)) {
      var arrayParts = [];
      for (var i = 0; i < value.length; i += 1) {
        arrayParts.push(stableSerialize(value[i], seen));
      }
      output = "[" + arrayParts.join(",") + "]";
    } else {
      var keys = Object.keys(value).sort();
      var objectParts = [];
      for (var j = 0; j < keys.length; j += 1) {
        var key = keys[j];
        var child;
        try { child = value[key]; } catch (_) { child = "[GetterError]"; }
        objectParts.push(JSON.stringify(key) + ":" + stableSerialize(child, seen));
      }
      output = "{" + objectParts.join(",") + "}";
    }
    seen.pop();
    return output;
  } catch (_) {
    return '"[Unserializable]"';
  }
}

function rowSignature(row) {
  try {
    if (!row || typeof row !== "object" || Array.isArray(row)) return "refusal:malformed_row";
    return stableSerialize(row, []);
  } catch (_) {
    return "refusal:row_signature_failed";
  }
}

function rowId(row) {
  try {
    if (!row || typeof row !== "object") return "";
    var raw = row.prospectId;
    if (raw == null || raw === "") raw = row.id;
    if (raw == null) return "";
    var id = String(raw).trim();
    return id;
  } catch (_) {
    return "";
  }
}

function indexRows(rows) {
  var result = { map: Object.create(null), order: [], refusal: "", duplicates: 0 };
  if (!Array.isArray(rows)) {
    result.refusal = "malformed_rows";
    return result;
  }
  for (var i = 0; i < rows.length; i += 1) {
    var id = rowId(rows[i]);
    if (!id) {
      if (!result.refusal) result.refusal = "row_id_missing";
      continue;
    }
    // A repeated id is NORMAL here, not corruption, so it must never refuse.
    // The caller reconciles picks against nextBuilds.concat(nextClients), and a
    // prospect that is both a customer and a build legitimately appears in both
    // lists. Refusing on the overlap paused the live lane permanently against
    // real production data ("paused — refresh refused: duplicate_row_id"), which
    // is the exact staleness this module exists to end.
    //
    // First occurrence wins, which is also how the page's own operator-nav
    // dedupes the same two lists (builds.concat(clients), keep if !rowsById[id]).
    // Matching that keeps one dedupe rule in the page instead of two.
    if (Object.prototype.hasOwnProperty.call(result.map, id)) {
      result.duplicates += 1;
      continue;
    }
    result.map[id] = rowSignature(rows[i]);
    result.order.push(id);
  }
  return result;
}

function diffRows(prev, next) {
  var out = { added: [], changed: [], removed: [], unchanged: [] };
  try {
    var before = indexRows(prev);
    var after = indexRows(next);
    for (var i = 0; i < after.order.length; i += 1) {
      var id = after.order[i];
      if (!Object.prototype.hasOwnProperty.call(before.map, id)) out.added.push(id);
      else if (before.map[id] === after.map[id]) out.unchanged.push(id);
      else out.changed.push(id);
    }
    for (var j = 0; j < before.order.length; j += 1) {
      var oldId = before.order[j];
      if (!Object.prototype.hasOwnProperty.call(after.map, oldId)) out.removed.push(oldId);
    }
    var refusal = before.refusal || after.refusal;
    if (refusal) out.refusal = refusal;
    return out;
  } catch (_) {
    out.refusal = "diff_rows_failed";
    return out;
  }
}

function reconcilePicks(picked, nextRows) {
  var out = { picked: {}, dropped: [] };
  try {
    if (!picked || typeof picked !== "object" || Array.isArray(picked)) {
      out.refusal = "malformed_picks";
      return out;
    }
    var indexed = indexRows(nextRows);
    var ids = Object.keys(picked);
    for (var i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      if (picked[id] !== true) continue;
      if (Object.prototype.hasOwnProperty.call(indexed.map, id)) out.picked[id] = true;
      else out.dropped.push(id);
    }
    if (indexed.refusal) out.refusal = indexed.refusal;
    return out;
  } catch (_) {
    out.picked = {};
    out.dropped = [];
    out.refusal = "reconcile_picks_failed";
    return out;
  }
}

function nextPollDelay(input) {
  try {
    input = input && typeof input === "object" ? input : {};
    if (input.hidden === true) return null;
    var baseMs = Number(input.baseMs);
    var maxMs = Number(input.maxMs);
    var failures = Number(input.consecutiveFailures);
    if (!isFinite(baseMs) || baseMs <= 0) baseMs = 15000;
    if (!isFinite(maxMs) || maxMs < baseMs) maxMs = Math.max(baseMs, 300000);
    if (!isFinite(failures) || failures < 0) failures = 0;
    failures = Math.floor(failures);
    var multiplier = Math.pow(2, Math.min(failures, 20));
    return Math.min(maxMs, Math.round(baseMs * multiplier));
  } catch (_) {
    return 15000;
  }
}

function shouldRefresh(input) {
  try {
    if (!input || typeof input !== "object") return { ok: false, reason: "malformed_refresh_state" };
    if (input.hidden === true) return { ok: false, reason: "tab_hidden" };
    if (input.inFlight === true) return { ok: false, reason: "fetch_in_flight" };
    if (input.dialogOpen === true) return { ok: false, reason: "dialog_open" };
    if (input.modalOpen === true) return { ok: false, reason: "modal_open" };
    if (input.drawerOpen === true) return { ok: false, reason: "drawer_open" };
    return { ok: true, reason: "ready" };
  } catch (_) {
    return { ok: false, reason: "refresh_state_read_failed" };
  }
}

function describeFreshness(lastLoadedAt, now) {
  try {
    var pausedReason = "";
    var raw = lastLoadedAt;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      pausedReason = typeof raw.pausedReason === "string" ? raw.pausedReason : "";
      raw = raw.at;
    }
    if (pausedReason === "tab_in_background") return "paused — tab in background";
    if (pausedReason === "backoff") return "paused — retrying after connection trouble";
    if (pausedReason === "dialog_open") return "paused — dialog open";
    if (pausedReason === "modal_open") return "paused — action open";
    if (pausedReason === "drawer_open") return "paused — details open";

    var at = typeof raw === "number" ? raw : Date.parse(String(raw == null ? "" : raw));
    var current = typeof now === "number" ? now : Date.parse(String(now == null ? "" : now));
    if (!isFinite(at)) return "not updated yet";
    if (!isFinite(current)) return "freshness unavailable — invalid clock";
    var delta = Math.max(0, current - at);
    var seconds = Math.floor(delta / 1000);
    if (seconds < 5) return "updated just now";
    if (seconds < 60) return "updated " + seconds + " second" + (seconds === 1 ? "" : "s") + " ago";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return "updated " + minutes + " minute" + (minutes === 1 ? "" : "s") + " ago";
    var hours = Math.floor(minutes / 60);
    return "updated " + hours + " hour" + (hours === 1 ? "" : "s") + " ago";
  } catch (_) {
    return "freshness unavailable — timestamp read failed";
  }
}

var BROWSER_SCRIPT = [
  "/* Gallery live refresh: GET-only presentation lane. Must be embedded inside the gallery page IIFE. */",
  "(function(){",
  "  var LIVE_BASE_MS=15000;",
  "  var LIVE_MAX_MS=300000;",
  "  var liveTimer=null;",
  "  var liveClockTimer=null;",
  "  var liveLastLoadedAt=0;",
  "  var liveConsecutiveFailures=0;",
  "  var liveNextDueAt=0;",
  "  var livePauseReason='';",
  "  var liveDroppedMessage='';",
  "  var liveDroppedUntil=0;",
  "  var liveStarted=false;",
  "  " + stableSerialize.toString(),
  "  " + rowSignature.toString(),
  "  " + rowId.toString(),
  "  " + indexRows.toString(),
  "  " + diffRows.toString(),
  "  " + reconcilePicks.toString(),
  "  " + nextPollDelay.toString(),
  "  " + shouldRefresh.toString(),
  "  " + describeFreshness.toString(),
  "  function liveShown(node){return Boolean(node&&node.hidden===false);}",
  "  function liveSurfaceState(){",
  "    var menuOpen=Boolean(document.querySelector(\".menu-button[aria-expanded='true']\"));",
  "    var editorOpen=Boolean(document.querySelector('.edit-form'));",
  "    return {",
  "      modalOpen:menuOpen||editorOpen,",
  "      dialogOpen:liveShown(askDialog)||liveShown(confirmDialog),",
  "      drawerOpen:liveShown(drawer),",
  "      hidden:document.hidden===true,",
  "      inFlight:Boolean(loadInFlight)",
  "    };",
  "  }",
  "  function liveEnsureStyle(){",
  "    if(document.getElementById('galleryLiveRefreshStyle'))return;",
  "    var style=document.createElement('style');",
  "    style.id='galleryLiveRefreshStyle';",
  "    style.textContent='.gallery-live-status{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:6px 8px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(8,8,11,.34);backdrop-filter:blur(12px) saturate(130%);-webkit-backdrop-filter:blur(12px) saturate(130%);color:var(--slate);font:500 10px/1.2 var(--mono);letter-spacing:.04em;text-transform:none;white-space:nowrap}.gallery-live-dot{width:6px;height:6px;border-radius:50%;background:var(--pulse);box-shadow:0 0 12px rgba(52,211,153,.4);flex:none}.gallery-live-status.paused .gallery-live-dot{background:var(--ember);box-shadow:none}.gallery-live-refresh{min-height:28px;padding:0 9px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background:rgba(255,255,255,.035);color:var(--ice);font:600 10px/1 var(--mono);cursor:pointer}.gallery-live-refresh:hover{border-color:rgba(255,255,255,.2)}.site-card.gallery-live-new{animation:galleryLiveArrival 1.8s ease-out both!important}@keyframes galleryLiveArrival{0%{box-shadow:0 0 0 1px rgba(52,211,153,.7),0 0 34px rgba(52,211,153,.22),var(--gallery-glass-shadow)}100%{box-shadow:var(--gallery-glass-shadow)}}@media(prefers-reduced-motion:reduce){.site-card.gallery-live-new{animation:none!important;box-shadow:var(--gallery-glass-shadow)}}';",
  "    document.head.appendChild(style);",
  "  }",
  "  function liveEnsureStatus(){",
  "    var found=document.getElementById('galleryLiveStatus');",
  "    if(found)return found;",
  "    liveEnsureStyle();",
  "    var wrap=document.createElement('div');",
  "    wrap.id='galleryLiveStatus';",
  "    wrap.className='gallery-live-status';",
  "    wrap.setAttribute('role','status');",
  "    wrap.setAttribute('aria-live','polite');",
  "    var dot=document.createElement('span');dot.className='gallery-live-dot';dot.setAttribute('aria-hidden','true');",
  "    var label=document.createElement('span');label.id='galleryLiveLabel';label.textContent='not updated yet';",
  "    var button=document.createElement('button');button.type='button';button.className='gallery-live-refresh';button.textContent='Refresh now';",
  "    button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();liveRefreshNow('manual');});",
  "    wrap.appendChild(dot);wrap.appendChild(label);wrap.appendChild(button);",
  "    if(resultNote&&resultNote.parentNode)resultNote.parentNode.insertBefore(wrap,resultNote);",
  "    return wrap;",
  "  }",
  "  function livePauseSentence(reason){",
  "    if(reason==='tab_hidden')return 'paused — tab in background';",
  "    if(reason==='backoff'){var seconds=Math.max(0,Math.ceil((liveNextDueAt-Date.now())/1000));return 'paused — retrying in '+seconds+'s';}",
  "    if(reason==='dialog_open')return 'paused — confirmation open';",
  "    if(reason==='drawer_open')return 'paused — details open';",
  "    if(reason==='modal_open')return 'paused — action open';",
  "    if(reason==='fetch_in_flight')return 'updating…';",
  "    if(reason==='auth_required')return 'paused — operator token required';",
  "    if(reason&&reason.indexOf('refresh_refused:')===0)return 'paused — '+reason.replace('refresh_refused:','refresh refused: ');",
  "    return '';",
  "  }",
  "  function livePaintStatus(){",
  "    var wrap=liveEnsureStatus();",
  "    var label=document.getElementById('galleryLiveLabel');",
  "    if(!label)return;",
  "    var now=Date.now();",
  "    var sentence='';",
  "    if(liveDroppedMessage&&now<liveDroppedUntil)sentence=liveDroppedMessage;",
  "    else if(livePauseReason)sentence=livePauseSentence(livePauseReason);",
  "    else sentence=describeFreshness(liveLastLoadedAt,now);",
  "    if(label.textContent!==sentence)label.textContent=sentence;",
  "    wrap.classList.toggle('paused',Boolean(livePauseReason));",
  "  }",
  "  function liveClock(){",
  "    window.clearTimeout(liveClockTimer);",
  "    livePaintStatus();",
  "    if(document.hidden===true)return;",
  "    liveClockTimer=window.setTimeout(liveClock,1000);",
  "  }",
  "  function liveFilterVocabulary(rows){",
  "    var trades={};var statuses={};",
  "    (Array.isArray(rows)?rows:[]).forEach(function(item){var trade=text(item&&item.vertical,'').toLowerCase();if(trade)trades[trade]=true;var status=text(item&&item.status,'').toLowerCase()||(item&&item.archived?'archived_legacy':'');if(status)statuses[status]=true;});",
  "    return Object.keys(trades).sort().join('|')+'::'+Object.keys(statuses).sort().join('|');",
  "  }",
  "  function liveMergeLocal(prevRows,nextRows){",
  "    var old={};(Array.isArray(prevRows)?prevRows:[]).forEach(function(row){var id=rowId(row);if(id)old[id]=row;});",
  "    return (Array.isArray(nextRows)?nextRows:[]).map(function(row){var id=rowId(row);var before=id?old[id]:null;if(before&&before.notesKnown===true&&row.notesKnown!==true){row.notes=before.notes;row.notesKnown=true;}if(before&&text(before.lastSentAt,'')&&!text(row.lastSentAt,'')){row.lastSentAt=before.lastSentAt;row.lastSentKind=before.lastSentKind;}return row;});",
  "  }",
  "  function liveAnyDiff(diff){return Boolean(diff.added.length||diff.changed.length||diff.removed.length);}",
  "  function liveSet(ids){var set={};(ids||[]).forEach(function(id){set[id]=true;});return set;}",
  "  function liveCaptureAnchor(){",
  "    var cards=galleryGrid.querySelectorAll('.site-card[data-prospect-id]');",
  "    for(var i=0;i<cards.length;i+=1){var rect=cards[i].getBoundingClientRect();if(rect.bottom>0){return {id:cards[i].dataset.prospectId,top:rect.top};}}",
  "    return null;",
  "  }",
  "  function liveRestoreAnchor(anchor){",
  "    if(!anchor||!anchor.id)return;var cards=galleryGrid.querySelectorAll('.site-card[data-prospect-id]');",
  "    for(var i=0;i<cards.length;i+=1){if(cards[i].dataset.prospectId===anchor.id){var top=cards[i].getBoundingClientRect().top;var delta=top-anchor.top;if(Math.abs(delta)>1)window.scrollBy(0,delta);return;}}",
  "  }",
  "  function liveCaptureFocus(){",
  "    var active=document.activeElement;if(!active||!active.closest)return null;var card=active.closest('.site-card[data-prospect-id]');if(!card)return null;",
  "    return {id:card.dataset.prospectId,aria:active.getAttribute('aria-label')||'',tag:String(active.tagName||'').toLowerCase(),text:text(active.textContent,'').trim()};",
  "  }",
  "  function liveRestoreFocus(saved){",
  "    if(!saved||!saved.id)return;var cards=galleryGrid.querySelectorAll('.site-card[data-prospect-id]');var card=null;for(var i=0;i<cards.length;i+=1){if(cards[i].dataset.prospectId===saved.id){card=cards[i];break;}}if(!card)return;",
  "    var nodes=card.querySelectorAll('button,a,input,textarea,select');for(var j=0;j<nodes.length;j+=1){var node=nodes[j];if(saved.aria&&node.getAttribute('aria-label')===saved.aria){try{node.focus();}catch(_){}return;}if(!saved.aria&&String(node.tagName||'').toLowerCase()===saved.tag&&text(node.textContent,'').trim()===saved.text){try{node.focus();}catch(_){}return;}}",
  "  }",
  "  function liveUpdateResultMeta(){",
  "    var rows=activeRows();var visible=rows.slice(0,state.visibleLimit);var remaining=rows.length-visible.length;loadZone.hidden=remaining<=0;loadMore.textContent='Load '+Math.min(PAGE_SIZE,remaining)+' more';loadHint.textContent=remaining>0?(loadMore.hidden?remaining.toLocaleString()+' more load as you scroll':remaining.toLocaleString()+' sites remain'):'';var offlineCount=rows.filter(isOffline).length;var haltedCount=rows.filter(function(item){return text(item.batchState,'')==='halted';}).length;resultNote.textContent='Showing '+visible.length.toLocaleString()+' of '+rows.length.toLocaleString()+' sites'+(offlineCount?' · '+offlineCount.toLocaleString()+' offline':'')+(haltedCount?' · '+haltedCount.toLocaleString()+' in halted batches':'');refreshBatchBar();",
  "  }",
  "  function livePatchVisible(diff,routingChanged){",
  "    var rows=activeRows();var visible=rows.slice(0,state.visibleLimit);",
  "    if(!rows.length){updateView();return;}",
  "    statePanel.hidden=true;galleryGrid.hidden=false;",
  "    var anchor=liveCaptureAnchor();var focus=liveCaptureFocus();",
  "    var changed=liveSet(diff.changed);var added=liveSet(diff.added);var existing={};var nodes=galleryGrid.querySelectorAll('.site-card[data-prospect-id]');",
  "    for(var i=0;i<nodes.length;i+=1)existing[nodes[i].dataset.prospectId]=nodes[i];",
  "    var keep={};",
  "    for(var j=0;j<visible.length;j+=1){",
  "      var item=visible[j];var id=rowId(item);if(!id)continue;keep[id]=true;var node=existing[id];var replace=Boolean(routingChanged||changed[id]);",
  "      if(!node||replace){var fresh=makeCard(item,j,false);if(added[id])fresh.classList.add('gallery-live-new');if(node&&node.parentNode===galleryGrid)galleryGrid.replaceChild(fresh,node);node=fresh;existing[id]=node;}",
  "      var at=galleryGrid.children[j];if(at!==node)galleryGrid.insertBefore(node,at||null);",
  "    }",
  "    Object.keys(existing).forEach(function(id){if(!keep[id]){var node=existing[id];if(node&&node.parentNode===galleryGrid)galleryGrid.removeChild(node);delete sentLines[id];}});",
  "    liveUpdateResultMeta();liveRestoreAnchor(anchor);liveRestoreFocus(focus);",
  "  }",
  "  function liveApplySnapshot(payload){",
  "    var prevClients=state.clients.slice();var prevBuilds=state.builds.slice();var prevFilterVocab=liveFilterVocabulary(prevBuilds);var prevVisibleOrder=activeRows().slice(0,state.visibleLimit).map(function(row){return rowId(row);}).join('|');",
  "    var nextClients=liveMergeLocal(prevClients,normalizeRows(payload&&payload.clients));var nextBuilds=liveMergeLocal(prevBuilds,normalizeRows(payload&&payload.builds));",
  "    var clientsDiff=diffRows(prevClients,nextClients);var buildsDiff=diffRows(prevBuilds,nextBuilds);",
  "    if(clientsDiff.refusal)return {ok:false,reason:'refresh_refused:'+clientsDiff.refusal};if(buildsDiff.refusal)return {ok:false,reason:'refresh_refused:'+buildsDiff.refusal};",
  "    var routing=payload&&payload.send&&typeof payload.send==='object'?payload.send:{};var nextRouting={recipient:text(routing.recipient,''),canSend:routing.canSend===true&&Boolean(text(routing.recipient,'')),headline:text(routing.headline,'')};",
  "    var routingChanged=rowSignature(state.routing)!==rowSignature(nextRouting);",
  "    var reconciled=reconcilePicks(state.picked,nextBuilds.concat(nextClients));if(reconciled.refusal)return {ok:false,reason:'refresh_refused:'+reconciled.refusal};",
  "    state.clients=nextClients;state.builds=nextBuilds;state.routing=nextRouting;state.picked=reconciled.picked;state.loaded=true;",
  "    if(state.routing.headline)ownerNote.textContent=state.routing.headline;",
  "    var nextFilterVocab=liveFilterVocabulary(nextBuilds);if(prevFilterVocab!==nextFilterVocab&&document.activeElement!==tradeFilter&&document.activeElement!==statusFilter)populateFilters();",
  "    var relevant=state.activeTab==='clients'?clientsDiff:buildsDiff;var nextVisibleOrder=activeRows().slice(0,state.visibleLimit).map(function(row){return rowId(row);}).join('|');var orderChanged=prevVisibleOrder!==nextVisibleOrder;var dataChanged=liveAnyDiff(clientsDiff)||liveAnyDiff(buildsDiff)||routingChanged||orderChanged;",
  "    if(dataChanged){updateTabs();livePatchVisible(relevant,routingChanged);}",
  "    if(reconciled.dropped.length){var count=reconciled.dropped.length;liveDroppedMessage=count+' selected site'+(count===1?'':'s')+' disappeared — unselected for safety';liveDroppedUntil=Date.now()+8000;try{notify(liveDroppedMessage);}catch(_){}refreshBatchBar();}",
  "    return {ok:true,changed:dataChanged,dropped:reconciled.dropped};",
  "  }",
  "  function liveSchedule(){",
  "    window.clearTimeout(liveTimer);liveTimer=null;var delay=nextPollDelay({consecutiveFailures:liveConsecutiveFailures,hidden:document.hidden===true,baseMs:LIVE_BASE_MS,maxMs:LIVE_MAX_MS});if(delay===null){livePauseReason='tab_hidden';livePaintStatus();return;}liveNextDueAt=Date.now()+delay;liveTimer=window.setTimeout(function(){liveRefreshNow('poll');},delay);livePaintStatus();",
  "  }",
  "  function liveRefreshNow(trigger){",
  "    if(!state.loaded&&trigger!=='initial')return Promise.resolve({ok:false,reason:'gallery_not_loaded'});",
  "    var gate=shouldRefresh(liveSurfaceState());if(!gate.ok){livePauseReason=gate.reason;if(gate.reason!=='fetch_in_flight'&&gate.reason!=='tab_hidden')liveSchedule();else livePaintStatus();return Promise.resolve({ok:false,reason:gate.reason});}",
  "    window.clearTimeout(liveTimer);liveTimer=null;livePauseReason='fetch_in_flight';livePaintStatus();",
  "    loadInFlight=api('/api/admin/gallery-data').then(function(payload){var applied=liveApplySnapshot(payload);if(!applied.ok){liveConsecutiveFailures+=1;livePauseReason=applied.reason;return applied;}liveConsecutiveFailures=0;liveLastLoadedAt=Date.now();livePauseReason='';hideGate();return applied;}).catch(function(error){liveConsecutiveFailures+=1;if(error&&(error.status===401||error.status===403)){clearToken();showGate('Token expired or rejected. Enter a current operator token.');livePauseReason='auth_required';window.clearTimeout(liveTimer);liveTimer=null;return {ok:false,reason:'auth_required'};}livePauseReason='backoff';return {ok:false,reason:'gallery_refresh_failed'};}).finally(function(){loadInFlight=null;if(livePauseReason!=='auth_required')liveSchedule();livePaintStatus();});",
  "    return loadInFlight;",
  "  }",
  "  function liveStart(){if(liveStarted)return;liveStarted=true;liveEnsureStatus();liveLastLoadedAt=Date.now();liveConsecutiveFailures=0;livePauseReason='';liveClock();liveSchedule();}",
  "  var liveBaseLoad=load;",
  "  load=function(){",
  "    if(state.loaded)return liveRefreshNow('manual');",
  "    var operation=liveBaseLoad();",
  "    return Promise.resolve(operation).then(function(payload){liveStart();return payload;});",
  "  };",
  "  document.addEventListener('visibilitychange',function(){",
  "    if(document.hidden===true){window.clearTimeout(liveTimer);liveTimer=null;window.clearTimeout(liveClockTimer);liveClockTimer=null;livePauseReason='tab_hidden';livePaintStatus();return;}",
  "    livePauseReason='';liveClock();if(state.loaded)liveRefreshNow('visible');",
  "  });",
  "}());"
].join("\n");

module.exports = {
  BROWSER_SCRIPT: BROWSER_SCRIPT,
  rowSignature: rowSignature,
  diffRows: diffRows,
  reconcilePicks: reconcilePicks,
  nextPollDelay: nextPollDelay,
  shouldRefresh: shouldRefresh,
  describeFreshness: describeFreshness
};
