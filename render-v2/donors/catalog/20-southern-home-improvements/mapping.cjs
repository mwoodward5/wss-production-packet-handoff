'use strict';
const TRADE = /\b(roof(?:s|ing)?|siding|gutters?|exteriors?|home improvements?|deck(?:s|ing)?|fascias?|soffits?)\b/i;
function paragraph(text) { return typeof text === 'string' ? text.replace(/\r\n/g,'\n').trim().split('\n').slice(1).join('\n').trim().split(/\n\n+/)[0] : ''; }
function mapDonor({facts, services, files, manifest}) {
  if (!facts || !['name','city','state','phone','website','category'].every(k=>typeof facts[k]==='string' && facts[k].trim())) throw Error('donor_identity_required');
  if (!TRADE.test(facts.category) || (manifest?.category && !TRADE.test(manifest.category))) throw Error('donor_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.some(s=>!s || typeof s.name!=='string' || !TRADE.test(s.name) || typeof s.description!=='string' || s.description.trim().length<20)) throw Error('donor_services_required_or_wrong_trade');
  const home=paragraph(files?.['content/home.md']);
  const about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if(home.length<20 || about.length<20) throw Error('donor_certified_copy_required');
  const serviceIntro=paragraph(files?.['content/services.md']) || services.map(s=>s.name).join(' · ');
  const contact=paragraph(files?.['content/contact.md']);
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:serviceIntro.length>=10?serviceIntro:services[0].description,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:contact,serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
