import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["EMERGENCY_URGENCY", "TRUST_CREDENTIALS", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["SOCIAL_UGC", "CATALOG_PRICED"];

export const hvacPreset: VerticalPreset = {
  key: "hvac",
  schemaType: "HVACBusiness",
  category: "Heating & Air Conditioning",
  labels: {
    "workNoun": "job",
    "workNounPlural": "jobs",
    "customerNoun": "homeowner",
    "customerNounPlural": "homeowners",
    "bookVerb": "Schedule",
    "bookCta": "Schedule service",
    "quoteCta": "Get a free estimate",
    "galleryTitle": "Recent installs",
    "reviewsTitle": "What homeowners say",
    "credentialsTitle": "Licensed & EPA certified",
    "serviceMenuTitle": "HVAC services",
    "emergencyLabel": "24/7 emergency heating & cooling"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "AC repair",
    "Furnace repair",
    "System replacement",
    "Duct sealing",
    "Maintenance plan",
    "Indoor air quality"
],
  suggestedVoiceQuestions: [
    "Who repairs AC near me?",
    "How much does a new furnace cost?",
    "Do you offer same-day AC repair?",
    "Are you EPA certified?"
],
};
