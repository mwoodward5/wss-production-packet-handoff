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
import p18 from "./18.jpg.asset.json";
import p19 from "./19.jpg.asset.json";

export type Photo = { url: string; w: number; h: number; alt: string };

export const photos: Photo[] = [
  { url: p01.url, w: 1500, h: 2250, alt: "weddings photo 1" },
  { url: p02.url, w: 1500, h: 1001, alt: "weddings photo 2" },
  { url: p03.url, w: 1500, h: 2250, alt: "weddings photo 3" },
  { url: p04.url, w: 1500, h: 1959, alt: "weddings photo 4" },
  { url: p05.url, w: 1500, h: 2250, alt: "weddings photo 5" },
  { url: p06.url, w: 1500, h: 1000, alt: "weddings photo 6" },
  { url: p07.url, w: 1500, h: 1000, alt: "weddings photo 7" },
  { url: p08.url, w: 1500, h: 2099, alt: "weddings photo 8" },
  { url: p09.url, w: 2500, h: 3750, alt: "weddings photo 9" },
  { url: p10.url, w: 1500, h: 1000, alt: "weddings photo 10" },
  { url: p11.url, w: 1500, h: 2250, alt: "weddings photo 11" },
  { url: p12.url, w: 1500, h: 2250, alt: "weddings photo 12" },
  { url: p13.url, w: 1500, h: 2250, alt: "weddings photo 13" },
  { url: p14.url, w: 1500, h: 1000, alt: "weddings photo 14" },
  { url: p15.url, w: 2500, h: 3750, alt: "weddings photo 15" },
  { url: p16.url, w: 1500, h: 2250, alt: "weddings photo 16" },
  { url: p17.url, w: 1500, h: 2023, alt: "weddings photo 17" },
  { url: p18.url, w: 1500, h: 2250, alt: "weddings photo 18" },
  { url: p19.url, w: 1500, h: 1000, alt: "weddings photo 19" },
];
export default photos;