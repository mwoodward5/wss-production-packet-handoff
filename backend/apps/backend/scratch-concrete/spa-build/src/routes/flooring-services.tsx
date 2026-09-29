import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/projects/project-07.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "What flooring do you install?", a: "Tile, laminate, and vinyl plank — installed clean and level, with subfloor prep quoted as its own line because it decides how the floor wears." },
  { q: "How long does flooring take?", a: "Depends on area and material — tile runs longer than plank. The written quote states the schedule including prep and cure times." },
  { q: "Do you fix the subfloor too?", a: "Subfloor leveling and prep are part of the quoted scope — a floor installed over a bad subfloor is a floor that fails early." },
  { q: "Can you match existing flooring?", a: "Matching for additions and repairs is assessed on the site visit, with an honest written answer about how close the match will be." },
  { q: "Is demolition of old flooring included?", a: "Removal and haul-off of existing flooring is quoted alongside the install — one scope, one number." },
];

export const Route = createFileRoute("/flooring-services")({
  head: () => ({
    meta: [
      { title: "Flooring Installation in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Tile, laminate and vinyl plank flooring installed clean and level in {{CITY}}, {{STATE}}. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Flooring Installation in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Tile, laminate, and vinyl plank flooring installed clean and level." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/flooring-services" }],
    scripts: [
      jsonLd(servicePageLd(
        "Flooring Services",
        "Tile, laminate, and vinyl plank flooring installed clean and level in {{CITY}}, {{STATE}}.",
        "/flooring-services",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Flooring Services", path: "/flooring-services" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="flooring-services"
      title="Flooring Services"
      heroHeadline="Floors installed level, and built to stay that way."
      heroSub="Tile, laminate, and vinyl plank — with the subfloor prep that decides how the floor wears, quoted as its own line."
      heroImage={heroImg}
      heroImageAlt="Tile flooring being installed"
      inShort="{{BUSINESS_NAME}} installs flooring in {{CITY}}, {{STATE}} — tile, laminate, and vinyl plank, with removal, subfloor prep, and installation itemized in one written quote."
      whyBest={[
        "Subfloor prep quoted first — the floor under the floor decides the outcome.",
        "Removal and haul-off of old flooring inside the same scope.",
        "Material guidance matched to the room: wet areas, traffic, and sunlight.",
        "Layout planned so seams and grout lines land where they belong.",
        "One written schedule including cure times before the room goes back in service.",
      ]}
      affordable="Fair flooring pricing follows prep and material — a floor installed over an unlevel subfloor fails no matter what it cost. The quote itemizes removal, prep, material, and install, so the number matches the work."
      cost={{
        range: "Quoted per project — removal, prep, material, and installation each named as their own line.",
        factors: [
          "Material selection (tile, laminate, vinyl plank)",
          "Area and layout complexity",
          "Subfloor condition and leveling",
          "Removal and haul-off of existing flooring",
          "Pattern work and transitions",
          "Wet-area requirements (bathrooms, entries)",
          "Baseboard and trim coordination",
        ],
      }}
      hireChecklist={[
        "Ask what subfloor work the quote includes — prep is the floor's foundation.",
        "Confirm removal and haul-off are in the written price.",
        "Get transitions and trim details itemized.",
        "Ask about cure and set times before furniture returns.",
        "Check wet-area details for bathrooms and entries.",
        "Ask for photos of recent installs in the same material.",
      ]}
      problems={[
        "Plank gaps and tenting from a floor installed over an unlevel subfloor.",
        "Cracked tile from skipped prep and wrong setting material.",
        "Hollow spots where adhesive coverage was skimped.",
        "Transitions that trip feet between rooms.",
        "Water damage in wet areas from wrong material or sealing.",
        "Seams and grout lines landing mid-doorway because layout was improvised.",
      ]}
      highIntentAnswers={[
        { q: "Who should install my flooring?", a: "An installer who quotes subfloor prep as its own line and plans the layout before starting — those two things decide how the floor wears." },
        { q: "Tile, laminate, or vinyl plank?", a: "Tile for wet areas and hard wear; plank for speed and comfort. The quote prices each so the choice follows the room, not the sales pitch." },
        { q: "How do I compare flooring bids?", a: "Check the prep lines: removal, leveling, and underlayment. The cheapest bid usually thins the layer nobody sees." },
        { q: "How long before we can use the room?", a: "Cure and set times are stated in the written schedule — tile needs its cure window, plank needs its acclimation, and both get respected." },
      ]}
      faqs={faqs}
      narrative={[
        "Flooring is the most-used surface in a building, and the least of it is visible: the subfloor, the underlayment, the leveling, the adhesive coverage. A floor is only as flat as what is under it — which is why prep gets its own line in the quote instead of being skipped to hit a number.",
        "Material choice follows the room. Wet areas want tile or properly rated plank; high-traffic routes want materials that forgive; sunlit rooms want finishes that hold their color. The quote prices the options so the decision is informed, not pushed.",
        "Installation is craft at the details: layouts planned so grout lines and seams land where they belong, transitions flush between rooms, and trim coordinated so the floor looks finished, not patched.",
      ]}
      benefits={[
        { title: "Prep first", body: "Subfloor leveling and underlayment quoted as their own lines." },
        { title: "Removal included", body: "Old flooring out and hauled inside the same scope." },
        { title: "Layout planned", body: "Seams and grout lines placed before the first piece is set." },
        { title: "Wet-area rated", body: "Materials and sealing matched to bathrooms and entries." },
        { title: "Written schedule", body: "Cure and acclimation times stated up front." },
      ]}
      materials={[
        { label: "Tile", value: "Ceramic, porcelain, and natural stone" },
        { label: "Plank", value: "Vinyl plank and laminate per rating" },
        { label: "Underlayment", value: "Moisture and acoustic layers per need" },
        { label: "Transitions", value: "Matching thresholds and reducers itemized" },
      ]}
      projectTypes={[
        "Whole-home flooring",
        "Bathroom and kitchen tile",
        "Commercial plank and tile",
        "Basement and garage flooring",
        "Repairs and matching",
        "Transitions and trim work",
      ]}
    />
  ),
});
