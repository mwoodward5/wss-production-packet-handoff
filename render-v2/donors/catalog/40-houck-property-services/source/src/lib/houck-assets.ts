import backyard from "@/assets/houck/hero-backyard-Cd_IrEsY.webp.asset.json";
import kitchen from "@/assets/houck/hero-kitchen-Bp8l5nz8.webp.asset.json";
import pergola from "@/assets/houck/hero-pergola-CqUgDbI6.webp.asset.json";
import gate from "@/assets/houck/hero-gate-B8t0hw9Z.webp.asset.json";
import mark from "@/assets/houck/houck-mark-34mPWMQA.png.asset.json";
import gServiceYard from "@/assets/houck/gallery-service-yard-BjIBsLmt.webp.asset.json";
import gBarnDoor from "@/assets/houck/gallery-barn-door-BGp-XFsb.webp.asset.json";
import gVanity from "@/assets/houck/gallery-vanity-B7oGRm1Y.webp.asset.json";
import gTurf from "@/assets/houck/gallery-backyard-turf-B34fo0Xw.webp.asset.json";
import gKitchenLiving from "@/assets/houck/gallery-kitchen-living-D6KKj8Ea.webp.asset.json";
import gPergola from "@/assets/houck/gallery-pergola-BlctdTsB.webp.asset.json";
import gBlackGate from "@/assets/houck/gallery-black-gate-9J_qNdIv.webp.asset.json";
import gShelves from "@/assets/houck/gallery-kitchen-shelves-C7GGmnLT.webp.asset.json";
import gPavers from "@/assets/houck/gallery-side-yard-pavers-DbzZF2YE.webp.asset.json";
import gWine from "@/assets/houck/gallery-wine-cabinet-oZSqsdM5.webp.asset.json";
import gPool from "@/assets/houck/gallery-pool-patio-Dy6jMfoD.webp.asset.json";
import gFence from "@/assets/houck/gallery-yard-fence-EfcB0KW_.webp.asset.json";

export const houckMark = mark.url;

export const heroPlates = [
  { url: backyard.url, label: "Backyard build · LP-0421" },
  { url: kitchen.url, label: "Kitchen remodel · LP-0388" },
  { url: pergola.url, label: "Custom pergola · LP-0356" },
  { url: gate.url, label: "Forged side gate · LP-0312" },
];

export type WorkItem = {
  url: string;
  alt: string;
  category: "Outdoor" | "Interior" | "Finish";
  caption: string;
};

export const work: WorkItem[] = [
  { url: gKitchenLiving.url, alt: "Open-plan kitchen and living remodel", category: "Interior", caption: "Open-plan kitchen + living remodel" },
  { url: gTurf.url, alt: "Backyard turf install with mountain view", category: "Outdoor", caption: "Backyard turf, mountain view" },
  { url: gPergola.url, alt: "Custom pergola over paver patio", category: "Outdoor", caption: "Pergola over paver patio" },
  { url: gVanity.url, alt: "Bathroom vanity finish carpentry", category: "Finish", caption: "Bath vanity finish carpentry" },
  { url: gBlackGate.url, alt: "Custom black metal side gate", category: "Outdoor", caption: "Black metal side gate" },
  { url: gShelves.url, alt: "Open kitchen shelving with tile backsplash", category: "Interior", caption: "Open shelving + tile" },
  { url: gPavers.url, alt: "Side-yard paver walkway", category: "Outdoor", caption: "Side-yard paver walkway" },
  { url: gWine.url, alt: "Built-in wine and bar cabinet", category: "Finish", caption: "Built-in wine + bar cabinet" },
  { url: gBarnDoor.url, alt: "Sliding barn door install", category: "Finish", caption: "Sliding barn door install" },
  { url: gPool.url, alt: "Pool patio refresh", category: "Outdoor", caption: "Pool patio refresh" },
  { url: gServiceYard.url, alt: "Tidy service-yard layout", category: "Outdoor", caption: "Tidy service-yard layout" },
  { url: gFence.url, alt: "Repaired and stained yard fence", category: "Outdoor", caption: "Repaired + stained yard fence" },
];