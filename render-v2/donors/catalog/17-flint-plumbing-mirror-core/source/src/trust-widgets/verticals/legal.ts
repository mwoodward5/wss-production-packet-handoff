import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["TRUST_CREDENTIALS", "REVIEWS_REP", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["SOCIAL_UGC", "CATALOG_PRICED"];

export const legalPreset: VerticalPreset = {
  key: "legal",
  schemaType: "LegalService",
  category: "Law Firm",
  labels: {
    "workNoun": "case",
    "workNounPlural": "cases",
    "customerNoun": "client",
    "customerNounPlural": "clients",
    "bookVerb": "Request",
    "bookCta": "Request a case review",
    "quoteCta": "Request a free case review",
    "galleryTitle": "Case results",
    "reviewsTitle": "What clients say",
    "credentialsTitle": "Bar admissions & credentials",
    "serviceMenuTitle": "Practice areas"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Free case review",
    "Personal injury",
    "Family law",
    "Estate planning",
    "Business formation",
    "Criminal defense"
],
  suggestedVoiceQuestions: [
    "Who is the best lawyer near me for my case?",
    "Do you offer free consultations?",
    "How long does a case take?",
    "What are your fees?"
],
};
