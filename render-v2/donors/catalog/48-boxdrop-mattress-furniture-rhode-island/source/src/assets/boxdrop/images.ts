// Central image registry — all scraped from boxdroprhodeisland.com, hosted on Lovable CDN.
import saveMore from "./save-more.png.asset.json";
import avoidPaying from "./avoid-paying.png.asset.json";
import iconFurniture from "./icon-furniture.jpg.asset.json";
import iconMattressTypes from "./icon-mattress-types.jpg.asset.json";
import iconMattressSizes from "./icon-mattress-sizes.jpg.asset.json";
import iconMattressBrands from "./icon-mattress-brands.jpg.asset.json";
import synchronyBanner from "./synchrony-banner.jpg.asset.json";
import brandNewPlastic from "./brand-new-plastic.jpg.asset.json";
import warranty from "./warranty.png.asset.json";
import actFast from "./act-fast.jpg.asset.json";
import delivery from "./delivery.png.asset.json";
import bd1 from "./bd-1.jpg.asset.json";
import bd2 from "./bd-2.jpg.asset.json";
import happyLoveseat from "./happy-loveseat.jpg.asset.json";
import happyStorageSectional from "./happy-storage-sectional.jpg.asset.json";
import happyWomanCouch from "./happy-woman-couch.jpg.asset.json";
import happyCouplesSofa from "./happy-couples-sofa.jpg.asset.json";
import happyFamilySofa from "./happy-family-sofa.jpg.asset.json";
import happyVeterans from "./happy-veterans.jpg.asset.json";
import happyTruck from "./happy-truck.jpg.asset.json";
import happyLightCouch from "./happy-light-couch.jpg.asset.json";
import happyCoupleSectional from "./happy-couple-sectional.jpg.asset.json";

export const img = {
  saveMore: saveMore.url,
  avoidPaying: avoidPaying.url,
  iconFurniture: iconFurniture.url,
  iconMattressTypes: iconMattressTypes.url,
  iconMattressSizes: iconMattressSizes.url,
  iconMattressBrands: iconMattressBrands.url,
  synchronyBanner: synchronyBanner.url,
  brandNewPlastic: brandNewPlastic.url,
  warranty: warranty.url,
  actFast: actFast.url,
  delivery: delivery.url,
  bd1: bd1.url,
  bd2: bd2.url,
};

export const happyCustomers = [
  { src: happyLoveseat.url, alt: "Happy BoxDrop customer with new loveseat" },
  { src: happyStorageSectional.url, alt: "Customer with new storage sectional" },
  { src: happyWomanCouch.url, alt: "Customer with new couch" },
  { src: happyCouplesSofa.url, alt: "Couple with new sofa from BoxDrop" },
  { src: happyFamilySofa.url, alt: "Family with new sofa from BoxDrop" },
  { src: happyVeterans.url, alt: "Veterans BoxDrop customers" },
  { src: happyTruck.url, alt: "Customer loading new couch in truck" },
  { src: happyLightCouch.url, alt: "Couple with new light-colored couch" },
  { src: happyCoupleSectional.url, alt: "Couple with new sectional" },
] as const;
