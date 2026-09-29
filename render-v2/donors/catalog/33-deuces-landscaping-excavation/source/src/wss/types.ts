export interface Service { name: string; shortLabel: string; description: string; href: string; source?: object }
export interface ClientData {
 schema: 'wss-client-site-data-v2';
 identity: {businessName:string;city:string;state:string;phoneDisplay:string;phoneTel:string;email:string;website:string;founded:number|null;logoOnDark:string;logoOnLight:string};
 hero: {line1:string;emphasis:string;line3:string;eyebrow:string;support:string;poster:string;video:string};
 services:Service[];
 media:{role:string;path:string;rank:number|null;sourceSha256:string;sourceUrl:string}[];
 content:{serviceIntro:string;about:string;whyHeadline:string;seasonalNote:string;ctaHeadline:string;ctaBody:string;values:{title:string;body:string}[];faqs:{q:string;a:string}[]};
 trust:{reviews:{author:string;text:string;rating:number|null;sourceUrl:string}[];aggregate:{rating:number|null;count:number|null;sourceUrl:string}|null;hours:unknown;areas:string[];socials:string[];badges:{label:string;sublabel:string;meta:string}[];stats:unknown[];bookingUrl:string;mapUrl:string};
 design:{paletteSource:string;accent:string;fonts:string[]};
 source:{prospectId:string;compiledAt:string;packetSha256:string;packetVersion:string};
}
export interface RichService {name:string;slug:string;h1?:string;shortDesc?:string;longDescMd?:string;metaTitle?:string;metaDescription?:string;faqs?:{q:string;a:string}[]}
export interface SitePlan {schema:'wss-rich-site-plan-v1'; services?:RichService[]; content?:Record<string,string>; pages?:unknown[];visual?:unknown;localPresence?:unknown;forms?:unknown}
