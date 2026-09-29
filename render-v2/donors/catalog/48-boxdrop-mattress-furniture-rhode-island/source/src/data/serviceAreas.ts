export const serviceAreas = [
  {
    "city": "Warren",
    "state": "RI",
    "slug": "warren-ri",
    "angle": "closest local showroom and primary NAP target",
    "nearby": "Bristol, Barrington, Swansea"
  },
  {
    "city": "Bristol",
    "state": "RI",
    "slug": "bristol-ri",
    "angle": "East Bay shoppers who want a nearby alternative to big-box mattress stores",
    "nearby": "Warren, Barrington, Tiverton"
  },
  {
    "city": "Barrington",
    "state": "RI",
    "slug": "barrington-ri",
    "angle": "families upgrading bedrooms and living rooms without mall pricing",
    "nearby": "Warren, East Providence, Bristol"
  },
  {
    "city": "Tiverton",
    "state": "RI",
    "slug": "tiverton-ri",
    "angle": "Route 24/East Bay shoppers comparing mattress and furniture values",
    "nearby": "Fall River, Warren, Bristol"
  },
  {
    "city": "East Providence",
    "state": "RI",
    "slug": "east-providence-ri",
    "angle": "Providence-area shoppers seeking discount mattresses without driving to multiple big-box stores",
    "nearby": "Providence, Barrington, Warren"
  },
  {
    "city": "Providence",
    "state": "RI",
    "slug": "providence-ri",
    "angle": "urban apartment, condo, student, and family mattress/furniture needs",
    "nearby": "East Providence, Warwick, Warren"
  },
  {
    "city": "Warwick",
    "state": "RI",
    "slug": "warwick-ri",
    "angle": "shoppers comparing clearance pricing against large retail corridors",
    "nearby": "Providence, East Providence, Warren"
  },
  {
    "city": "Fall River",
    "state": "MA",
    "slug": "fall-river-ma",
    "angle": "South Coast MA shoppers looking across the RI border for value",
    "nearby": "Swansea, Somerset, Tiverton, Warren"
  },
  {
    "city": "Swansea",
    "state": "MA",
    "slug": "swansea-ma",
    "angle": "nearby South Coast households shopping mattresses and living room sets",
    "nearby": "Warren, Fall River, Seekonk"
  },
  {
    "city": "Seekonk",
    "state": "MA",
    "slug": "seekonk-ma",
    "angle": "shoppers comparing Route 6 retail options with BoxDrop-style savings",
    "nearby": "East Providence, Swansea, Warren"
  },
  {
    "city": "Somerset",
    "state": "MA",
    "slug": "somerset-ma",
    "angle": "South Coast bedroom and living-room upgrades near Warren",
    "nearby": "Swansea, Fall River, Warren"
  }
] as const;

export type ServiceArea = typeof serviceAreas[number];
