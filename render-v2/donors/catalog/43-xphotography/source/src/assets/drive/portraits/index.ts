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
import p13 from "./13.jpg.asset.json";
import p14 from "./14.jpg.asset.json";
import p15 from "./15.jpg.asset.json";
import p16 from "./16.jpg.asset.json";
import p17 from "./17.jpg.asset.json";

export type Photo = { url: string; w: number; h: number; alt: string };

export const photos: Photo[] = [
  { url: p01.url, w: 1000, h: 1500, alt: "portraits photo 1" },
  { url: p02.url, w: 1000, h: 1500, alt: "portraits photo 2" },
  { url: p03.url, w: 1000, h: 1500, alt: "portraits photo 3" },
  { url: p04.url, w: 1000, h: 1500, alt: "portraits photo 4" },
  { url: p05.url, w: 1000, h: 1500, alt: "portraits photo 5" },
  { url: p06.url, w: 1000, h: 1500, alt: "portraits photo 6" },
  { url: p07.url, w: 1000, h: 1500, alt: "portraits photo 7" },
  { url: p08.url, w: 1000, h: 1500, alt: "portraits photo 8" },
  { url: p09.url, w: 1000, h: 1500, alt: "portraits photo 9" },
  { url: p10.url, w: 1400, h: 2100, alt: "portraits photo 10" },
  { url: p11.url, w: 1000, h: 1500, alt: "portraits photo 11" },
  { url: p12.url, w: 1400, h: 2100, alt: "portraits photo 12" },
  { url: p13.url, w: 1400, h: 2100, alt: "portraits photo 13" },
  { url: p14.url, w: 1000, h: 1500, alt: "portraits photo 14" },
  { url: p15.url, w: 1000, h: 1426, alt: "portraits photo 15" },
  { url: p16.url, w: 1000, h: 1500, alt: "portraits photo 16" },
  { url: p17.url, w: 1000, h: 1426, alt: "portraits photo 17" },
];
export default photos;