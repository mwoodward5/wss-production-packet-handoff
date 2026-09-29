import { plumbingPreset } from "./plumbing";
import { hvacPreset } from "./hvac";
import { electricalPreset } from "./electrical";
import { roofingPreset } from "./roofing";
import { landscapingPreset } from "./landscaping";
import { tattooPreset } from "./tattoo";
import { salonPreset } from "./salon";
import { medspaPreset } from "./medspa";
import { dentalPreset } from "./dental";
import { legalPreset } from "./legal";
import { restaurantPreset } from "./restaurant";
import { autoRepairPreset } from "./autoRepair";
import { cleaningPreset } from "./cleaning";
export * from "./types";
export { plumbingPreset } from "./plumbing";
export { hvacPreset } from "./hvac";
export { electricalPreset } from "./electrical";
export { roofingPreset } from "./roofing";
export { landscapingPreset } from "./landscaping";
export { tattooPreset } from "./tattoo";
export { salonPreset } from "./salon";
export { medspaPreset } from "./medspa";
export { dentalPreset } from "./dental";
export { legalPreset } from "./legal";
export { restaurantPreset } from "./restaurant";
export { autoRepairPreset } from "./autoRepair";
export { cleaningPreset } from "./cleaning";

export const verticalPresets = {
  plumbing: plumbingPreset,
  hvac: hvacPreset,
  electrical: electricalPreset,
  roofing: roofingPreset,
  landscaping: landscapingPreset,
  tattoo: tattooPreset,
  salon: salonPreset,
  medspa: medspaPreset,
  dental: dentalPreset,
  legal: legalPreset,
  restaurant: restaurantPreset,
  autoRepair: autoRepairPreset,
  cleaning: cleaningPreset,
} as const;

export type VerticalKey = keyof typeof verticalPresets;
