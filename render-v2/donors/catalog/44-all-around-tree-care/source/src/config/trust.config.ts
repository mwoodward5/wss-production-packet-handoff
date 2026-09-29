import { DATA } from "@/wss/bridge";
export interface TrustBadge { label: string; image?: string; href?: string; }

export interface TrustConfig {
  licensed: boolean;
  insured: boolean;
  bonded: boolean;
  yearsInBusiness?: number;
  foundedYear?: number;
  badges: TrustBadge[];
  certifications: string[];
  stats: { value: string; label: string }[];
}

export const TRUST:TrustConfig={licensed:false,insured:false,bonded:false,foundedYear:DATA.identity.founded??undefined,badges:DATA.trust.badges.map(b=>({label:b.label})),certifications:[],stats:DATA.trust.stats.flatMap(s=>{if(!s||typeof s!=='object'||!('value' in s)||!('label' in s)||typeof s.label!=='string')return [];const v=s.value;return typeof v==='string'||(typeof v==='number'&&Number.isFinite(v))?[{value:String(v),label:s.label}]:[];})};
