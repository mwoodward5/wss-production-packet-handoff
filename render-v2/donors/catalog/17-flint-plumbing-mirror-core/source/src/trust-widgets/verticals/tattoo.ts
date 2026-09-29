import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["VISUAL_TRANSFORM", "SOCIAL_UGC", "BOOKING_AVAIL"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const tattooPreset: VerticalPreset = {
  key: "tattoo",
  schemaType: "TattooParlor",
  category: "Custom Tattoo Studio",
  labels: {
    "workNoun": "piece",
    "workNounPlural": "pieces",
    "customerNoun": "client",
    "customerNounPlural": "clients",
    "bookVerb": "Book",
    "bookCta": "Book a consultation",
    "quoteCta": "Request a quote",
    "galleryTitle": "Portfolio",
    "reviewsTitle": "What clients say",
    "credentialsTitle": "Licensed & bloodborne certified",
    "serviceMenuTitle": "Styles & rates"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Custom blackwork",
    "Fine line",
    "Cover-up",
    "Flash",
    "Touch-up",
    "Consultation"
],
  suggestedVoiceQuestions: [
    "Who is the best tattoo artist near me?",
    "How much does a half sleeve cost?",
    "Do you take walk-ins?",
    "How far out are you booked?"
],
};
