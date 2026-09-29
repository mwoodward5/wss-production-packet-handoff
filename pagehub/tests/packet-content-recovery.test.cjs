'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const net = require('node:net');
const root = process.env.WSS_TEST_ROOT || path.resolve(__dirname,'..');
const original = root;
const read = f => fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');
const deny = () => { throw Error('offline test forbids provider/auth/network execution'); };
function isolated(source, dependencies) {
  const module = {exports:{}};
  const context = vm.createContext({module,exports:module.exports,URL,URLSearchParams,Buffer,TextEncoder,TextDecoder,
    AbortController,console,process:{env:{}},fetch:deny,setTimeout,clearTimeout,
    require:id => { if (!(id in dependencies)) throw Error('Unexpected dependency '+id); return dependencies[id]; }});
  new vm.Script(source).runInContext(context,{timeout:5000}); return module.exports;
}
const fire = isolated(read('api/firecrawl-intake.js')+'\nmodule.exports.__fallback=fallbackExtract;', {
  'node:dns':{promises:{lookup:deny}},'node:net':net,'./lib/provider-route-auth':{requireProviderRouteAuth:deny}});
const compiler = isolated(read('api/compile-build-packet.js'),{
  'node:crypto':crypto,'./firecrawl-intake':fire,'./lib/provider-route-auth':{requireProviderRouteAuth:deny},
  './lib/source-page-archive':require(path.join(original,'api/lib/source-page-archive.js')),
  './lib/source-editorial-worklist':require(path.join(original,'api/lib/source-editorial-worklist.js'))});
const Q=fire.intakeQuality; const plain=v=>JSON.parse(JSON.stringify(v));
const junk=['Meet the Team','Giving Back','Senior Maintenance Supervisor','General Manager of Home Services',
  'Director of Lawn Care, Plant Health Care and Pest Defense','Kingstowne - services overview - full version | HubSpot Video',
  'What Makes Kingstowne Lawn and Landscape Different','Alexandria, VA','Our team will prepare customized options',
  'Overwhelmed by lawn care and landscaping projects, annoyed by mosquitoes'];
const services=['Design-Build','Pest Defense','Home Services','Landscape Maintenance','Landscape Design','Pruning & Weeding',
  'Patios, Walkways & Driveways','Lawn Aeration & Seeding','Fences & Custom Woodwork','Mulching & Edging','Ponds & Water Features','Leaf Removal & Clean-up'];
for(const label of junk)test('reject non-service: '+label,()=>assert.equal(Q.serviceLabel(label),''));
for(const label of services)test('retain actual service syntax: '+label,()=>assert.equal(Q.serviceLabel(label),label));
for(const value of ['Monday-Friday, 8 AM-5 PM','Mon-Fri 08:00-17:00; Saturday closed','Open 24 hours','24/7','By appointment only','Sunday: Closed','Daily 7:30 AM - 8:00 PM'])
  test('retain human hours: '+value,()=>assert.equal(Q.hours(value),value));
for(const value of ['()),h(n.getUTCMinutes()),h(n.getUTCSeconds()),"Z".join("")','<script>Monday 8 AM-5 PM</script>','return h.getHours()','Hours unknown','Monday 25:99-29:00',''])
  test('withhold invalid hours: '+value,()=>assert.equal(Q.hours(value),''));
function packet(){return {business:{businessName:'Kingstowne Lawn & Landscape',domainUrl:'https://www.kingstownelawn.com/',
  category:'landscaping',phone:'703-921-9200',serviceArea:'Alexandria, VA',hours:'()),h(n.getUTCMinutes()),"Z".join("")',hoursSource:'Client website',
  exactServices:[...junk,...services].join('\n')},goldenArtifacts:{exactServices:[...junk,...services]},
  sources:{urls:['https://www.kingstownelawn.com/'],observations:[{source:'https://www.kingstownelawn.com/',status:'succeeded',
    extracted:{exactServices:[...junk,...services].join('\n')},private_source:{markdown:[...junk,...services].map(x=>'## '+x).join('\n')}}]},
  selectedTemplateId:'single-cinematic-motion',pagePlan:[{title:'Home',slug:''}]};}
test('compile cleans selected hours/services, preserves archive and caller',()=>{
  const p=packet(),before=JSON.stringify(p),r=compiler.compilePacket(p);assert.equal(JSON.stringify(p),before);
  assert.deepEqual(plain(r.compiled.contentContract.facts.services),services);assert.equal(r.business.hours,'');assert.equal(r.business.hoursSource,'');
  const copy=JSON.stringify(r.compiled.contentContract.visitor_copy.files);assert.doesNotMatch(copy,/getUTC|HubSpot|Supervisor|General Manager|offers Alexandria/);
  assert.equal(r.sources.observations[0].private_source.markdown,p.sources.observations[0].private_source.markdown);
  assert.ok(r.review.intakeQuality.issues.some(x=>x.rule==='invalid_hours'));
  assert.equal(r.compiled.contentQuality.status,'block');
});
test('harvest ignores scripts and does not invent hours from JavaScript',()=>{
  const result=fire.__fallback('https://example-business.test/', '# Services\n## Lawn Aeration & Seeding',{},
    '<script>const hours=h.getUTCMinutes();</script><footer>Monday-Friday: 8 AM-5 PM</footer>');
  assert.doesNotMatch(result.hours||'',/getUTC|const|script/);
});
test('harvest retains an actual visible hours line',()=>{
  const r=fire.__fallback('https://example-business.test/','# Contact\nMonday-Friday: 8 AM-5 PM',{},'');
  assert.equal(r.hours,'Monday-Friday: 8 AM-5 PM');
});
test('non-HVAC source-proven labels work when no selected service list exists',()=>{
  const p=packet();p.business.hours='Monday-Friday 8 AM-5 PM';delete p.business.exactServices;p.goldenArtifacts={};
  p.sources.observations[0].extracted.exactServices='Landscape Design';
  const r=compiler.compilePacket(p);assert.deepEqual(plain(r.compiled.contentContract.facts.services),['Landscape Design']);
});
test('foreign, negative and structured-only evidence still refuses',()=>{
  for(const change of [p=>p.sources.observations[0].source='https://unrelated.test/',p=>p.sources.observations[0].private_source.markdown='We do not offer Landscape Design.',p=>p.sources.observations[0].private_source.markdown='']){
    const p=packet();p.business.exactServices='Landscape Design';p.goldenArtifacts.exactServices=['Landscape Design'];change(p);
    const r=compiler.compilePacket(p);assert.equal((r.compiled.contentContract.facts.services||[]).length,0);
  }
});
test('browser/server policy parity and truthful completion banner',()=>{
  const extract=(s,prefix)=>{const start=s.indexOf(prefix+'function createIntakeQualityPolicy(');const end=s.indexOf('\n'+prefix+'}',start);assert.ok(start>=0&&end>start);return s.slice(start,end+prefix.length+2).split('\n').map(l=>l.startsWith(prefix)?l.slice(prefix.length):l).join('\n');};
  assert.equal(extract(read('index.html'),'    '),extract(read('api/firecrawl-intake.js'),''));
  assert.doesNotMatch(read('index.html'),/Packet is now ready for the production build lane\./);
  assert.match(read('index.html'),/const gate = packetQualityGateState\(state.packet\)/);
});
