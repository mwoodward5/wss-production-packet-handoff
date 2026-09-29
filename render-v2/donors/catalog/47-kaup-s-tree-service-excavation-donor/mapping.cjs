'use strict';
function paragraph(md) {
 if(typeof md!=='string') return '';
 return md.replace(/\r\n/g,'\n').trim().split('\n').slice(1).join('\n').trim().split(/\n\n+/)[0].trim();
}
function mapDonor({facts,services,files,manifest}={}) {
 for(const key of ['name','city','state','phone','website','category']) if(typeof facts?.[key]!=='string'||!facts[key].trim()) throw Error('donor_identity_missing:'+key);
 const category=facts.category.trim().toLowerCase();
 if(!['tree service','tree care','excavation','tree care, excavation, and site services'].includes(category)) throw Error('donor_wrong_trade');
 if(!Array.isArray(services)||!services.length) throw Error('donor_services_missing');
 if(!services.some(s=>/\b(tree|trees|arborist|arboriculture|stump|excavation|excavating|land clearing|dirt work|storm shelter)\b/i.test(s.name))) throw Error('donor_wrong_trade');
 for(const s of services) {
  if(!s.file?.startsWith('content/services/') || typeof s.name!=='string' || typeof s.description!=='string' || s.description.length<20) throw Error('donor_service_uncertified');
  const md=files?.[s.file];
  if(typeof md!=='string'||md.trim().split('\n')[0].replace(/^#+\s*/,'').trim()!==s.name||paragraph(md)!==s.description) throw Error('donor_service_unbound');
 }
 const home=paragraph(files?.['content/home.md']);
 const about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20) throw Error('donor_home_copy_missing');
 if(about.length<20) throw Error('donor_about_copy_missing');
 // Use complete source phrases; never synthesize a claim or service.
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.name,support:home},serviceIntro:home,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:paragraph(files?.['content/contact.md']),serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
