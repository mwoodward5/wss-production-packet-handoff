import p01 from "./01.jpg.asset.json";
import p02 from "./02.jpg.asset.json";
import p03 from "./03.jpg.asset.json";
import p04 from "./04.jpg.asset.json";
import p05 from "./05.jpg.asset.json";
import p06 from "./06.jpg.asset.json";
import p07 from "./07.jpg.asset.json";
import p08 from "./08.jpg.asset.json";
import p09 from "./09.jpg.asset.json";

export type Photo = { url: string; w: number; h: number; alt: string };

export const photos: Photo[] = [
  { url: p01.url, w: 1000, h: 1500, alt: "candid photo 1" },
  { url: p02.url, w: 1000, h: 1500, alt: "candid photo 2" },
  { url: p03.url, w: 1000, h: 1500, alt: "candid photo 3" },
  { url: p04.url, w: 1000, h: 1500, alt: "candid photo 4" },
  { url: p05.url, w: 1000, h: 1500, alt: "candid photo 5" },
  { url: p06.url, w: 1000, h: 1500, alt: "candid photo 6" },
  { url: p07.url, w: 1000, h: 1500, alt: "candid photo 7" },
  { url: p08.url, w: 1000, h: 1500, alt: "candid photo 8" },
  { url: p09.url, w: 2500, h: 1667, alt: "candid photo 9" },
];
export default photos;