'use strict';
function paragraph(copy){return typeof copy==='string'?copy.replace(/\r\n/g,'\n').trim().replace(/^#+\s+[^\n]*\n+/,'').trim().split(/\n\n+/)[0]:'';}
function mapDonor({facts,services,files,manifest}){
 for(const k of ['name','city','state','phone','website','category'])if(typeof facts?.[k]!=='string'||!facts[k].trim())throw Error('donor_identity_required:'+k);
 if(manifest?.category&&facts.category!==manifest.category)throw Error('donor_category_mismatch');
 if(!Array.isArray(services)||!services.some(s=>/\b(drywall|sheetrock|plaster|stucco|eifs|skim|paint|painting|texture|ceiling)\b/i.test(s?.name)))throw Error('donor_wrong_trade');
 for(const s of services){
  const body=files?.[s?.file];
  const heading=typeof body==='string'?body.trim().split(/\r?\n/)[0].replace(/^#+\s*/,'').trim():'';
  if(!s?.name||!s.file?.startsWith('content/services/')||heading.toLowerCase()!==s.name.trim().toLowerCase()||paragraph(body)!==s.description)throw Error('donor_service_copy_unbound');
 }
 const home=paragraph(files?.['content/home.md']),about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20||about.length<20)throw Error('donor_certified_copy_required');
 return {heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:home,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))};
}
module.exports={mapDonor};
