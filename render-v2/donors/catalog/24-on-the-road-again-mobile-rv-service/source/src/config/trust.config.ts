export interface TrustBadge {
  label: string;
  image?: string;
  href?: string;
}

export interface TrustConfig {
  licensed: boolean;
  insured: boolean;
  bonded: boolean;
  yearsInBusiness?: number;
  foundedYear?: number;
  badges: TrustBadge[];
  certifications: string[];
  partnerships: string[];
  manufacturerTraining: string[];
  stats: { value: string; label: string }[];
}

export const TRUST: TrustConfig = {
  licensed: true,
  insured: true,
  bonded: false,
  badges: [],
  certifications: [
    "RVTAA Master RV Technician",
    "RV Technical Institute Level 4 Master Certified Technician",
    "RV Technician Association of America Certified RV Service Technician",
  ],
  partnerships: ["Truma Partner"],
  manufacturerTraining: [
    "Lippert","AirXcel","Dometic","Truma","Norcold","BAL","Victron","Xantrex","WFCO",
  ],
  stats: [
    { value: "6+", label: "Years in business" },
    { value: "Level 4", label: "RVTI Master Certified" },
    { value: "$150", label: "Standard service fee" },
    { value: "$170/hr", label: "Hourly rate (1-hr min)" },
  ],
};
