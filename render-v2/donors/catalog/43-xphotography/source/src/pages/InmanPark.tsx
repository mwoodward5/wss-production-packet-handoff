import LocationPage, { LocationData } from "@/components/LocationPage";
import cover from "@/assets/photos/family.jpg";

const data: LocationData = {
  slug: "inman-park",
  city: "Inman Park",
  region: "GA",
  eyebrow: "Folio 022 · Inman Park",
  title: "Inman Park photography for couples who like a city with a porch.",
  italic: "Inman Park",
  intro: "Editorial weddings, engagements, and family sessions in Inman Park — Krog Street Market, the trolley barn, the Beltline, and the Victorian streets that hold the neighborhood's color.",
  cover,
  seoTitle: "Inman Park Photographer · Weddings & Portraits",
  seoDesc: "Inman Park editorial photography — Trolley Barn weddings, Krog Street Market sessions, and Beltline portraits by Xavier Jordan.",
  body: [
    { h2: "Inman Park is the city's living room", p: [
      "Inman Park is the rare Atlanta neighborhood where you can walk a session. We start at the Krog Street tunnel, move up Edgewood, cross into the residential streets with Victorian porches and crape myrtles, and finish at the Beltline as the city goes blue. The whole loop is under a mile.",
      "It is also a working neighborhood. We move politely. We do not block the sidewalk. We tip the bartenders we duck inside to escape a sudden shower.",
    ]},
    { h2: "Wedding venues and reception spaces", p: [
      "The trolley barn at the corner of Edgewood and Lake Avenue is one of Atlanta's most distinctive small-wedding venues — exposed brick, beams, and a courtyard that catches afternoon light. Krog Street Market hosts receptions with a working-market warmth. The Inman Park Festival weekend in late April is unphotographable for portraits and unforgettable for street work.",
    ]},
    { h2: "What an Inman Park session looks like", p: [
      "Engagements: ninety minutes, three locations, finishing on the Beltline at sunset. Families: weekday morning in the residential streets, ending at Bee Coffee. Editorial brand sessions for Inman Park founders and creatives: their actual studio or favorite corner of the neighborhood, on a slow Tuesday.",
    ]},
  ],
  venues: [
    { name: "Inman Park Trolley Barn", note: "Brick, beams, courtyard ceremonies." },
    { name: "Krog Street Market", note: "Working-market warmth, reception flexibility." },
    { name: "Krog Street tunnel", note: "Mural-rich opening for engagement loops." },
    { name: "The Beltline (Eastside Trail)", note: "Sunset portraits with skyline read." },
    { name: "Edgewood Avenue residential blocks", note: "Victorian porches, crape myrtles, dog walkers." },
    { name: "Bee Coffee Roasters", note: "Window light for closing-frame sit-downs." },
  ],
};

export default function InmanPark() { return <LocationPage data={data} />; }
