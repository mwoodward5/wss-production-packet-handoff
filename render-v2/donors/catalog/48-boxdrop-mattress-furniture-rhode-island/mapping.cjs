"use strict";
function paragraph(md){return typeof md === 'string' ? md.replace(/\r/g,'').split(/\n\n+/).map(s=>s.trim()).find(s=>s && !s.startsWith('#')) || '' : '';}
function mapDonor({facts,services,files,manifest}){
 if(!facts?.name || !facts.city || !facts.state || !facts.phone || !facts.website) throw Error('donor_identity_required');
 if(!Array.isArray(services)||!services.length||services.some(s=>! /\b(mattresses?|furniture|sofas?|sectionals?|recliners?|loveseats?|adjustable bases?|beds?)\b/i.test(s.name)||!s.description)) throw Error('donor_wrong_trade');
 if(facts.category && manifest?.category && facts.category!==manifest.category) throw Error('donor_wrong_trade');
 if(services.some(s=>/\b(hvac|roofing|plumbing|landscaping|cleaning|pest|flower|garden)\b/i.test(s.name))) throw Error('donor_wrong_trade');
 const home=paragraph(files?.['content/home.md']),about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
 if(home.length<20 || about.length<20) throw Error('donor_certified_copy_required');
 return {heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:home,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))};
}
module.exports={mapDonor};
