'use strict';
function paragraph(md){return typeof md==='string'?md.replace(/\r\n/g,'\n').replace(/^# [^\n]*\n+/,'').trim().split(/\n\n+/)[0]:'';}
function mapDonor({facts,services,files,manifest}) {
 if(['name','city','state','phone','website'].some(key=>typeof facts?.[key]!=='string'||!facts[key].trim())) throw Error('donor_identity_missing');
 if(manifest?.category!=='handyman') throw Error('donor_manifest_category_mismatch');
 const allowed=/\b(handyman|home improvement|property (services|maintenance)|painting|paint|drywall|door|doors|window|windows|floor|flooring|bathroom|deck|fence|shed|gutter|pressure wash|carpentry|furniture|assembly|home repair|home maintenance|interior repair|exterior repair)\b/i;
 if(!Array.isArray(services)||!services.length||services.some(s=>!s||typeof s.name!=='string'||!allowed.test(s.name)||typeof s.description!=='string'||s.description.trim().length<20)) throw Error('donor_wrong_trade_or_service_missing');
 if(new Set(services.map(s=>s.name.trim().toLowerCase())).size!==services.length) throw Error('donor_service_name_collision');
 if(facts.category && !/^(handyman|home-improvement|home improvement|general-contractor|general contractor|property-services|property services)$/.test(facts.category.toLowerCase())) throw Error('donor_wrong_trade');
 const home=paragraph(files?.['content/home.md']), about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20 || about.length<20) throw Error('donor_certified_copy_missing');
 const serviceIntro=paragraph(files?.['content/services.md']) || services[0].description;
 const ctaBody=paragraph(files?.['content/contact.md']);
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody,serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
