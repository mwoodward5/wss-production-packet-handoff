(function(){
  var KEY="cc-theme";
  var root=document.documentElement;
  var stored=null;
  try{ stored=localStorage.getItem(KEY); }catch(e){}
  if(stored){ root.setAttribute("data-theme", stored); }

  function makeToggle(){
    var btn=document.createElement("button");
    btn.className="cc-theme-toggle";
    btn.type="button";
    btn.setAttribute("aria-label","Toggle light and dark theme");
    function label(){ btn.textContent = root.getAttribute("data-theme")==="dark" ? "LITE" : "DARK"; }
    label();
    btn.addEventListener("click", function(){
      var next = root.getAttribute("data-theme")==="dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try{ localStorage.setItem(KEY,next); }catch(e){}
      label();
    });
    document.body.appendChild(btn);
  }
  if(document.readyState!=="loading"){ makeToggle(); }
  else{ document.addEventListener("DOMContentLoaded", makeToggle); }

  // Scroll reveal
  var els=document.querySelectorAll("[data-cc-reveal]");
  if("IntersectionObserver" in window && els.length){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.style.opacity=1; e.target.style.transform="none"; io.unobserve(e.target);} });
    },{threshold:.12});
    els.forEach(function(el){ el.style.opacity=0; el.style.transform="translateY(16px)"; el.style.transition="opacity .8s ease, transform .8s ease"; io.observe(el); });
  }
})();