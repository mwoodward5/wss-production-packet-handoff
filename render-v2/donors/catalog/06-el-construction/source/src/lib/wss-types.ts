export type Faq = {q:string; a:string};
export type Service = {name:string; shortLabel:string; description:string; href:string; source:unknown};
export type Media = {role:string; path:string; rank:number|null; sourceUrl:string; sourceSha256:string; outputSha256:string; width:number|null; height:number|null};
export interface Client {
 schema:'wss-client-site-data-v2';
 identity:{businessName:string; city:string; state:string; phoneDisplay:string; phoneTel:string; email:string; website:string; founded:number|null; logoOnDark:string; logoOnLight:string};
 hero:{line1:string; emphasis:string; line3:string; eyebrow:string; support:string; poster:string; video:string};
 services:Service[]; media:Media[];
 content:{serviceIntro:string; about:string; seasonalNote:string; whyHeadline:string; ctaHeadline:string; ctaBody:string; values:{title:string;body:string}[]; faqs:Faq[]};
 trust:{reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[]; aggregate:{rating:number;count:number;sourceUrl:string}|null; hours:unknown; areas:string[]; socials:string[]; badges:{label:string;sublabel:string;meta:string}[]; stats:unknown[]; mapUrl:string; bookingUrl:string};
 design:{paletteSource:string;accent:string;fonts:string[]}; source:{prospectId:string;packetSha256:string};
}
export interface SitePlan {
 schema:'wss-rich-site-plan-v1'; packetHash?:string;
 content?:Partial<Record<'home'|'about'|'contact'|'service-area',string>>;
 services?:{name:string;slug:string;shortDesc?:string;longDescMd?:string}[];
 pages?:unknown[]; visual?:Record<string,unknown>; localPresence?:Record<string,unknown>;
}
