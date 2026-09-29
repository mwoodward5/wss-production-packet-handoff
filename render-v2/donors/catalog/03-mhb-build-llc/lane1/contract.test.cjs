// Synthetic contract tests only. No fixture below is a real or certified client packet.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('donor.json'));
const evidence = JSON.parse(read('lane1/prospect-evidence.json'));
const {mapDonor} = require('../mapping.cjs');
const bridge = import(pathToFileURL(path.join(root,'source/src/lib/bridge.ts')).href);
const hash = x => createHash('sha256').update(x).digest('hex');
const copy = 'TEST ONLY: source-bound description with copper, timber and Unicode â€” exact bytes.';
const home = 'TEST ONLY: home paragraph supplied by the contract fixture, not a client claim.';
const about = 'TEST ONLY: about paragraph supplied by the contract fixture, not a client claim.';
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,'');
function mappingInput(names=['Kitchen Remodeling']) {
  return {facts:{name:'Donor Contract Test Fixture',category:'general contracting',city:'Test City',state:'TS',phone:'2025550123',website:'https://fixture.invalid/'}, manifest,
    services:names.map(name=>({name,description:copy,file:`content/services/${slug(name)}.md`})),
    files:{'content/home.md':`# Home\n\n${home}\n`,'content/about.md':`# About\n\n${about}\n`,...Object.fromEntries(names.map(name=>[`content/services/${slug(name)}.md`,`# ${name}\n\n${copy}\n`]))}};
}
function fixture(names=['Kitchen Remodeling']) {
  const x=mappingInput(names), mapped=mapDonor(x), sha=hash('TEST ONLY: not an image');
  return {schema:'wss-client-site-data-v2',identity:{businessName:x.facts.name,city:x.facts.city,state:x.facts.state,phoneDisplay:'202-555-0123',phoneTel:'tel:+12025550123',email:'',website:x.facts.website,founded:null,logoOnLight:'/client/test-logo.svg',logoOnDark:'/client/test-logo.svg'},
    hero:{...mapped.heroText,poster:'/client/test-hero.jpg',video:''},
    services:x.services.map(s=>({name:s.name,shortLabel:s.name,description:s.description,href:`/${slug(s.name)}`})),
    media:[{role:'hero',path:'/client/test-hero.jpg',sourceUrl:'https://fixture.invalid/test.jpg',sourceSha256:sha,outputSha256:sha}],
    content:{...mapped,faqs:[]},trust:{reviews:[],areas:[],badges:[],hours:null,stats:[],socials:[]},design:{},
    source:{prospectId:'TEST-ONLY-NOT-A-PROSPECT',compiledAt:'2026-09-28T00:00:00Z',packetSha256:hash('TEST ONLY: not a certified packet'),packetVersion:'test-only-not-certified'}};
}
test('real saved Bespoke adapter failure remains recorded, not manufactured as a passing packet',()=>{
  assert.equal(evidence.prospect_id,'lm-0bae1aca222b62397715a5b736155e88c5e45f9c');
  assert.equal(evidence.actual_adapter_repro.code,'construction_service_copy_unbound');
  assert.deepEqual(evidence.visitor_file_paths,['content/home.md']);
  assert.equal(evidence.certification_signature_reverified,false);
});
test('valid byte-bound Unicode service and home/about copy map unchanged',()=>{
  const x=mappingInput();const y=mapDonor(x);assert.equal(y.about,about);assert.equal(y.heroText.support,home);
  assert.equal(y.heroText.emphasis,x.services[0].name);assert.ok(Object.isFrozen(y));
});
test('missing service file fails closed',()=>{const x=mappingInput();delete x.files[x.services[0].file];assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);});
test('tampered service paragraph fails closed',()=>{const x=mappingInput();x.files[x.services[0].file]+='';x.services[0].description+=' tampered';assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);});
test('first-paragraph leading whitespace is not normalized into a false byte match',()=>{const x=mappingInput();x.files[x.services[0].file]=`# Service\n\n ${copy}\n`;assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);});
test('CRLF within a paragraph is not normalized into a false byte match',()=>{const x=mappingInput();x.services[0].description=copy+'\nSecond line.';x.files[x.services[0].file]=`# Service\r\n\r\n${copy}\r\nSecond line.\r\n`;assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);});
test('CRLF file structure around a single exact paragraph remains supported',()=>{const x=mappingInput();x.files[x.services[0].file]=`# Service\r\n\r\n${copy}\r\n`;assert.doesNotThrow(()=>mapDonor(x));});
test('inherited file entries cannot satisfy the binding',()=>{const x=mappingInput();x.files=Object.create(x.files);assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);});
test('traversal and non-markdown service paths fail closed',()=>{
  for(const p of ['content/services/../home.md','content/services/service.txt','content/services/a/../../home.md']){const x=mappingInput();x.services[0].file=p;x.files[p]=`# Service\n\n${copy}\n`;assert.throws(()=>mapDonor(x),/construction_service_copy_unbound/);}
});
test('missing home and incompatible donor category remain refused',()=>{
  const x=mappingInput();delete x.files['content/home.md'];assert.throws(()=>mapDonor(x),/construction_home_copy/);
  const y=mappingInput();y.facts.category='nail salon';assert.throws(()=>mapDonor(y),/construction_category_mismatch/);
});
test('all ten source-observed Bespoke service names survive donor bridge unchanged',async()=>{
  const {createBridge}=await bridge;const names=evidence.facts.services;
  const x=fixture(names);const y=createBridge(x);assert.deepEqual(y.services.map(s=>s.name),names);
  assert.equal(y.services.length,10);assert.equal(JSON.stringify(x).includes('MHB Build'),false);
});
test('four previously false-negative service labels have no second broad qualification',async()=>{
  const {createBridge}=await bridge;for(const name of ['Exterior Projects','Basement Finishing','Garage Conversions','Aging in Place']) assert.equal(createBridge(fixture([name])).services[0].name,name);
});
test('unbound rich-plan service prose cannot replace certified service description',async()=>{
  const {createBridge}=await bridge;const x=fixture();const y=createBridge(x,{schema:'wss-rich-site-plan-v1',services:[{name:x.services[0].name,slug:'kitchen-remodeling',longDescMd:'UNBOUND OVERRIDE: invented claim'}]});
  assert.equal(y.serviceDetails['kitchen-remodeling'].intro,copy);assert.deepEqual(y.serviceDetails['kitchen-remodeling'].bullets,[]);assert.deepEqual(y.serviceDetails['kitchen-remodeling'].faqs,[]);
});
test('unbound rich-plan page prose cannot replace source-bound page copy',async()=>{
  const {createBridge}=await bridge;const x=fixture();const poison='UNBOUND OVERRIDE: invented claim';const keys=['home','about','services','contact','gallery','service-area','process'];
  const y=createBridge(x,{schema:'wss-rich-site-plan-v1',content:Object.fromEntries(keys.map(k=>[k,poison]))});
  assert.equal(y.pageCopy('home'),home);assert.equal(y.pageCopy('about'),about);assert.equal(y.pageCopy('services'),home);
  for(const k of ['contact','gallery','service-area','process'])assert.equal(y.pageCopy(k),'');
});
test('absent optional channels/media have no donor fallback or invented content',async()=>{
  const {createBridge}=await bridge;const y=createBridge(fixture());
  assert.deepEqual(y.client.content.faqs,[]);assert.deepEqual(y.client.trust.reviews,[]);assert.deepEqual(y.client.trust.areas,[]);assert.equal(y.client.trust.hours,null);
  assert.deepEqual(y.projects,[]);assert.equal(y.companyPhoto,undefined);assert.deepEqual(y.processSteps,[]);assert.equal(y.business.region,'');
});
test('supplied normalized FAQ/areas/reviews/hours preserved, never expanded',async()=>{
  const {createBridge}=await bridge;const x=fixture();x.content.faqs=[{q:'TEST ONLY question?',a:'TEST ONLY answer supplied by fixture.'}];x.trust.areas=['TEST ONLY area'];
  x.trust.reviews=[{author:'TEST ONLY author',text:'TEST ONLY review supplied by fixture.',rating:null,sourceUrl:'https://fixture.invalid/review'}];x.trust.hours=['TEST ONLY supplied hours'];
  const y=createBridge(x);assert.deepEqual(y.client.content.faqs,x.content.faqs);assert.deepEqual(y.client.trust.areas,x.trust.areas);assert.equal(y.client.trust.reviews.length,1);assert.deepEqual(y.client.trust.hours,x.trust.hours);
});
test('missing hero media, malformed packet hash and slug collision still fail closed',async()=>{
  const {createBridge}=await bridge;const a=fixture();a.media=[];assert.throws(()=>createBridge(a),/client_data_hero_media_unbound/);
  const b=fixture();b.source.packetSha256='not-a-hash';assert.throws(()=>createBridge(b),/client_data_string_length|client_data_packet_sha_invalid/);
  const c=fixture();c.services.push({...c.services[0]});assert.throws(()=>createBridge(c),/service_slug_collision/);
});
test('native declarations correspond to source-bound slots only',()=>{
  const index=read('source/src/pages/Index.tsx');
  for(const channel of ['services','about','faqs','areas']){
    assert.deepEqual(manifest.content_render_targets[channel],[{path:'/',selector:`[data-wss-channel='${channel}']`}]);
    assert.ok(index.includes(channel==='areas'?'data-wss-channel={business.region ? "areas" : undefined}':`data-wss-channel="${channel}"`));
  }
  for(const channel of ['reviews','hours'])assert.equal(manifest.content_render_targets[channel],undefined);
  assert.ok(index.includes('faqs.length > 0 &&'));
});
test('catalog readiness, original styling, hero and canonical public files stay unchanged',()=>{
  const baseline=JSON.parse(read('lane1/baseline.json'));
  assert.equal(manifest.runtime_eligible,false);assert.equal(manifest.visual_parity_verified,false);
  const catalog=fs.readFileSync(path.resolve(root,'../../../categories/donor-catalog.json'));
  assert.equal(hash(catalog),baseline.catalog_sha256);
  for(const p of ['source/src/index.css','source/tailwind.config.ts','source/src/components/site/PremiumHero.tsx','source/public/llms.txt','source/public/llms-full.txt','source-provenance.json'])assert.equal(hash(fs.readFileSync(path.join(root,p))),baseline.files[p]);
  assert.match(read('source/vite.config.ts'),/publicDir:\s*false/);
});
test('active source has no donor identity/contact residue outside non-rendered comments',()=>{
  const bad=/MHB Build|mhbbuild|Independence|Northern Kentucky|859.?393.?9006/i;
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['assets','integrations','test'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(?:tsx?|js|css)$/.test(e.name))assert.equal(bad.test(fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'')),false,path.relative(root,p));}}
  walk(path.join(root,'source/src'));
});
