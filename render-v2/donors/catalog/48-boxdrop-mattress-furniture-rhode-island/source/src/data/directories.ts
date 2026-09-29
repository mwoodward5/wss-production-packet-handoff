export type Tier = 1 | 2 | 3 | 4;
export type Status = "Pending" | "Submitted" | "Live";

export type Directory = {
  name: string;
  url: string;       // public-facing listing or submit URL
  tier: Tier;
  category: "Search & Social" | "Vertical (Mattress/Furniture)" | "Local RI / South Coast MA" | "General Citations";
  status: Status;    // default Pending — owner updates
  note?: string;
};

export const directories: Directory[] = [
  // Tier 1 — must-do
  { name: "Google Business Profile", url: "https://www.google.com/business/", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Bing Places for Business", url: "https://www.bingplaces.com/", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Apple Business Connect", url: "https://businessconnect.apple.com/", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Yelp for Business", url: "https://biz.yelp.com/signup", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Facebook Business Page", url: "https://www.facebook.com/Boxdropnewengland", tier: 1, category: "Search & Social", status: "Live" },
  { name: "Instagram Business", url: "https://business.instagram.com/", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Nextdoor Business", url: "https://business.nextdoor.com/", tier: 1, category: "Search & Social", status: "Pending" },
  { name: "Better Business Bureau (RI)", url: "https://www.bbb.org/get-listed", tier: 1, category: "Search & Social", status: "Pending" },

  // Tier 2 — vertical
  { name: "Houzz Pro Directory", url: "https://www.houzz.com/proAccount", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Pending" },
  { name: "GoodBed.com Store Finder", url: "https://www.goodbed.com/local/", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Pending" },
  { name: "Mattress Clarity Store Finder", url: "https://www.mattressclarity.com/", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Pending" },
  { name: "Sleep Foundation Local Stores", url: "https://www.sleepfoundation.org/mattress-stores", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Pending" },
  { name: "Furniture Today Industry Directory", url: "https://www.furnituretoday.com/", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Pending" },
  { name: "BoxDrop Franchise Locator", url: "https://boxdrop.com/locations", tier: 2, category: "Vertical (Mattress/Furniture)", status: "Live" },

  // Tier 3 — local RI / MA
  { name: "Rhode Island Chamber of Commerce", url: "https://www.provchamber.com/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "East Bay Chamber of Commerce", url: "https://eastbaychamberri.org/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "Discover Newport (Visit RI)", url: "https://www.discovernewport.org/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "Visit Rhode Island", url: "https://www.visitrhodeisland.com/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "Providence Journal Local Listings", url: "https://www.providencejournal.com/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "South Coast Today (MA)", url: "https://www.southcoasttoday.com/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },
  { name: "Town of Warren RI Business Directory", url: "https://www.townofwarren-ri.gov/", tier: 3, category: "Local RI / South Coast MA", status: "Pending" },

  // Tier 4 — general citations
  { name: "YellowPages", url: "https://www.yellowpages.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Manta", url: "https://www.manta.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Foursquare for Business", url: "https://business.foursquare.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "MapQuest My Maps", url: "https://www.mapquest.com/my-maps", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Citysearch", url: "https://www.citysearch.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Local.com", url: "https://www.local.com/business/add/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Hotfrog", url: "https://www.hotfrog.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Cylex", url: "https://www.cylex.us.com/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Brownbook.net", url: "https://www.brownbook.net/", tier: 4, category: "General Citations", status: "Pending" },
  { name: "Tupalo", url: "https://tupalo.com/", tier: 4, category: "General Citations", status: "Pending" },
];
