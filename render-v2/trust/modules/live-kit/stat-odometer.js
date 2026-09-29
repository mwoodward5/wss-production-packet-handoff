"use strict";

// lib/mirror-engine/kit/stat-odometer.js — wave 1, module 2 of the AUTHORITY
// KIT PORT PLAN (§5.1.2). A two-line CSS arm + one tiny IIFE; proves the js()
// arm and the idempotence-marker law of the kit seam.
//
// The trust numerals (.wss-t__num on the #trust rail and the aggregate-only
// rating strip) roll up when scrolled into view — 1700ms ease-out-quartic,
// 0.12s stagger, tabular figures. TRUTH LAW: the target value is read FROM
// THE DOM TEXT the engine already rendered (the rail/strip gates are
// upstream); the script never computes, rounds or invents a numeral, and the
// final frame restores the EXACT original string, so the settled bytes are
// the engine's bytes. No numerals on the build => no targets => nothing.
//
// Opt-in per donor BOILERPLATE.json: "kit_stat_odometer": true.

var STAT_ODOMETER_JS = `<script data-wss-kit="stat-odometer">(function(){
function roll(el,idx){
  try{
    var fin=String(el.textContent||"").replace(/\\u00a0/g," ").trim();
    if(!/^\\d[\\d,]*(?:\\.\\d+)?$/.test(fin)){el.setAttribute("data-wss-kit-stat-odometer-done","1");return;}
    el.setAttribute("data-wss-kit-stat-odometer-done","1");
    var dec=fin.indexOf(".")>=0?Math.min(fin.length-fin.indexOf(".")-1,1):0;
    var target=parseFloat(fin.replace(/,/g,""));
    if(!isFinite(target)||target<=0)return;
    var grouped=fin.indexOf(",")>=0;
    var DUR=1700;
    var delay=Math.min(idx,2)*120;
    function render(v){
      if(dec>0){el.textContent=v.toFixed(dec);}
      else if(grouped){el.textContent=Math.round(v).toLocaleString("en-US");}
      else{el.textContent=String(Math.round(v));}
    }
    function settle(){el.textContent=fin;}
    function start(t0){
      function frame(t){
        try{
          var p=Math.min(1,(t-t0)/DUR);
          if(p>=1){settle();return;}
          render(target*(1-Math.pow(1-p,4)));
          window.requestAnimationFrame(frame);
        }catch(err){settle();}
      }
      window.requestAnimationFrame(frame);
    }
    function begin(){window.requestAnimationFrame(function(ts){start(ts);});}
    if("IntersectionObserver" in window){
      var io=new IntersectionObserver(function(entries,obs){
        for(var j=0;j<entries.length;j++){
          if(entries[j]&&entries[j].isIntersecting){
            obs.disconnect();
            setTimeout(begin,delay);
            break;
          }
        }
      },{threshold:0.35});
      io.observe(el);
    }else{
      setTimeout(begin,delay);
    }
  }catch(e){}
}
function arm(){
  try{
    if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches)return;
    var nodes=document.querySelectorAll("#trust .wss-t__num, #reviews[data-wss-rating-strip] .wss-t__num");
    if(!nodes||!nodes.length)return;
    for(var i=0;i<nodes.length;i++){
      if(nodes[i].getAttribute("data-wss-kit-stat-odometer-done")==="1")continue;
      roll(nodes[i],i);
    }
  }catch(e){}
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",arm);}else{arm();}
window.addEventListener("load",arm);
try{
  var mt=null;
  var mo=new MutationObserver(function(){
    if(mt)return;
    mt=setTimeout(function(){mt=null;arm();},80);
  });
  mo.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});
  setTimeout(function(){mo.disconnect();},6000);
}catch(e){}
})();</script>`;

module.exports = Object.freeze({
  name: "stat-odometer",
  version: 1,

  activation: Object.freeze({ mode: "flag", flag: "kit_stat_odometer", verticals: null }),

  budget: Object.freeze({
    family: "counter",
    ambientLoop: null,
    dwell: "n/a (one-time roll)",
    stagger: "0.12s per numeral, cap 3",
    maxPerViewport: 3,
  }),

  css() {
    // The only style the module needs: figures that do not jitter as they
    // roll. No animation lives in CSS (the roll is JS, reduced-motion-gated
    // at runtime), so no twin is required by the kit laws.
    return "/* --- wss-kit stat-odometer: tabular figures for the trust numerals. */\n"
      + ".wss-t__num { font-variant-numeric: tabular-nums; }";
  },

  js() {
    return STAT_ODOMETER_JS;
  },

  notes: "rAF count-up (1700ms ease-out-quartic, 0.12s stagger cap 3) over .wss-t__num on the "
    + "#trust rail and the aggregate-only [data-wss-rating-strip]. Value read from the rendered "
    + "text; final frame restores the exact engine string. Reduced-motion: numerals land instantly.",
});
