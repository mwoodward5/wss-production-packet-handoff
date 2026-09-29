// Three-kitchen visual contract shared by the active Premier renderer.

import { prepareMediaCatalog } from "../lib/media-intelligence.mjs";

export const KITCHEN_STACK = "razzle-fx-kitchen site-superpowers-kitchen master-glue-kitchen";

const STOCK_AMBIANCE = {
  "pool service": [
    "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1562778612-e1e0cda9915c?auto=format&fit=crop&w=1600&q=86",
    "https://images.unsplash.com/photo-1572331165267-854da2b10ccc?auto=format&fit=crop&w=1600&q=86",
  ],
  landscaping: [
    "https://images.unsplash.com/photo-1770664945615-52203ab54c88?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1600&q=86",
    "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1600&q=86",
  ],
  roofing: [
    "https://images.unsplash.com/photo-1632759145351-1d592919f522?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1600&q=86",
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1600&q=86",
  ],
  default: [
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=86",
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=86",
  ],
};

export function applyVisualContract(packet) {
  packet.visual_system = {
    ...(packet.visual_system || {}),
    contract: "three-kitchen-premier-v8",
    kitchens: ["razzle-fx-kitchen", "site-superpowers-kitchen", "master-glue-kitchen"],
    recipes: [
      "razzle-fx-kitchen/recipes/media/hero-video-loop",
      "razzle-fx-kitchen/recipes/media/live-photo",
      "master-glue-kitchen/recipes/layouts/hero-video-bg",
      "master-glue-kitchen/recipes/content-rescue/photo-to-cinemagraph",
      "site-superpowers-kitchen/recipes/perf/perf-preload-hero",
    ],
  };
  packet.media = packet.media || {};
  packet.media.catalog = prepareMediaCatalog(packet);
  const trade = tradeKey(packet.business?.category);
  const heroCount = packet.media.catalog.filter((item) => item.hero_eligible !== false).length;
  const supportingAmbiance = STOCK_AMBIANCE[trade] || (trade === "default" ? STOCK_AMBIANCE.default : []);
  if (heroCount < 3 && supportingAmbiance.length) {
    packet.media.catalog.push(...supportingAmbiance.slice(0, 3 - heroCount).map((url, index) => ({
      kind: "photo",
      url,
      source: "stock-ambiance",
      role: heroCount === 0 && index === 0 ? "hero-ambiance" : "supporting-ambiance",
      label: `${trade} editorial ambiance — not customer job proof`,
      curation_priority: supportingAmbiance.length - index,
      treatment: "cinematic-live-photo",
    })));
    packet.media.catalog = prepareMediaCatalog(packet);
    packet.media.fallback_reason = heroCount === 0
      ? "No source-owned photo was available; licensed editorial ambiance is visibly separated from proof."
      : "Source media was limited; supporting editorial ambiance is visibly separated from customer proof.";
  }
  const hasVideo = packet.media.catalog.some((item) => item.kind === "video");
  const hasSourcePhoto = packet.media.catalog.some((item) => item.kind === "photo" && !["stock-ambiance", "ai"].includes(item.source));
  packet.visual_system.motion = hasVideo ? "video-loop" : "photo-light-shader";
  packet.visual_system.media_provenance = hasSourcePhoto ? "source-owned" : "stock-ambiance";
  return packet;
}

export function visualAttrs(packet, family) {
  const motion = packet.visual_system?.motion || "photo-light-shader";
  const provenance = packet.visual_system?.media_provenance || "unknown";
  return `data-kitchen-stack="${KITCHEN_STACK}" data-hero-model="${family}" data-motion-model="${motion}" data-media-provenance="${provenance}"`;
}

export function cinematicCss() {
  return `
.media-plane .cinematic-shader{position:absolute;inset:0;width:100%;height:100%;z-index:2;mix-blend-mode:soft-light;opacity:.46;pointer-events:none}
.media-plane .hero-media.cinematic-drift{transform:scale(1.05);animation:cinematicDrift 16s ease-in-out infinite alternate;will-change:transform}
.media-plane .hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;filter:brightness(.72) contrast(1.08) saturate(.88)}
.media-plane .source-label{position:absolute;left:14px;bottom:14px;z-index:4;padding:.32rem .58rem;border:1px solid rgba(255,255,255,.28);background:rgba(10,12,12,.54);color:#fff;font:600 .68rem/1.2 var(--body);letter-spacing:.06em;text-transform:uppercase;backdrop-filter:blur(8px)}
@keyframes cinematicDrift{0%{transform:scale(1.05) translate3d(-1.2%,-.5%,0)}100%{transform:scale(1.12) translate3d(1.5%,1%,0)}}
@media(prefers-reduced-motion:reduce){.media-plane .hero-media.cinematic-drift{animation:none;transform:scale(1.04)}.media-plane .cinematic-shader{display:none}}
`;
}

export function cinematicRuntime() {
  return `(function(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.querySelectorAll('canvas[data-cinematic-shader]').forEach(function(canvas){
    var ctx=canvas.getContext('2d'),host=canvas.parentElement,phase=0,raf=0;
    function size(){var r=host.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.max(1,Math.floor(r.width*d));canvas.height=Math.max(1,Math.floor(r.height*d));}
    function draw(){var w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);phase+=.006;for(var i=0;i<7;i++){var y=h*(.18+i*.115)+Math.sin(phase*2+i*.8)*h*.018;ctx.beginPath();ctx.moveTo(-20,y);for(var x=0;x<=w+30;x+=36){ctx.lineTo(x,y+Math.sin(x*.012+phase*3+i)*h*.02)}ctx.strokeStyle='rgba(255,255,255,'+(0.055+i*.008)+')';ctx.lineWidth=Math.max(1,w/900);ctx.stroke()}raf=requestAnimationFrame(draw)}
    size();draw();addEventListener('resize',size,{passive:true});canvas.addEventListener('DOMNodeRemoved',function(){cancelAnimationFrame(raf)},{once:true});
  });
})();`;
}

function tradeKey(category = "") {
  const text = String(category).toLowerCase();
  if (/pool|spa/.test(text)) return "pool service";
  if (/landscap|lawn|garden/.test(text)) return "landscaping";
  if (/roof/.test(text)) return "roofing";
  if (/fenc|gate/.test(text)) return "fencing";
  if (/excavat|grading|sitework/.test(text)) return "excavation";
  if (/plumb|drain|sewer/.test(text)) return "plumbing";
  if (/hvac|heating|air condition/.test(text)) return "hvac";
  if (/electric|wiring/.test(text)) return "electrical";
  return "default";
}
