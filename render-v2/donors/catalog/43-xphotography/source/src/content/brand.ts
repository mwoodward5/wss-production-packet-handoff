// Single source of truth for brand facts. Update here, propagates site-wide.
export const BRAND = {
  name: "XPhotography",
  legalName: "XPhotography by Xavier Jordan",
  owner: "Xavier Jordan",
  tagline: "Photography that remembers the way it felt.",
  email: "xphotography20@gmail.com",
  phone: "(404) 227-0606",
  phoneHref: "tel:+14042270606",
  url: "https://xphotography.wss-ai.com",
  address: {
    street: "1100 Krog St NE, Suite 200",
    locality: "Atlanta",
    region: "GA",
    postal: "30307",
    country: "US",
    neighborhood: "Inman Park",
  },
  geo: { lat: 33.7625, lng: -84.3540 },
  hours: [
    { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], opens: "09:00", closes: "18:00" },
    { days: ["Sat"], opens: "By appointment", closes: "" },
  ],
  yearStarted: 2018,
  yearOfPivot: 2020,
  school: "Georgia State University",
  fieldOfStudy: "visual communications",
  influence: "Gordon Parks",
  upbringing: "raised on the east side of Atlanta",
  social: {
    instagram: "https://instagram.com/xphotography20",
    linkedin: "https://www.linkedin.com/in/xavier-jordan-photography",
  },
  gear: [
    "Sony α1",
    "Sony 35mm f/1.4 GM",
    "Sony 85mm f/1.4 GM",
    "Sony 50mm f/1.4 GM",
    "Profoto B10 Plus strobes",
  ],
  serviceArea: ["Atlanta", "Buckhead", "Inman Park", "Decatur", "Sandy Springs", "Alpharetta", "Statewide Georgia"],
  colors: {
    ink: "#0B0B0C",
    gold: "#C9A96E",
    cta: "#F5B324",
    cream: "#F5EFE6",
  },
} as const;

export type Brand = typeof BRAND;
