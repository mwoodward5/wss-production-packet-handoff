'use strict';
function paragraph(markdown) {
 if(typeof markdown!=='string') return '';
 return markdown.replace(/\r\n/g,'\n').trim().replace(/^# [^\n]+\n+/, '').split(/\n\n+/)[0].trim();
}
function mapDonor({facts,services,files,manifest}) {
 if(!facts || !['excavation','landscaping','landscaping_and_excavation'].includes(facts.category)) throw Error('donor_trade_mismatch');
 if(manifest?.category && manifest.category!==facts.category) throw Error('donor_category_mismatch');
 for(const field of ['name','city','state','phone','website']) if(typeof facts[field]!=='string'||!facts[field].trim()) throw Error('required_identity_missing:'+field);
 if(!Array.isArray(services)||!services.length||!services.some(s=>/\b(excavation|excavating|landscaping|landscape|earthmoving)\b/i.test(s.name))) throw Error('donor_trade_mismatch');
 if(services.some(s=>!s.name || typeof s.description!=='string'||s.description.length<20)) throw Error('certified_service_copy_missing');
 for(const service of services) {
  if(typeof service.file!=='string'||!service.file.startsWith('content/services/')) throw Error('certified_service_file_unbound');
  if(paragraph(files?.[service.file])!==service.description.trim()) throw Error('certified_service_copy_unbound');
 }
 const home=paragraph(files?.['content/home.md']);
 const about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20||about.length<20) throw Error('certified_copy_missing');
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:home,about,whyHeadline:'About '+facts.name,values:[],seasonalNote:'',ctaHeadline:'Contact '+facts.name,ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
