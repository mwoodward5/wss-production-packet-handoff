import { business } from './business';

export const geoNearMe = {
  "business": "BoxDrop Mattress & Furniture Rhode Island",
  "address": "601 Metacom Ave, Warren, RI 02885",
  "phone": "(401) 365-7993",
  "geo": {
    "latitude": 41.7201467,
    "longitude": -71.270509,
    "verification": "verify before launch"
  },
  "intents": [
    {
      "query": "mattress store near me",
      "route": "/mattress-store-near-me-rhode-island",
      "answer": "Call or text BoxDrop Rhode Island in Warren, RI to ask what mattress sizes and styles are available today."
    },
    {
      "query": "furniture store near me",
      "route": "/furniture-store-near-me-rhode-island",
      "answer": "BoxDrop Rhode Island serves local furniture shoppers looking for sectionals, sofas, loveseats, recliners, and living room furniture."
    },
    {
      "query": "sectionals near me",
      "route": "/sectionals-rhode-island",
      "answer": "Ask BoxDrop Rhode Island what sectional configurations are available today and measure your room before visiting."
    },
    {
      "query": "mattress financing near me",
      "route": "/mattress-and-furniture-financing-rhode-island",
      "answer": "Financing options may be available, but approval and terms depend on the provider and current program."
    }
  ],
  "serviceAreas": [
    "Warren",
    "Bristol",
    "Barrington",
    "Tiverton",
    "East Providence",
    "Providence",
    "Warwick",
    "Auburn",
    "Ocean Grove",
    "Fall River",
    "Swansea",
    "Somerset",
    "Seekonk",
    "East Bay Rhode Island",
    "Greater Providence",
    "South Coast Massachusetts"
  ]
} as const;

export function getDirectionsUrl() {
  return business.mapDirectionsUrl;
}

export function getDistanceDisclosure(city: string) {
  return `BoxDrop Rhode Island is located in Warren, RI and serves ${city} shoppers. Confirm current hours and inventory before visiting.`;
}
