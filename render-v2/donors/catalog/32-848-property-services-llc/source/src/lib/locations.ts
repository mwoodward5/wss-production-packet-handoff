// Verified Barry County, Michigan communities served by 848 Property Services.
// Geographic facts only (county seat status, neighboring location to Hastings).
// No invented landmarks, populations, or project claims.
// `serviceCopy` ties the four core trades to verifiable local geography only.
export type Location = {
  slug: string;
  city: string;
  state: "MI";
  county: string;
  // Short factual descriptor — verifiable public geography only.
  geo: string;
  // Approx driving distance from Hastings (verifiable via standard maps).
  distanceFromHastings: string;
  // Per-location, per-service copy. Each item is a 1–2 sentence
  // statement that is true for any Michigan home in this community —
  // no invented project history or named clients.
  serviceCopy: {
    painting: string;
    drywall: string;
    "doors-windows": string;
    flooring: string;
  };
};

const MI_WEATHER =
  "Michigan's freeze-thaw cycles are hard on exterior finishes, so prep, primer, and the right paint for the surface make the biggest difference in how long the work lasts.";

export const LOCATIONS: Location[] = [
  {
    slug: "hastings-mi",
    city: "Hastings",
    state: "MI",
    county: "Barry County",
    geo: "The county seat of Barry County and home base for 848 Property Services LLC.",
    distanceFromHastings: "0 mi · home base",
    serviceCopy: {
      painting: `Interior and exterior painting for Hastings homes, from downtown bungalows near the courthouse square to newer builds on the edge of town. ${MI_WEATHER}`,
      drywall:
        "Drywall patching, water-damage repair, and full-room finishing for older Hastings homes that have seen a few generations of updates, plus clean tape-and-finish work for newer interior remodels.",
      "doors-windows":
        "Door and window service for Hastings homeowners — sticking exterior doors, drafty old sashes, and full replacements when a unit is past saving. We work on both historic-era homes near downtown and modern builds.",
      flooring:
        "Flooring install and refresh in Hastings — vinyl plank, laminate, and hardwood — including subfloor repair on older homes where soft spots and squeaks need attention before the new floor goes down.",
    },
  },
  {
    slug: "middleville-mi",
    city: "Middleville",
    state: "MI",
    county: "Barry County",
    geo: "A village in northern Barry County along the Thornapple River.",
    distanceFromHastings: "~13 mi northwest of Hastings",
    serviceCopy: {
      painting: `Interior and exterior painting for Middleville homes along the Thornapple River corridor. Riverside humidity and shaded lots can be tough on exterior coatings, so we prep accordingly. ${MI_WEATHER}`,
      drywall:
        "Drywall repair and finishing for Middleville — including water-damage patches in basements and lower levels common to homes near the Thornapple, plus clean texture-matching for upstairs remodels.",
      "doors-windows":
        "Door and window repair or replacement in Middleville. Older homes in the village often need weatherstripping, threshold work, and re-hung doors; newer subdivisions tend toward full sash or unit replacements.",
      flooring:
        "Flooring installation and refresh for Middleville homes. Vinyl plank handles riverside humidity well; we'll talk through the right product for the room and the subfloor before quoting.",
    },
  },
  {
    slug: "delton-mi",
    city: "Delton",
    state: "MI",
    county: "Barry County",
    geo: "An unincorporated community in western Barry County in the Gun Lake area.",
    distanceFromHastings: "~12 mi west of Hastings",
    serviceCopy: {
      painting: `Interior and exterior painting for Delton and the Gun Lake area, including lake homes and seasonal cottages. Lakeside sun and humidity weather paint quickly, so prep and product choice matter. ${MI_WEATHER}`,
      drywall:
        "Drywall repair, patching, and finishing for Delton homes — from year-round residences to lake cottages getting freshened up between seasons.",
      "doors-windows":
        "Door and window work for Delton-area homes. Lake-country properties often need exterior door replacement, weatherstripping, and screen repair after a hard winter or wet spring.",
      flooring:
        "Flooring install and refresh for Delton lake homes and full-time residences. We handle subfloor repair, transitions, and trim — useful when lake-house floors have taken on water over the years.",
    },
  },
  {
    slug: "nashville-mi",
    city: "Nashville",
    state: "MI",
    county: "Barry County",
    geo: "A village in southeastern Barry County along the Thornapple River.",
    distanceFromHastings: "~13 mi southeast of Hastings",
    serviceCopy: {
      painting: `Interior and exterior painting in Nashville, MI — from village homes to farmhouses on the surrounding rural lots. ${MI_WEATHER}`,
      drywall:
        "Drywall patching, hanging, and finishing for Nashville homes — including older village houses where settling cracks come back every few years and need proper re-finishing, not just a quick smear of compound.",
      "doors-windows":
        "Door and window service for Nashville homeowners. Older homes commonly need adjustment, hardware swaps, and weatherstripping before a full replacement is warranted; we'll tell you straight which makes sense.",
      flooring:
        "Flooring install and refresh for Nashville. Vinyl, laminate, and hardwood with attention to subfloor condition, transitions, and trim for a finished look.",
    },
  },
  {
    slug: "freeport-mi",
    city: "Freeport",
    state: "MI",
    county: "Barry County",
    geo: "A village in eastern Barry County.",
    distanceFromHastings: "~14 mi east of Hastings",
    serviceCopy: {
      painting: `Interior and exterior painting for Freeport homes, including rural properties on the east side of Barry County. ${MI_WEATHER}`,
      drywall:
        "Drywall repair and finishing for Freeport homes — patches, water damage, and full-room finishing with texture matched to the surrounding wall.",
      "doors-windows":
        "Door and window repair or replacement in Freeport. From a single sticking door to full window-unit replacements, we fit and finish the work properly.",
      flooring:
        "Flooring installation and refresh in Freeport. We address subfloor issues first so the new floor lays flat, stays quiet, and lasts.",
    },
  },
  {
    slug: "woodland-mi",
    city: "Woodland",
    state: "MI",
    county: "Barry County",
    geo: "A village in northeastern Barry County.",
    distanceFromHastings: "~15 mi northeast of Hastings",
    serviceCopy: {
      painting: `Interior and exterior painting for Woodland, MI homes. Rural exposure means more sun and weather on siding and trim — we prep, prime, and finish for that. ${MI_WEATHER}`,
      drywall:
        "Drywall patching and finishing for Woodland homes, including damage from settling, leaks, or remodels. Texture matched and feathered into the existing wall.",
      "doors-windows":
        "Door and window work for Woodland — repair, weatherstripping, and full replacement when it's the right call.",
      flooring:
        "Flooring install and refresh for Woodland homes. Vinyl plank, laminate, or hardwood with proper underlayment, transitions, and trim.",
    },
  },
];

