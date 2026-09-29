import { DATA } from "@/wss/bridge";
export interface HeroCta { label: string; href: string; }

export interface HeroConfig {
  eyebrow?: string;
  headline: string;
  subheadline: string;
  primaryCta: HeroCta;
  secondaryCta: HeroCta;
  video?: string;
  poster?: string;
  images: string[];
}

export const HERO:HeroConfig={eyebrow:DATA.hero.eyebrow,headline:[DATA.hero.line1,DATA.hero.emphasis,DATA.hero.line3].join(' '),subheadline:DATA.hero.support,primaryCta:{label:`Call ${DATA.identity.phoneDisplay}`,href:DATA.identity.phoneTel},secondaryCta:{label:'Contact us',href:'/contact'},video:DATA.hero.video||undefined,poster:DATA.hero.poster,images:[DATA.hero.poster]};
