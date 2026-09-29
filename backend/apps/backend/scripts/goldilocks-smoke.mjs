// No-key smoke test for the Goldilocks intake layer. Proves: junk photos are
// cut, NAP mismatch is caught, reviews collapse to themes, output is bounded.
import { buildBusinessTruthPacket, curatePhotos, GOLDILOCKS } from "../asset-pipeline/goldilocks.mjs";
import assert from "node:assert";

const profile = { business_name: "Richard Diaz Landscape", industry: "landscaping", city: "Orange County", state: "CA", phone: "(714) 673-2643" };
const found = {
  logo: "https://site.com/wp-content/uploads/logo.png",
  colors: ["#22380f", "#c0dd97", "#fff", "#000", "#333", "#777", "#aaa"],
  contact: { phone: "(480) 692-9646", address: "633 N Heatherstone Dr, Orange, CA 92869" },
  copy: "short thin copy",
  seo_gaps: ["no structured data detected", "no FAQ surface for AI answer engines", "no visible review proof", "thin page copy"],
  photos: [
    "https://site.com/favicon-32x32.png",           // junk
    "https://site.com/assets/logo.svg",             // junk
    "https://site.com/sprite-icons.png",            // junk
    "https://site.com/wp/uploads/gallery/patio-project-1920x1080.webp",  // real
    "https://site.com/wp/uploads/masonry-build-after.jpg",               // real
    "https://site.com/wp/uploads/landscape-design-hero.webp",            // real
    "https://site.com/wp/uploads/backyard-install.jpg",                  // real
    "https://site.com/tracking/pixel.gif",          // junk
    "https://site.com/wp/uploads/portfolio-stonework.jpg",               // real
    "https://site.com/wp/uploads/portfolio-stonework.jpg?resize=200",    // dup
    ...Array.from({length:20},(_,i)=>`https://site.com/wp/uploads/work-${i}.jpg`), // many
  ],
};
const gbp = {
  phone: "(714) 673-2643",
  reviews: [
    "Richard did amazing masonry work on our patio, very professional and clean",
    "Great masonry and stonework, the patio looks incredible, highly recommend",
    "Professional patio install, on time, quality masonry, would hire again",
    "Beautiful landscape design work, very happy",
  ],
};

const p = buildBusinessTruthPacket({ profile, found, gbp });

// 1) NAP mismatch caught (phone 480 vs 714)
assert(!p.napConsistency.consistent, "should detect NAP inconsistency");
const phoneMiss = p.napConsistency.mismatches.find((m) => m.field === "phone");
assert(phoneMiss, "should flag phone mismatch");
const napOp = p.opportunities.find((o) => o.type === "nap_mismatch");
assert(napOp && napOp.severity === "high", "NAP mismatch should be a high-severity opportunity");

// 2) Junk cut, real kept, bounded
assert(p.photos.length <= GOLDILOCKS.maxPhotos, `photos capped at ${GOLDILOCKS.maxPhotos}`);
assert(!p.photos.some((u) => /favicon|logo\.svg|sprite|pixel/i.test(u)), "junk photos removed");
assert(p.photos.some((u) => /patio-project/.test(u)), "real content photo kept");
assert(new Set(p.photos.map((u)=>u.split("?")[0])).size === p.photos.length, "photos deduped");

// 3) Reviews -> themes (not a dump)
assert(p.reviewThemes.themes.length > 0, "should extract review themes");
assert(p.reviewThemes.themes.some((t) => t.theme === "masonry" || t.theme === "patio"), "themes reflect real content");

// 4) Opportunities bounded + ranked (high first)
assert(p.opportunities.length <= GOLDILOCKS.maxOpportunities, "opportunities bounded");
assert(p.opportunities[0].severity === "high", "highest-severity opportunity surfaced first");

console.log("PASS — Goldilocks smoke");
console.log("  photos:", found.photos.length, "->", p.photos.length, "(junk cut, capped)");
console.log("  NAP mismatch:", phoneMiss.field, phoneMiss.site, "vs", phoneMiss.other);
console.log("  review themes:", p.reviewThemes.themes.map((t)=>t.theme).join(", "));
console.log("  opportunities:", p.opportunities.map((o)=>`${o.severity}:${o.type}`).join("  "));
