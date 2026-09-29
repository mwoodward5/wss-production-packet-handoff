import LocationPage, { LocationData } from "@/components/LocationPage";
import cover from "@/assets/photos/hero.jpg";

const data: LocationData = {
  slug: "atlanta",
  city: "Atlanta",
  region: "GA",
  eyebrow: "Folio 020 · Atlanta",
  title: "An Atlanta photographer who knows the city's light.",
  italic: "Atlanta",
  intro: "Atlanta-native editorial and documentary photography across the city — Westside warehouses, Buckhead gardens, Midtown towers, and the in-between hours that make the photographs worth keeping.",
  cover,
  seoTitle: "Atlanta Photographer · Xavier Jordan · XPhotography",
  seoDesc: "Atlanta editorial photographer Xavier Jordan — weddings, portraits, families, and corporate work across Buckhead, Midtown, Westside, and Inman Park.",
  body: [
    { h2: "Working in Atlanta", p: [
      "I have photographed in every quadrant of this city — from Westside Provisions to Druid Hills, from Ponce City Market on a Sunday morning to Goat Farm Arts Center at dusk. Atlanta gives a photographer four real seasons of usable light, a humid sky that softens the sun, and an architectural mix that ranges from antebellum brick to glass towers within a five-minute drive.",
      "Most of my work happens within the city limits. Weddings at Swan House and the Atlanta History Center grounds. Engagements through Inman Park and the Beltline. Editorial portraits in Buckhead Village and at the Cathedral of St. Philip. Corporate sessions for firms in Midtown and downtown towers.",
    ]},
    { h2: "What I shoot in this city", p: [
      "Weddings make up about half the work. Editorial portraits and brand sessions — for founders, partners, creatives, and families — make up most of the rest. Corporate headshot days for Atlanta firms round out the year.",
      "Every project is built around the same instinct: be early, be calm, be paying attention. The city does not need to be pushed. It rewards a photographer who waits.",
    ]},
    { h2: "Neighborhoods I work most often", p: [
      "Buckhead, Midtown, Inman Park, Old Fourth Ward, Cabbagetown, West Midtown, Druid Hills, Decatur, Virginia Highland, Castleberry Hill. Each has a personality. Each photographs differently. The neighborhood guides for Buckhead and Inman Park are linked above. More are written as the work demands them.",
    ]},
  ],
  venues: [
    { name: "Swan House at the Atlanta History Center", note: "Symmetry, gardens, late-afternoon gold." },
    { name: "Summerour Studio", note: "Brick warehouse with a rooftop window wall." },
    { name: "Ventanas", note: "Skyline; fifteen minutes before sunset." },
    { name: "The Estate on Piedmont", note: "Manicured gardens, ballroom, columned portico." },
    { name: "The Stave Room", note: "Texture-rich brick and barrel staves." },
    { name: "Ponce City Market rooftop", note: "Skyline, signage, golden-hour neon." },
    { name: "Atlanta Botanical Garden", note: "Architectural greenery year-round." },
    { name: "The Goat Farm Arts Center", note: "Patina, brick, raw industrial light." },
  ],
};

export default function Atlanta() { return <LocationPage data={data} />; }
