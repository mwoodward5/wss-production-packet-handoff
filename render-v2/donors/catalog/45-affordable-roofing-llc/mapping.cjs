'use strict';
function paragraph(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g,'\n').replace(/^\s*#{1,6}[^\n]*(?:\n|$)/, '').split(/\n\s*\n/).map(x=>x.trim()).find(x=>x && !x.startsWith('#')) || '';
}
function mapDonor({facts,services,files,manifest}) {
  if (!facts || !['name','city','state','phone','website'].every(k=>typeof facts[k]==='string' && facts[k].trim())) throw new Error('roofing_identity_required');
  if (manifest?.category !== 'roofing' || !/^roofing(?: contractor)?$/i.test(facts.category || '')) throw new Error('roofing_category_mismatch');
  if (!Array.isArray(services) || !services.length || !services.every(s=>s.name && typeof s.description==='string' && s.description.length>=20) || !services.some(s=>/\broof(?:ing|s)?\b/i.test(s.name))) throw new Error('roofing_services_required');
  if (!services.every(s=>typeof s.file==='string' && s.file.startsWith('content/services/') && paragraph(files?.[s.file]) === s.description)) throw new Error('roofing_service_copy_unbound');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph(files?.['content/about.md']);
  if (home.length<20 || about.length<20) throw new Error('roofing_certified_copy_required');
  if (facts.name.length>80 || services[0].name.length>80) throw new Error('roofing_hero_length');
  const serviceIntro = paragraph(files?.['content/services.md']) || services[0].description;
  const ctaBody = paragraph(files?.['content/contact.md']);
  if (home.length > 900 || about.length > 2400 || serviceIntro.length > 800 || ctaBody.length > 900 || facts.city.length > 80 || `${facts.city}, ${facts.state}`.length > 100) throw new Error('roofing_copy_length');
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city,eyebrow:`${facts.city}, ${facts.state}`,support:home},serviceIntro,about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:'',ctaBody,serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports = {mapDonor};
