import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["VISUAL_TRANSFORM", "TRUST_CREDENTIALS", "REVIEWS_REP"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const landscapingPreset: VerticalPreset = {
  key: "landscaping",
  schemaType: "LandscapingBusiness",
  category: "Landscape Design & Maintenance",
  labels: {
    "workNoun": "project",
    "workNounPlural": "projects",
    "customerNoun": "client",
    "customerNounPlural": "clients",
    "bookVerb": "Request",
    "bookCta": "Request a design consult",
    "quoteCta": "Get a free estimate",
    "galleryTitle": "Transformations",
    "reviewsTitle": "What clients say",
    "credentialsTitle": "Licensed & insured",
    "serviceMenuTitle": "Landscape services"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Landscape design",
    "Hardscape & patios",
    "Irrigation",
    "Lawn maintenance",
    "Tree & shrub care",
    "Outdoor lighting"
],
  suggestedVoiceQuestions: [
    "Who does landscaping near me?",
    "How much does a paver patio cost?",
    "Do you offer weekly lawn maintenance?",
    "How long does a landscape project take?"
],
};
