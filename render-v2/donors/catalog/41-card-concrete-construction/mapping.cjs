'use strict';
function paragraph(text){if(typeof text!=='string')return '';return text.replace(/\r/g,'').split('\n').filter(line=>!/^\s*#{1,6}\s/.test(line)).join('\n').split(/\n\n+/).map(x=>x.trim()).find(Boolean)||'';}
function mapDonor({facts,services,files,manifest}){
 if(!facts || !['name','city','state','phone','website'].every(k=>typeof facts[k]==='string'&&facts[k].trim()))throw Error('identity_required');
 if(facts.category!=='concrete'||manifest?.category!=='concrete')throw Error('wrong_trade');
 if(!Array.isArray(services)||!services.length||!services.every(s=>/\b(concrete|slabs?|flat\s?work|screed|demolition)\b/i.test(s.name)&&typeof s.description==='string'&&s.description.length>=20))throw Error('services_required_or_wrong_trade');
 if(!services.every(s=>typeof s.file==='string'&&s.file.startsWith('content/services/')&&paragraph(files?.[s.file])===s.description))throw Error('concrete_service_copy_unbound');
 const home=paragraph(files?.['content/home.md']);const about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20||about.length<20)throw Error('certified_copy_required');
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:`${facts.city}, ${facts.state}`,eyebrow:`${facts.city}, ${facts.state}`,support:home},serviceIntro:home,about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
