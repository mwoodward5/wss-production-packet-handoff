import LocationPage, { LocationData } from "@/components/LocationPage";
import cover from "@/assets/photos/portrait.jpg";

const data: LocationData = {
  slug: "buckhead",
  city: "Buckhead",
  region: "GA",
  eyebrow: "Folio 021 · Buckhead",
  title: "Buckhead photography, planned around the right hour.",
  italic: "Buckhead",
  intro: "Editorial portraits, engagements, and weddings across Buckhead — Swan House, Cathedral of St. Philip, Garden Hills, Chastain, and the streets between. Planned around Atlanta's light, not against it.",
  cover,
  seoTitle: "Buckhead Photographer · Engagements & Weddings",
  seoDesc: "Editorial Buckhead photography — engagements, portraits, and weddings at Swan House, Atlanta History Center, and Cathedral of St. Philip by Xavier Jordan.",
  body: [
    { h2: "Why Buckhead photographs differently", p: [
      "Buckhead has the most-photographed locations in Atlanta and the worst average photographs. The reason is hour. People shoot at noon, in front of icons, with no plan for shadow. Buckhead's light needs to be scheduled. Late afternoon is the gift. Mid-morning works in open shade. Anything between is a fight.",
      "I have walked the grounds at the Atlanta History Center at every hour of every season. I know which crape myrtle catches the corridor light at 5:34 in October. The full breakdown, with venues, is in the engagement-locations guide.",
    ]},
    { h2: "What sessions in Buckhead look like", p: [
      "A typical Buckhead engagement runs ninety minutes across three locations within a five-mile loop. We open in open shade so you settle in front of the camera, move to the strongest location at peak light, and finish at sunset somewhere with skyline or streetlight. Wedding portraits at Swan House follow the same logic, compressed.",
      "Editorial portraits for Buckhead executives and founders happen at the office or at a residence with strong windows. Corporate group sessions are scheduled around the firm's work, not the firm's calendar.",
    ]},
    { h2: "What I bring to a Buckhead session", p: [
      "Three primes: 35mm, 50mm, 85mm. A 4x4 negative-fill flag for portraits. A reflector that mostly stays in the bag. Quiet. Punctuality. A truck that does not block the driveway.",
    ]},
  ],
  venues: [
    { name: "Swan House at the Atlanta History Center", note: "Symmetry, gardens, west-facing lawn." },
    { name: "Cathedral of St. Philip courtyard", note: "Limestone, fountain, ivy in open shade." },
    { name: "The Estate on Piedmont", note: "Garden, ballroom, columned portico." },
    { name: "Chastain Park equestrian trails", note: "Hardwoods, dappled afternoon light." },
    { name: "Garden Hills neighborhood", note: "Sidewalk-friendly residential textures." },
    { name: "Bobby Jones Golf Course frontage", note: "Open slope facing northeast for fall mornings." },
  ],
};

export default function Buckhead() { return <LocationPage data={data} />; }
