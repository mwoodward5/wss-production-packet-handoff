'use strict';
function mapDonor({facts, services, files, manifest}) {
  if (manifest?.category !== 'fencing' || facts?.category !== 'fencing') throw new Error('fencing_category_required');
  for (const key of ['name','city','state','phone','website']) if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('identity_required:' + key);
  if (!Array.isArray(services) || !services.length || services.some(s => typeof s?.name !== 'string' || !s.name.trim() || typeof s?.description !== 'string' || s.description.trim().length < 20)) throw new Error('certified_services_required');
  if (!services.some(s => /\bfenc(?:e|es|ing)\b/i.test(s.name))) throw new Error('fencing_services_required');
  const paragraph = value => typeof value === 'string' ? value.replace(/\r\n/g,'\n').split(/\n\s*\n/).map(x=>x.trim()).find(x=>x && !x.startsWith('#')) || '' : '';
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md'])) || paragraph(facts.copy);
  if (home.length < 20 || about.length < 20) throw new Error('certified_copy_required');
  const serviceIntro = paragraph(files?.['content/services.md']) || services.map(s=>s.name).join(' · ');
  if (serviceIntro.length < 10 || serviceIntro.length > 800) throw new Error('service_intro_copy_required');
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:paragraph(files?.['content/contact.md']),serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports={mapDonor};
