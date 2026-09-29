'use strict';
const {parseServiceMarkdown} = require('../../../contracts/genie-packet.cjs');
function copy(files,key) {
  const body=files?.[key];
  if(typeof body!=='string') throw new Error('certified_copy_missing:'+key);
  const lines=body.trim().split(/\r?\n/);
  const heading=lines.shift().replace(/^#+\s*/, '').trim();
  const paragraphs=lines.join('\n').trim().split(/\n\s*\n/).filter(Boolean);
  if(!heading || !paragraphs[0]) throw new Error('certified_copy_empty:'+key);
  return {heading,body:paragraphs[0]};
}
function mapDonor({facts,services,files,manifest}) {
  if(facts?.category!=='roofing' || (manifest?.category && manifest.category!=='roofing')) throw new Error('roofing_category_required');
  for(const k of ['name','city','state','phone','website']) if(typeof facts[k]!=='string'||!facts[k].trim()) throw new Error('identity_required:'+k);
  if(!Array.isArray(services)||!services.length) throw new Error('services_required');
  for(const s of services) {
    if(!s.file || !s.file.startsWith('content/services/')) throw new Error('service_source_required');
    const parsed=parseServiceMarkdown(files?.[s.file],s.name);
    if(parsed.description!==s.description) throw new Error('service_description_unbound');
  }
  const home=copy(files,'content/home.md');
  const about=files['content/about.md']?copy(files,'content/about.md').body:home.body;
  const words=home.heading.split(/\s+/);
  if(words.length<3) throw new Error('hero_heading_requires_three_parts');
  const cut=Math.floor(words.length/3), cut2=Math.floor(words.length*2/3);
  const heroText={line1:words.slice(0,cut).join(' '),emphasis:words.slice(cut,cut2).join(' '),line3:words.slice(cut2).join(' '),eyebrow:facts.name,support:home.body};
  if([heroText.line1,heroText.emphasis,heroText.line3].some(x=>x.length<2||x.length>80)) throw new Error('hero_heading_requires_three_parts');
  return Object.freeze({heroText,serviceIntro:home.body,about,whyHeadline:files['content/about.md']?copy(files,'content/about.md').heading:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
