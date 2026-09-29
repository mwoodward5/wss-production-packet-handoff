import { DATA } from "@/wss/bridge";
export type Industry =
  | "generic" | "roofing" | "rv-repair" | "veterinarian" | "electrician"
  | "plumber" | "hvac" | "landscaping" | "auto-detailing" | "dentist"
  | "law-firm" | "restaurant";

export type WeekdayHours = { open: string; close: string } | "closed" | "24h";

export interface ServiceAreaCity {
  slug: string;
  name: string;
  county?: string;
  region: string;
  population?: string;
  distanceFromHq?: string;
  latitude?: number;
  longitude?: number;
  intro: string;
  neighborhoods: string[];
  commonIssues?: string[];
  zipCodes: string[];
}

export interface ClientConfig {
  businessName: string;
  tagline: string;
  shortDescription: string;
  industry: Industry;
  schemaType: string;
  phone: string;
  phoneE164: string;
  smsE164?: string;
  email: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
  hours: Partial<{
    monday: WeekdayHours; tuesday: WeekdayHours; wednesday: WeekdayHours;
    thursday: WeekdayHours; friday: WeekdayHours; saturday: WeekdayHours; sunday: WeekdayHours;
  }>;
  serviceAreaCities: ServiceAreaCity[];
  serviceAreaLabel: string;
  serviceRadiusMiles?: number;
  ownerName?: string;
  gbp?: {
    placeId?: string; cid?: string; fid?: string; mapsUrl?: string;
    writeReviewUrl?: string; reviewsUrl?: string; mapEmbedUrl?: string; directionsUrl?: string;
  };
}

const sourceHours=DATA.trust.hours;
const hours:ClientConfig['hours']={};
if(sourceHours&&typeof sourceHours==='object'&&!Array.isArray(sourceHours)) for(const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const){
 const value=(sourceHours as Record<string,unknown>)[day];
 if(value==='closed'||value==='24h')hours[day]=value;
 else if(value&&typeof value==='object'&&'open' in value&&'close' in value&&typeof value.open==='string'&&typeof value.close==='string')hours[day]={open:value.open,close:value.close};
}
export const CLIENT:ClientConfig={businessName:DATA.identity.businessName,tagline:DATA.hero.eyebrow,shortDescription:DATA.hero.support,industry:'landscaping',schemaType:'LocalBusiness',phone:DATA.identity.phoneDisplay,phoneE164:DATA.identity.phoneTel.slice(4),email:DATA.identity.email,street:'',city:DATA.identity.city,region:DATA.identity.state,postalCode:'',country:'',hours,serviceAreaCities:[],serviceAreaLabel:DATA.trust.areas.join(', '),gbp:{mapsUrl:DATA.trust.mapUrl||undefined,directionsUrl:DATA.trust.mapUrl||undefined}};
export const FULL_ADDRESS=[CLIENT.city,CLIENT.region].filter(Boolean).join(', ');
