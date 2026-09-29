'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRegistry}=require('../categories/exact-category-registry.cjs');
const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'../categories/live-approved-snapshot.json'),'utf8').replace(/^\uFEFF/,''));const rows=snapshot.rows;
test('category registry has no duplicates and exact lookups are fail closed',()=>{const r=createRegistry(rows);assert.equal(r.names.length,rows.length);assert.throws(()=>r.requireExact('not-a-real-category'),/category_exact_match_required/);});
test('landscaping is explicitly installed and points to a named donor',()=>{const r=createRegistry(rows),x=r.requireExact('landscaping');assert.equal(x.installed,true);assert.ok(x.donor);});
test('no installed category has an empty donor',()=>{for(const x of rows)if(x.installed)assert.ok(x.donor,'missing donor: '+x.category);});

test('target catalog contains exactly forty unique categories and no stripped donor is primary',()=>{
  const target=JSON.parse(fs.readFileSync(path.join(__dirname,'../categories/target-40.json'),'utf8'));
  assert.equal(target.count,40);assert.equal(target.rows.length,40);
  assert.equal(new Set(target.rows.map(x=>x.category)).size,40);
  assert.equal(target.legacy_primary_count,0);
  assert.equal(target.rows.filter(x=>x.state==='spa-v2-ready').length,target.production_ready_count);
  for(const x of target.rows){
    if(x.legacy_fallback) assert.notEqual(x.source,'legacy_exact_donor');
    if(x.state==='spa-v2-ready'){assert.equal(x.parity_frozen,true);assert.match(x.lovable_project_id,/^[a-f0-9-]{36}$/);assert.ok(x.spa_v2_donor);}
    if(x.state==='spa-v2-import-required'){assert.equal(x.parity_frozen,false);assert.match(x.lovable_project_id,/^[a-f0-9-]{36}$/);}
    if(x.state==='master-search-required') assert.equal(x.parity_frozen,false);
  }
});
