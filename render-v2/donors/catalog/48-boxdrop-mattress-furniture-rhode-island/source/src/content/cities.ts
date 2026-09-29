/**
 * Rich, unique data per service-area city. Drives the city pages,
 * /service-area hub, internal-linking silo, and FAQ generation.
 *
 * Each city carries genuinely different neighborhoods, landmarks, routes,
 * and FAQ content so no two city pages render boilerplate copy.
 */

export type City = {
  slug: string; // "bristol-ri"
  name: string; // "Bristol"
  state: "RI" | "MA";
  driveMinutes: number; // typical drive time to 601 Metacom Ave, Warren
  primaryRoute: string; // e.g., "Route 114"
  directionsHint: string; // human directions from city to showroom
  neighborhoods: string[];
  landmarks: string[];
  vibe: string; // 1-sentence local color
  mattressAngle: string; // why this city shops mattresses with us (2-3 sentences)
  furnitureAngle: string; // why this city shops furniture with us (2-3 sentences)
  nearbySlugs: string[]; // sibling city slugs for cross-linking
  extraFaq: { question: string; answer: string }[]; // 2-3 city-specific Q&A
};

export const cities: City[] = [
  {
    slug: "warren-ri",
    name: "Warren",
    state: "RI",
    driveMinutes: 1,
    primaryRoute: "Route 136 (Metacom Avenue)",
    directionsHint:
      "We are 601 Metacom Ave — south of Child Street, just past the Stop & Shop plaza heading toward Bristol.",
    neighborhoods: ["Touisset", "Jamiel's Park", "Market Street", "Bagy Wrinkle Cove", "Belcher Cove"],
    landmarks: ["Warren Town Beach", "Burr's Hill Park", "East Bay Bike Path", "Hope Street historic district"],
    vibe:
      "Warren is a tight-knit East Bay town where word of mouth still drives shopping decisions — most of our walk-ins are neighbors who heard about us from someone on Market Street.",
    mattressAngle:
      "We are the local mattress store for Warren residents. No driving to Warwick or Seekonk to fight retail crowds — just a short ride down Metacom and you can lay on a queen hybrid in fifteen minutes.",
    furnitureAngle:
      "From the Touisset condos to the bungalows off Child Street, Warren homes lean small-to-mid, so we keep apartment-depth sectionals, loveseats, and recliners on the floor every week.",
    nearbySlugs: ["bristol-ri", "barrington-ri", "swansea-ma"],
    extraFaq: [
      {
        question: "Where exactly in Warren is BoxDrop located?",
        answer:
          "601 Metacom Avenue — on Route 136, south of Child Street. If you are coming from the Warren waterfront or Water Street, head west to Metacom and turn south; we are about a mile down on the right.",
      },
      {
        question: "Can I walk in from downtown Warren?",
        answer:
          "We're roughly a mile from Water Street. Most local folks drive, but the East Bay Bike Path passes a few blocks away if you want to combine a stop with a ride.",
      },
    ],
  },
  {
    slug: "bristol-ri",
    name: "Bristol",
    state: "RI",
    driveMinutes: 10,
    primaryRoute: "Route 114 / Hope Street",
    directionsHint:
      "From Hope Street, head north through Warren — we're on Metacom (Route 136) about a mile after you cross into Warren proper.",
    neighborhoods: ["Mount Hope", "Poppasquash Point", "Bristol Highlands", "Walley Street", "Metacom Avenue corridor"],
    landmarks: ["Colt State Park", "Linden Place", "Roger Williams University", "Mount Hope Bridge", "Independence Park"],
    vibe:
      "Bristol shoppers tend to know what they want and value local service — Roger Williams students filling first apartments, families upgrading Mount Hope homes, and waterfront condo owners replacing aging mattresses.",
    mattressAngle:
      "Skip the Route 114 traffic up to the mall corridor — we're ten minutes north of Hope Street with the same brand-name queens and kings at clearance pricing.",
    furnitureAngle:
      "Bristol's older homes have tight doorways and narrow stairs. We routinely help shoppers measure for sectionals that actually fit historic-home living rooms, not showroom-sized warehouses.",
    nearbySlugs: ["warren-ri", "barrington-ri", "tiverton-ri"],
    extraFaq: [
      {
        question: "How long is the drive from Bristol to BoxDrop in Warren?",
        answer:
          "About 10 minutes from downtown Bristol up Route 114 / Hope Street to Metacom Avenue. Roger Williams University students from the Bristol campus can be at our door in under 12 minutes.",
      },
      {
        question: "Do you help Roger Williams students who need a mattress fast?",
        answer:
          "Yes — twin XLs, full-size, and queen mattresses are usually on the floor. Bring a friend with an SUV and you can take it back to the dorm or off-campus apartment the same afternoon.",
      },
      {
        question: "Can you deliver to a Mount Hope Bridge–area condo?",
        answer:
          "Yes. We deliver to Mount Hope, Poppasquash, and the Bristol waterfront regularly. We'll confirm stair count and access during the call so there are no surprises.",
      },
    ],
  },
  {
    slug: "barrington-ri",
    name: "Barrington",
    state: "RI",
    driveMinutes: 12,
    primaryRoute: "Route 114 / County Road",
    directionsHint:
      "From County Road, take Route 114 south through Warren — we're on Metacom about ten minutes after you cross the Barrington River.",
    neighborhoods: ["Nayatt", "Rumstick", "Hampden Meadows", "Drownville", "Bay Spring"],
    landmarks: ["Barrington Beach", "Barrington High School", "Haines Memorial State Park", "Tyler Point", "the Barrington River"],
    vibe:
      "Barrington families upgrade bedrooms and family rooms without paying mall pricing — a lot of guest-room queens, master-bedroom kings, and sectionals for finished basements.",
    mattressAngle:
      "Barrington shoppers comparing Sleepy's, Mattress Firm, and Bob's prices end up here because the same names — Beautyrest, Serta, Nectar — land $400-$1,000 less per set.",
    furnitureAngle:
      "Larger Nayatt and Rumstick homes mean we move U-shaped sectionals and 6-piece living room sets to Barrington more than we do anywhere else in the East Bay.",
    nearbySlugs: ["warren-ri", "east-providence-ri", "bristol-ri"],
    extraFaq: [
      {
        question: "How far is Barrington from your showroom?",
        answer:
          "About 12 minutes south on Route 114. From Hampden Meadows or Nayatt, plan on 15 minutes door-to-door.",
      },
      {
        question: "Do you deliver to Rumstick Point and Nayatt?",
        answer:
          "Yes — these are routine delivery stops for us. Call ahead and we'll line up a flat local delivery fee.",
      },
    ],
  },
  {
    slug: "tiverton-ri",
    name: "Tiverton",
    state: "RI",
    driveMinutes: 18,
    primaryRoute: "Route 24 / Main Road",
    directionsHint:
      "From Tiverton Four Corners, take Main Road north to Route 24, then west across the Sakonnet River Bridge into Portsmouth, continuing through Bristol to Warren.",
    neighborhoods: ["Tiverton Four Corners", "Stone Bridge", "North Tiverton", "Sapowet", "Nanaquaket"],
    landmarks: ["Sakonnet River Bridge", "Fort Barton", "Sapowet Marsh", "Tiverton Casino Hotel", "Grinnell's Beach"],
    vibe:
      "Tiverton shoppers are willing to drive a bit when the savings are real — many compare us to Fall River's furniture row and decide the Warren trip pays for itself in one mattress purchase.",
    mattressAngle:
      "If you've been pricing mattresses in the Newport area or up Route 24, our queen hybrids and kings consistently come in hundreds less than the Aquidneck Island stores.",
    furnitureAngle:
      "Tiverton's mix of farmhouses, capes, and waterfront homes means we ship everything from heavy reclining sectionals to compact loveseats out to the Sakonnet shore.",
    nearbySlugs: ["fall-river-ma", "warren-ri", "bristol-ri"],
    extraFaq: [
      {
        question: "Is the drive from Tiverton worth it?",
        answer:
          "Most Tiverton shoppers tell us the trip pays for itself the first time. Queen sets that run $1,200+ at Aquidneck Island stores often land under $700 on our floor — same brands, brand-new in plastic.",
      },
      {
        question: "Do you deliver across the Sakonnet River Bridge?",
        answer:
          "Yes. Tiverton, Little Compton, and northern Portsmouth are all within our regular local delivery zone.",
      },
    ],
  },
  {
    slug: "east-providence-ri",
    name: "East Providence",
    state: "RI",
    driveMinutes: 15,
    primaryRoute: "Wampanoag Trail (Route 114)",
    directionsHint:
      "From Riverside or Rumford, take the Wampanoag Trail (Route 114) south through Barrington into Warren — we're on Metacom Avenue once you cross into Warren.",
    neighborhoods: ["Riverside", "Rumford", "Kent Heights", "Silver Spring Lake area", "Watchemoket"],
    landmarks: ["Crescent Park Carousel", "Sabin Point Park", "Bold Point Park", "Ten Mile River bike path"],
    vibe:
      "East Providence covers everything from Riverside cottages to Rumford colonials — diverse housing means we see every kind of mattress and sectional request here.",
    mattressAngle:
      "Skip the trip across the I-195 retail corridor. We're 15 minutes down Route 114, and our queen and king mattresses routinely beat the East Providence big-box chains by 30-50%.",
    furnitureAngle:
      "Rumford and Kent Heights families looking to refresh a family room buy sectionals here at outlet prices instead of paying retail markup at the Newport Avenue corridor stores.",
    nearbySlugs: ["providence-ri", "barrington-ri", "warren-ri"],
    extraFaq: [
      {
        question: "How long is the drive from Riverside to your store?",
        answer:
          "About 15 minutes south on the Wampanoag Trail (Route 114) through Barrington into Warren.",
      },
      {
        question: "Do you deliver to Rumford and Kent Heights?",
        answer:
          "Yes — both are standard local-delivery stops. Same-week delivery is typical.",
      },
    ],
  },
  {
    slug: "providence-ri",
    name: "Providence",
    state: "RI",
    driveMinutes: 20,
    primaryRoute: "I-195 east to Route 114",
    directionsHint:
      "Take I-195 east toward Cape Cod, exit onto Route 114 south through East Providence and Barrington, continue to Warren and turn onto Metacom Avenue.",
    neighborhoods: ["Federal Hill", "Fox Point", "Mount Hope (Providence)", "Elmhurst", "Wayland Square", "Olneyville"],
    landmarks: ["Brown University", "RISD", "Providence Place", "India Point Park", "Roger Williams Park"],
    vibe:
      "Providence shoppers are the most diverse mix we see — students furnishing first apartments, young couples buying first queen sets, and families upgrading East Side bedrooms.",
    mattressAngle:
      "Providence shoppers compare us to the I-95 mattress corridor. We're 20 minutes east of downtown — same brand names, no commission-driven retail markup.",
    furnitureAngle:
      "Apartment dwellers on the East Side, Federal Hill, and Fox Point come to us for sectionals that actually fit through narrow Providence doorways and staircases.",
    nearbySlugs: ["east-providence-ri", "warwick-ri", "warren-ri"],
    extraFaq: [
      {
        question: "Why not just shop at one of the Providence-area mattress stores?",
        answer:
          "You can — but most of those carry the same brand names at full retail. Our shoppers from Federal Hill, the East Side, and Olneyville drive 20 minutes east to save several hundred dollars per set on identical products.",
      },
      {
        question: "Do you deliver into Providence, including walk-up apartments?",
        answer:
          "Yes. We deliver throughout Providence and confirm stair count, door width, and elevator access during scheduling so there are no surprises on delivery day.",
      },
    ],
  },
  {
    slug: "warwick-ri",
    name: "Warwick",
    state: "RI",
    driveMinutes: 30,
    primaryRoute: "I-95 north to I-195 east, then Route 114",
    directionsHint:
      "From Warwick, take I-95 north to I-195 east, exit at Route 114 south through East Providence and Barrington into Warren.",
    neighborhoods: ["Apponaug", "Pawtuxet Village", "Conimicut", "Cowesett", "Hoxsie", "Buttonwoods"],
    landmarks: ["TF Green Airport", "Rocky Point", "Warwick Mall", "Goddard Memorial State Park", "Pawtuxet Cove"],
    vibe:
      "Warwick is the most retail-saturated part of Rhode Island, so when shoppers drive 30 minutes east to us, they're done with retail markup and ready for clearance pricing.",
    mattressAngle:
      "Warwick has every mattress chain on Bald Hill Road, so the math has to make sense for someone to drive 30 minutes east. It does — same Beautyrest, Serta, and Nectar queens at hundreds less.",
    furnitureAngle:
      "We move full living-room sets to Cowesett, Apponaug, and Pawtuxet Village families who priced the same sectionals along Bald Hill and Reservoir Avenue and came to us for the discount.",
    nearbySlugs: ["providence-ri", "east-providence-ri", "warren-ri"],
    extraFaq: [
      {
        question: "Is it worth driving from Warwick to Warren?",
        answer:
          "For a single pillow, no. For a queen or king set, a sectional, or a financed living-room package — almost always. Warwick shoppers typically save $300 to $1,500 by making the drive.",
      },
      {
        question: "Do you deliver back to Warwick after the visit?",
        answer:
          "Yes — flat local delivery covers Warwick, Cranston, and the rest of greater Providence. Call to confirm the delivery window when you order.",
      },
    ],
  },
  {
    slug: "fall-river-ma",
    name: "Fall River",
    state: "MA",
    driveMinutes: 22,
    primaryRoute: "Route 6 west, then Route 103",
    directionsHint:
      "From Fall River, take Route 6 west across the Braga Bridge into Somerset, then continue on Route 103 / Wilbur Avenue into Warren and Metacom Avenue.",
    neighborhoods: ["Highlands", "Flint", "South End", "North End", "Maplewood"],
    landmarks: ["Battleship Cove", "Heritage State Park", "St. Anne's Shrine", "Father Diaf Bridge", "Kennedy Park"],
    vibe:
      "Fall River and South Coast families have always shopped across the RI line for value — we're the next step after the Route 6 retail strip.",
    mattressAngle:
      "Fall River shoppers know the Route 6 mattress chains. We're a short hop across the line in Warren with the same brand names at outlet pricing and no Massachusetts sales tax surprises (Rhode Island sales tax applies — but the base price is typically much lower).",
    furnitureAngle:
      "Fall River's three-decker apartments and Highlands single-families mean we sell everything from compact loveseats to large reclining sectionals heading back across the Braga Bridge weekly.",
    nearbySlugs: ["swansea-ma", "somerset-ma", "tiverton-ri"],
    extraFaq: [
      {
        question: "Is your store in Massachusetts?",
        answer:
          "We're just over the line in Warren, RI — about 22 minutes west of downtown Fall River via Route 6 and Route 103.",
      },
      {
        question: "Do you deliver back to Fall River?",
        answer:
          "Yes. Fall River, Somerset, and Swansea are all within our flat local-delivery zone.",
      },
    ],
  },
  {
    slug: "swansea-ma",
    name: "Swansea",
    state: "MA",
    driveMinutes: 15,
    primaryRoute: "Route 6 / Route 103",
    directionsHint:
      "From the Swansea Mall area, take Route 6 west or Route 103 (Wilbur Avenue) straight into Warren — we're on Metacom Avenue.",
    neighborhoods: ["Ocean Grove", "South Swansea", "Hortonville", "Touisset (Swansea side)"],
    landmarks: ["Swansea Mall area", "Cole River", "Touisset Marsh Wildlife Refuge", "Mount Hope Bay"],
    vibe:
      "Swansea families typically compare Route 6 retailers to us — we usually win on price, brand selection, and how quickly we can put a mattress on their truck.",
    mattressAngle:
      "Ocean Grove and South Swansea residents are 15 minutes from our showroom — closer than the Fall River retail strip and a fraction of the price.",
    furnitureAngle:
      "We deliver reclining sectionals and full living-room sets to Swansea every week. Local delivery fees are flat, no surprises.",
    nearbySlugs: ["warren-ri", "fall-river-ma", "somerset-ma"],
    extraFaq: [
      {
        question: "What's the fastest way from Swansea to your store?",
        answer:
          "Route 103 (Wilbur Avenue) west drops you straight into Warren and onto Metacom Avenue — about 12-15 minutes from most of Swansea.",
      },
    ],
  },
  {
    slug: "seekonk-ma",
    name: "Seekonk",
    state: "MA",
    driveMinutes: 22,
    primaryRoute: "Route 6 west to Route 114 south",
    directionsHint:
      "From Route 6 in Seekonk, head west into East Providence, pick up Route 114 south through Barrington into Warren.",
    neighborhoods: ["South Seekonk", "North Seekonk", "Greenwood Acres"],
    landmarks: ["Seekonk Speedway", "Caratunk Wildlife Refuge", "Ann & Hope Plaza", "Newport Avenue retail strip"],
    vibe:
      "Seekonk shoppers know retail — Route 6 is wall-to-wall stores. The ones who drive 22 minutes south to us do it once and tell their neighbors.",
    mattressAngle:
      "Seekonk has plenty of national mattress chains on Route 6, but our queens, kings, and adjustable bases consistently undercut them by hundreds on identical models.",
    furnitureAngle:
      "Our Seekonk customers usually start with a sectional or a recliner pair and end up adding a mattress before they leave — the savings stack up fast.",
    nearbySlugs: ["east-providence-ri", "swansea-ma", "warren-ri"],
    extraFaq: [
      {
        question: "Is it faster from Seekonk via Route 6 or I-195?",
        answer:
          "Route 6 west to Route 114 south is usually quickest — about 22 minutes door-to-door without highway congestion.",
      },
    ],
  },
  {
    slug: "somerset-ma",
    name: "Somerset",
    state: "MA",
    driveMinutes: 18,
    primaryRoute: "Route 6 / Route 103",
    directionsHint:
      "From Somerset Center, take Route 138 north to Route 6 west, cross into Swansea and continue on Route 103 into Warren.",
    neighborhoods: ["Somerset Village", "Pottersville", "South Somerset"],
    landmarks: ["Taunton River waterfront", "Brayton Point", "Somerset Berkley Regional High School"],
    vibe:
      "Somerset homes range from waterfront colonials to mid-century capes — bedroom and living-room upgrades are our most common requests from this side of the line.",
    mattressAngle:
      "Somerset is closer to us than to the Fall River retail strip in many spots. Queen and king sets, hybrid mattresses, and adjustable bases routinely head back across the line at clearance pricing.",
    furnitureAngle:
      "Reclining loveseats, power-recliner pairs, and apartment-depth sectionals are our most common Somerset deliveries — typically same-week.",
    nearbySlugs: ["swansea-ma", "fall-river-ma", "warren-ri"],
    extraFaq: [
      {
        question: "How long is the drive from Somerset?",
        answer:
          "About 18 minutes via Route 6 and Route 103. Local delivery is available if you'd rather skip the trip.",
      },
    ],
  },
];

export const citiesBySlug = new Map(cities.map((c) => [c.slug, c]));
