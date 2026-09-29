import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["VISUAL_TRANSFORM", "SOCIAL_UGC", "BOOKING_AVAIL"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const medspaPreset: VerticalPreset = {
  key: "medspa",
  schemaType: "MedicalClinic",
  category: "Medical Spa & Aesthetics",
  labels: {
    "workNoun": "treatment",
    "workNounPlural": "treatments",
    "customerNoun": "patient",
    "customerNounPlural": "patients",
    "bookVerb": "Book",
    "bookCta": "Book a consultation",
    "quoteCta": "Request a consultation",
    "galleryTitle": "Before & after",
    "reviewsTitle": "What patients say",
    "credentialsTitle": "Medically supervised & licensed",
    "serviceMenuTitle": "Treatment menu"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Neuromodulator",
    "Dermal filler",
    "Laser resurfacing",
    "Microneedling",
    "Body contouring",
    "Medical facial"
],
  suggestedVoiceQuestions: [
    "Where can I get Botox near me?",
    "How much does filler cost?",
    "Who supervises treatments?",
    "Is there downtime after laser resurfacing?"
],
};
