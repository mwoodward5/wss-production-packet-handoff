'use strict';
const {parseServiceMarkdown}=require('../../../contracts/genie-packet.cjs');
function paragraph(md){if(typeof md!=='string')return '';return md.replace(/\r\n/g,'\n').split(/\n\n+/).map(p=>p.trim()).find(p=>p&&!p.startsWith('#'))||'';}
function mapDonor({facts,services,files,manifest}){
 if(facts?.category!=='martial arts'||(manifest?.category&&manifest.category!=='martial arts'))throw Error('donor_trade_mismatch');
 for(const key of ['name','city','state','phone','website'])if(typeof facts[key]!=='string'||!facts[key].trim())throw Error('required_identity_missing:'+key);
 if(!Array.isArray(services)||!services.length||services.some(s=>!s.name||!s.description||!s.file||!files?.[s.file]))throw Error('certified_services_required');
 for(const service of services){const parsed=parseServiceMarkdown(files[service.file]);if(parsed.heading.toLowerCase()!==service.name.toLowerCase()||parsed.description!==service.description)throw Error('certified_service_copy_mismatch');}
 const home=paragraph(files?.['content/home.md']), about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20||!about||about.length<20)throw Error('certified_home_about_required');
 // Each phrase comes verbatim from certified identity or visitor copy; no authored trade claims.
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:home,about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:facts.name,ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
