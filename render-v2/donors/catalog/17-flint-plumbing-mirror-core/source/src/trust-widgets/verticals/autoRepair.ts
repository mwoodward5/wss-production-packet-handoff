import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["TRUST_CREDENTIALS", "CATALOG_PRICED", "REVIEWS_REP", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["SOCIAL_UGC"];

export const autoRepairPreset: VerticalPreset = {
  key: "autoRepair",
  schemaType: "AutoRepair",
  category: "Auto Repair & Service",
  labels: {
    "workNoun": "repair",
    "workNounPlural": "repairs",
    "customerNoun": "driver",
    "customerNounPlural": "drivers",
    "bookVerb": "Schedule",
    "bookCta": "Schedule service",
    "quoteCta": "Get a free estimate",
    "galleryTitle": "In the shop",
    "reviewsTitle": "What drivers say",
    "credentialsTitle": "ASE certified technicians",
    "serviceMenuTitle": "Services & pricing",
    "emergencyLabel": "Towing & roadside"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Diagnostics",
    "Brake service",
    "Oil change",
    "Engine repair",
    "Transmission",
    "State inspection"
],
  suggestedVoiceQuestions: [
    "Who does brake repair near me?",
    "How much is an oil change?",
    "How long will my repair take?",
    "Are your technicians ASE certified?"
],
};
