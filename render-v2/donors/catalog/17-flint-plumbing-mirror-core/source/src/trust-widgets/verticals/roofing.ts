import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["VISUAL_TRANSFORM", "TRUST_CREDENTIALS", "REVIEWS_REP"];
const suppress: WidgetCategory[] = [];

export const roofingPreset: VerticalPreset = {
  key: "roofing",
  schemaType: "RoofingContractor",
  category: "Roofing & Storm Restoration",
  labels: {
    "workNoun": "project",
    "workNounPlural": "projects",
    "customerNoun": "homeowner",
    "customerNounPlural": "homeowners",
    "bookVerb": "Request",
    "bookCta": "Request a roof inspection",
    "quoteCta": "Get a free inspection",
    "galleryTitle": "Roofs we've built",
    "reviewsTitle": "What homeowners say",
    "credentialsTitle": "Licensed, insured & manufacturer certified",
    "serviceMenuTitle": "Roofing services"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Roof replacement",
    "Storm damage repair",
    "Insurance claim support",
    "Gutter systems",
    "Metal roofing",
    "Annual inspection"
],
  suggestedVoiceQuestions: [
    "Who does roof repair near me?",
    "How much does a new roof cost?",
    "Do you work with insurance claims?",
    "How long does a roof replacement take?"
],
};
