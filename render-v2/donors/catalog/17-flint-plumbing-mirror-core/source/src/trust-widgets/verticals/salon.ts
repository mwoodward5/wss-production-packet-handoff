import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["VISUAL_TRANSFORM", "SOCIAL_UGC", "BOOKING_AVAIL"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const salonPreset: VerticalPreset = {
  key: "salon",
  schemaType: "HairSalon",
  category: "Hair Salon & Color Studio",
  labels: {
    "workNoun": "appointment",
    "workNounPlural": "appointments",
    "customerNoun": "guest",
    "customerNounPlural": "guests",
    "bookVerb": "Book",
    "bookCta": "Book an appointment",
    "quoteCta": "Request a consultation",
    "galleryTitle": "Before & after",
    "reviewsTitle": "What guests say",
    "credentialsTitle": "Licensed stylists",
    "serviceMenuTitle": "Service menu"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Cut & style",
    "Balayage",
    "Full color",
    "Extensions",
    "Keratin treatment",
    "Bridal styling"
],
  suggestedVoiceQuestions: [
    "Where can I get balayage near me?",
    "How much is a full highlight?",
    "Do you have availability this week?",
    "Do you take walk-ins?"
],
};
