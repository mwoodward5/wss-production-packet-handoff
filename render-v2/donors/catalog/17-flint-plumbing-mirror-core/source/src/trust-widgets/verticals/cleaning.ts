import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["CATALOG_PRICED", "TRUST_CREDENTIALS", "REVIEWS_REP", "BOOKING_AVAIL"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const cleaningPreset: VerticalPreset = {
  key: "cleaning",
  schemaType: "HousePainter",
  category: "Home Cleaning Service",
  labels: {
    "workNoun": "clean",
    "workNounPlural": "cleans",
    "customerNoun": "client",
    "customerNounPlural": "clients",
    "bookVerb": "Book",
    "bookCta": "Book a cleaning",
    "quoteCta": "Get an instant quote",
    "galleryTitle": "Before & after",
    "reviewsTitle": "What clients say",
    "credentialsTitle": "Bonded & insured cleaners",
    "serviceMenuTitle": "Cleaning plans"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Standard clean",
    "Deep clean",
    "Move-out clean",
    "Recurring plan",
    "Post-construction",
    "Office cleaning"
],
  suggestedVoiceQuestions: [
    "Who does house cleaning near me?",
    "How much is a deep clean?",
    "Do you bring your own supplies?",
    "Are your cleaners insured?"
],
};
