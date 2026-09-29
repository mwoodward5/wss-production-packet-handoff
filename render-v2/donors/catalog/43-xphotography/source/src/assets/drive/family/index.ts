import p01 from "./01.jpg.asset.json";
import p02 from "./02.jpg.asset.json";
import p03 from "./03.jpg.asset.json";
import p04 from "./04.jpg.asset.json";
import p05 from "./05.jpg.asset.json";
import p06 from "./06.jpg.asset.json";
import p07 from "./07.jpg.asset.json";
import p08 from "./08.jpg.asset.json";
import p09 from "./09.jpg.asset.json";
import p10 from "./10.jpg.asset.json";
import p11 from "./11.jpg.asset.json";
import p12 from "./12.jpg.asset.json";

export type Photo = { url: string; w: number; h: number; alt: string };

export const photos: Photo[] = [
  { url: p01.url, w: 1000, h: 730, alt: "family photo 1" },
  { url: p02.url, w: 1000, h: 1500, alt: "family photo 2" },
  { url: p03.url, w: 1000, h: 1500, alt: "family photo 3" },
  { url: p04.url, w: 1000, h: 1500, alt: "family photo 4" },
  { url: p05.url, w: 1000, h: 667, alt: "family photo 5" },
  { url: p06.url, w: 1000, h: 667, alt: "family photo 6" },
  { url: p07.url, w: 1000, h: 667, alt: "family photo 7" },
  { url: p08.url, w: 1000, h: 667, alt: "family photo 8" },
  { url: p09.url, w: 1000, h: 740, alt: "family photo 9" },
  { url: p10.url, w: 1000, h: 1500, alt: "family photo 10" },
  { url: p11.url, w: 1000, h: 1500, alt: "family photo 11" },
  { url: p12.url, w: 1000, h: 1500, alt: "family photo 12" },
];
export default photos;