import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["EMERGENCY_URGENCY", "TRUST_CREDENTIALS", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["SOCIAL_UGC", "CATALOG_PRICED"];

export const plumbingPreset: VerticalPreset = {
  key: "plumbing",
  schemaType: "Plumber",
  category: "Plumbing & Drain Service",
  labels: {
    "workNoun": "job",
    "workNounPlural": "jobs",
    "customerNoun": "homeowner",
    "customerNounPlural": "homeowners",
    "bookVerb": "Schedule",
    "bookCta": "Schedule service",
    "quoteCta": "Get a free estimate",
    "galleryTitle": "Recent jobs",
    "reviewsTitle": "What homeowners say",
    "credentialsTitle": "Licensed, bonded & insured",
    "serviceMenuTitle": "Plumbing services",
    "emergencyLabel": "24/7 emergency plumbing"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Emergency leak repair",
    "Drain cleaning",
    "Water heater replacement",
    "Repiping",
    "Sewer camera inspection",
    "Fixture installation"
],
  suggestedVoiceQuestions: [
    "Do you offer emergency plumbing near me?",
    "How much does drain cleaning cost?",
    "How fast can a plumber get here?",
    "Are you licensed and insured?"
],
};
