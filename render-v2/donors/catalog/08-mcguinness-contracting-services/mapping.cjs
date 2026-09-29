'use strict';
function paragraph(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n/g,'\n').trim().split('\n').slice(1).join('\n').trim().split(/\n\n+/)[0].trim();
}
function mapDonor({facts,services,files,manifest}={}) {
  if (manifest?.category !== 'concrete' || facts?.category !== 'concrete') throw new Error('concrete_category_mismatch');
  for (const key of ['name','city','state','phone','website']) if (typeof facts[key]!=='string'||!facts[key].trim()) throw new Error('identity_required:'+key);
  if (!Array.isArray(services)||!services.length||!services.some(s=>/\bconcrete\b/i.test(s.name))) throw new Error('concrete_services_required');
  if (facts.services_source!=='source_bound') throw new Error('services_not_certified');
  for (const s of services) {
    if (!facts.services?.includes(s.name) || typeof s.description!=='string' || s.description.length<20 || !s.file || paragraph(files?.[s.file])!==s.description || files[s.file].split(/\r?\n/)[0].replace(/^#+\s*/,'').trim()!==s.name) throw new Error('service_copy_unbound');
  }
  const home=paragraph(files?.['content/home.md']);
  const about=paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  const contact=paragraph(files?.['content/contact.md']);
  if (home.length<20 || about.length<20) throw new Error('certified_home_and_about_required');
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home},
    serviceIntro:paragraph(files?.['content/services.md']) || services.map(s=>s.name).join(' · '),about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:'',ctaBody:contact,
    serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
