import type { VerticalPreset } from "./types";
import { profileFromCategories } from "../layout/categories";
import type { WidgetCategory } from "../trust.config";

const promote: WidgetCategory[] = ["CATALOG_PRICED", "REVIEWS_REP", "BOOKING_AVAIL", "LOCAL_GEO"];
const suppress: WidgetCategory[] = ["EMERGENCY_URGENCY"];

export const restaurantPreset: VerticalPreset = {
  key: "restaurant",
  schemaType: "Restaurant",
  category: "Restaurant",
  labels: {
    "workNoun": "visit",
    "workNounPlural": "visits",
    "customerNoun": "guest",
    "customerNounPlural": "guests",
    "bookVerb": "Reserve",
    "bookCta": "Reserve a table",
    "quoteCta": "View the menu",
    "galleryTitle": "On the plate",
    "reviewsTitle": "What guests say",
    "credentialsTitle": "Awards & recognition",
    "serviceMenuTitle": "Menu"
},
  widgetProfile: profileFromCategories({ promote, suppress }),
  suggestedServices: [
    "Dinner service",
    "Brunch",
    "Private events",
    "Catering",
    "Bar & cocktails",
    "Takeout"
],
  suggestedVoiceQuestions: [
    "What restaurants are open near me right now?",
    "Do you take reservations?",
    "What is on the menu tonight?",
    "Do you have vegetarian options?"
],
};
