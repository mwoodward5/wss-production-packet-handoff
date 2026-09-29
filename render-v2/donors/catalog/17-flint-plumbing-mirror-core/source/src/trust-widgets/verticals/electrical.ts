import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["EMERGENCY_URGENCY", "TRUST_CREDENTIALS", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["SOCIAL_UGC", "CATALOG_PRICED"];

export const electricalPreset: VerticalPreset = {
  key: "electrical",
  schemaType: "Electrician",
  category: "Residential & Commercial Electrical",
  labels: {
    "workNoun": "job",
    "workNounPlural": "jobs",
    "customerNoun": "customer",
    "customerNounPlural": "customers",
    "bookVerb": "Schedule",
    "bookCta": "Schedule an electrician",
    "quoteCta": "Get a free estimate",
    "galleryTitle": "Recent work",
    "reviewsTitle": "What customers say",
    "credentialsTitle": "Master electrician licensed",
    "serviceMenuTitle": "Electrical services",
    "emergencyLabel": "24/7 electrical emergencies"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Panel upgrade",
    "EV charger install",
    "Rewiring",
    "Lighting design",
    "Generator install",
    "Code correction"
],
  suggestedVoiceQuestions: [
    "Do you handle electrical emergencies?",
    "How much is a panel upgrade?",
    "Can you install an EV charger?",
    "Is your electrician licensed?"
],
};
