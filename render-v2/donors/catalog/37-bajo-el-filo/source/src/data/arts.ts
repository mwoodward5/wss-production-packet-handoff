import {getClient,serviceSlug,serviceBody} from '@/wss/bridge';
// The 12 art-form rooms. One source of truth for atlas + deep pages.

export interface ReadingRef {
  label: string;
  url?: string;
  note?: string;
}

export interface Art {
  slug: string;
  name: string;
  native?: string;
  region: string;
  era: string;
  family: "japanese-blade" | "kali" | "modern-edge" | "hema" | "sambo";
  icon: IconKey;
  essence: string;
  history: string;
  ramiLine: string;
  principles: string[];
  novice: string;
  advanced: string;
  reading: ReadingRef[];
  mediaIds: string[];
  accent?: "edge" | "sambo" | "steel";
}

export type IconKey =
  | "katana" | "bujinkan" | "sayoc" | "kampilan" | "ilustrisimo"
  | "medusa" | "piper" | "longsword" | "compass" | "fiore"
  | "kurtka" | "combat-sambo"
  | "torii" | "wave" | "sun" | "mat" | "mountain";


export const arts:Art[]=getClient().services.map(s=>({slug:serviceSlug(s),name:s.name,region:'',era:'',family:'modern-edge',icon:'compass',essence:s.description,history:serviceBody(s).slice(s.description.length).trim(),ramiLine:'',principles:[],novice:'',advanced:'',reading:[],mediaIds:[]}));
export const artBySlug=(slug:string)=>arts.find(a=>a.slug===slug);
