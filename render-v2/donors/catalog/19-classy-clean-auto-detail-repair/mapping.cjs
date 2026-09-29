'use strict';
const { assertAutomotiveServices } = require('./source/src/lib/donor-policy.cjs');
function body(text) { return typeof text === 'string' ? text.split(/\r?\n/).filter(line=>!/^\s{0,3}#{1,6}\s/.test(line)).join('\n').trim() : ''; }
function paragraph(text) { return body(text).split(/\n\s*\n/)[0] || ''; }
// Compare only the first Markdown paragraph, preserving its bytes, including
// whitespace and internal line endings. Heading/separator newlines are structure.
function serviceParagraph(text) {
  if (typeof text !== 'string') return null;
  const content = text.replace(/^(?:(?:[ \t]*|[ \t]{0,3}#{1,6}[ \t]+[^\r\n]*)\r?\n)*/, '');
  return content.split(/\r?\n[ \t]*\r?\n/, 1)[0].replace(/\r?\n$/, '');
}
function assertServiceFileBindings(services, files) {
  const unbound = () => { throw new Error('auto_detailing_service_copy_unbound'); };
  if (!files || typeof files !== 'object' || Array.isArray(files)) unbound();
  for (const service of services) {
    const file = service.file;
    if (typeof file !== 'string' || !/^content\/services\/[a-z0-9][a-z0-9._-]*\.md$/i.test(file) ||
        file.includes('..') || !Object.prototype.hasOwnProperty.call(files, file) ||
        serviceParagraph(files[file]) !== service.description) unbound();
  }
}
function mapDonor({facts,services,files,manifest}) {
  if (['name','city','state','phone','website'].some(key=>typeof facts?.[key] !== 'string' || !facts[key].trim()) || !Array.isArray(services) || !services.length) throw new Error('certified_identity_required');
  if (!/^(auto detailing|automotive detailing(?: & repair)?|automotive|auto repair)$/i.test(facts.category || '') || (manifest?.category && manifest.category !== 'auto detailing')) throw new Error('donor_trade_mismatch');
  assertAutomotiveServices(services);
  const support=paragraph(files?.['content/home.md']);
  const about=body((files?.['content/about.md'] || files?.['content/home.md']));
  if (support.length<20 || about.length<20 || services.some(s=>!s.name || typeof s.description !== 'string' || s.description.trim().length<20)) throw new Error('certified_copy_required');
  assertServiceFileBindings(services, files);
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support},serviceIntro:paragraph(files?.['content/services.md']) || services[0].description,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:paragraph(files?.['content/contact.md']),serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
