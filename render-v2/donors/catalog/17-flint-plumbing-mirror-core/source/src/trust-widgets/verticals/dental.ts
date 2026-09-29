import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["TRUST_CREDENTIALS", "REVIEWS_REP", "BOOKING_AVAIL", "LOCAL_GEO"];
const suppress: WidgetCategory[] = [];

export const dentalPreset: VerticalPreset = {
  key: "dental",
  schemaType: "Dentist",
  category: "Family & Cosmetic Dentistry",
  labels: {
    "workNoun": "visit",
    "workNounPlural": "visits",
    "customerNoun": "patient",
    "customerNounPlural": "patients",
    "bookVerb": "Book",
    "bookCta": "Book an appointment",
    "quoteCta": "Request a consultation",
    "galleryTitle": "Smile gallery",
    "reviewsTitle": "What patients say",
    "credentialsTitle": "Licensed dental team",
    "serviceMenuTitle": "Treatments"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Cleaning & exam",
    "Whitening",
    "Invisible aligners",
    "Crowns",
    "Implants",
    "Emergency visit"
],
  suggestedVoiceQuestions: [
    "Is there a dentist near me taking new patients?",
    "How much is a cleaning without insurance?",
    "Do you see dental emergencies?",
    "Do you accept my insurance?"
],
};
