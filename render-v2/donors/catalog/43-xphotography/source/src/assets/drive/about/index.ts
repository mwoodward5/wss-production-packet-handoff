import headshot from "./03.jpg.asset.json";
import stunningGold from "./02.jpg.asset.json";
import lovingEmbrace from "./01.jpg.asset.json";

export type Photo = { url: string; w: number; h: number; alt: string };

export const headshotPhoto: Photo = { url: headshot.url, w: 2500, h: 3653, alt: "Xavier Jordan, founder of XPhotography" };
export const stunningGoldPhoto: Photo = { url: stunningGold.url, w: 2500, h: 1667, alt: "Editorial portrait in stunning gold light by XPhotography" };
export const lovingEmbracePhoto: Photo = { url: lovingEmbrace.url, w: 2500, h: 1678, alt: "Loving embrace captured by XPhotography" };

export const aboutPhotos: Photo[] = [headshotPhoto, stunningGoldPhoto, lovingEmbracePhoto];
export default aboutPhotos;
