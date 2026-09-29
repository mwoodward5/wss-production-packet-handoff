import { DATA } from "@/wss/bridge";
export interface Review {
  author: string;
  initial: string;
  rating: 1 | 2 | 3 | 4 | 5;
  /** ISO date. */
  date: string;
  body: string;
  source?: "google" | "yelp" | "bbb" | "facebook" | "trustpilot" | "other";
  verified?: boolean;
}

export const REVIEWS:Review[]=DATA.trust.reviews.filter(r=>r.rating!==null&&Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5).map(r=>({author:r.author,initial:r.author.slice(0,1),rating:r.rating as Review['rating'],date:'',body:r.text}));
export const REVIEWS_AGGREGATE={ratingValue:DATA.trust.aggregate?.rating??0,reviewCount:DATA.trust.aggregate?.count??0};
