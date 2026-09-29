'use strict';
// Called only after Genie certification. This adapter never writes new business copy.
function paragraph(md) {
  if (typeof md !== 'string') return '';
  return md.replace(/\r\n/g, '\n').replace(/^#[^\n]*\n+/, '').trim().split(/\n\n+/)[0];
}

// Keep service paragraph bytes intact: do not trim or normalize its contents.
function serviceParagraph(md) {
  if (typeof md !== 'string') return null;
  const body = md.replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/^#{1,6}[ \t]+[^\r\n]*\r?\n(?:[ \t]*\r?\n)*/, '');
  return body.split(/\r?\n[ \t]*\r?\n/, 1)[0].replace(/\r?\n$/, '');
}
function mapDonor({facts, services, files, manifest}) {
  for (const key of ['name','city','state','phone','website','category']) if (!facts?.[key]?.trim()) throw Error('identity_required:' + key);
  if (!['deck builder','deck building','deck contractor','deck-builder','deck-building','general contractor','general-contractor','landscaping','outdoor living'].includes(facts.category.toLowerCase())) throw Error('wrong_trade');
  if (!Array.isArray(services) || !services.length || !services.every(s => /\b(deck|decks|decking|railing|railings|pergola|pergolas|gazebo|gazebos)\b|patio roof|outdoor living/i.test(s.name))) throw Error('wrong_trade');
  if (manifest?.key !== '11-urban-decks') throw Error('donor_manifest_mismatch');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph(files?.['content/about.md']);
  const intro = paragraph(files?.['content/services.md']);
  if (home.length < 20 || about.length < 20 || intro.length < 10) throw Error('certified_copy_required');
  for (const s of services) {
    if (typeof s.file !== 'string' || !/^content\/services\/[a-z0-9][a-z0-9_-]*\.md$/i.test(s.file) ||
        !files || !Object.hasOwn(files, s.file) || typeof s.description !== 'string' ||
        s.description.trim().length < 20 || serviceParagraph(files[s.file]) !== s.description) {
      throw Error('service_copy_unbound');
    }
  }
  return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city,eyebrow:facts.city + ', ' + facts.state,support:home},serviceIntro:intro,about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports = {mapDonor};