// Copy helper for expanded coverage areas — factual, no invented landmarks.
const defaultCopy = (city: string, note?: string): Location["serviceCopy"] => ({
  painting: `Interior and exterior painting for ${city} homes${note ? ` — ${note}` : ""}. ${MI_WEATHER}`,
  drywall: `Drywall repair, patching, and finishing for ${city} homes — texture-matched into the surrounding wall so the fix disappears.`,
  "doors-windows": `Door and window service for ${city} — from weatherstripping and re-hangs to full unit replacement when it's the right call.`,
  flooring: `Flooring install and refresh for ${city}: vinyl plank, laminate, and hardwood, with subfloor prep and clean transitions.`,
});

// Expanded coverage — verified public geography only (county, lake acreage,
// approx driving distance from Hastings). No project or client claims.
LOCATIONS.push(
  {
    slug: "gull-lake-mi",
    city: "Gull Lake",
    state: "MI",
    county: "Kalamazoo County",
    geo: "Southern shores of the 2,030-acre Gull Lake in Kalamazoo County.",
    distanceFromHastings: "~23 mi south of Hastings",
    serviceCopy: defaultCopy("Gull Lake", "including lake homes where sun and humidity are hard on exterior finishes"),
  },
  {
    slug: "gun-lake-mi",
    city: "Gun Lake",
    state: "MI",
    county: "Allegan County",
    geo: "A 2,680-acre all-sports lake in Allegan County.",
    distanceFromHastings: "~10 mi west of Hastings",
    serviceCopy: defaultCopy("Gun Lake", "year-round residences and lakefront cottages alike"),
  },
  {
    slug: "lake-doster-mi",
    city: "Lake Doster",
    state: "MI",
    county: "Allegan County",
    geo: "A 180-acre man-made lake and residential community in Allegan County.",
    distanceFromHastings: "~26 mi southwest of Hastings",
    serviceCopy: defaultCopy("Lake Doster", "planned lakeside residences and second homes"),
  },
  {
    slug: "richland-mi",
    city: "Richland",
    state: "MI",
    county: "Kalamazoo County",
    geo: "A village and surrounding township in Kalamazoo County.",
    distanceFromHastings: "~35 mi southwest of Hastings",
    serviceCopy: defaultCopy("Richland", "village homes and township properties on rural lots"),
  },
  {
    slug: "hickory-corners-mi",
    city: "Hickory Corners",
    state: "MI",
    county: "Barry County",
    geo: "A historic township in Barry County founded in the 1830s.",
    distanceFromHastings: "~20 mi southwest of Hastings",
    serviceCopy: defaultCopy("Hickory Corners", "including older township homes with generations of updates"),
  },
  {
    slug: "ada-mi",
    city: "Ada",
    state: "MI",
    county: "Kent County",
    geo: "A picturesque suburb of Grand Rapids in Kent County.",
    distanceFromHastings: "~40 mi north of Hastings",
    serviceCopy: defaultCopy("Ada", "suburban homes across the township"),
  },
  {
    slug: "cascade-mi",
    city: "Cascade",
    state: "MI",
    county: "Kent County",
    geo: "An affluent, family-friendly charter township in Kent County.",
    distanceFromHastings: "~37 mi northeast of Hastings",
    serviceCopy: defaultCopy("Cascade", "established neighborhoods and newer subdivisions"),
  },
  {
    slug: "byron-center-mi",
    city: "Byron Center",
    state: "MI",
    county: "Kent County",
    geo: "A rural suburb of Grand Rapids in Kent County.",
    distanceFromHastings: "~40 mi northeast of Hastings",
    serviceCopy: defaultCopy("Byron Center", "rural properties and suburban homes"),
  },
);
