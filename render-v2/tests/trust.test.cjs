'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const reg=require('../trust/registry.cjs');const {select}=require('../adapters/trust-adapter.cjs');
const client=JSON.parse(fs.readFileSync(path.join(__dirname,'../evidence/burns-build-result.json'),'utf8')).client_data;
const donor=JSON.parse(fs.readFileSync(path.join(__dirname,'../donors/landscaping/donor.json'),'utf8'));
test('registry contains exactly forty unique trust modules',()=>{assert.equal(reg.ALL_IDS.length,40);assert.equal(new Set(reg.ALL_IDS).size,40);});
test('every kit module resolves to the copied live implementation',()=>{for(const id of reg.KIT_IDS)assert.equal(reg.loadKit(id).name,id);});
test('Burns proof gating keeps sourced aggregate/map and omits unbound depth',()=>{const plan=select(client,donor);assert.ok(plan.ids.includes('rating-orb'));assert.ok(!plan.ids.includes('review-schema-bridge'));assert.equal(client.trust.aggregate.rating,4.1);assert.equal(client.trust.aggregate.count,35);assert.match(client.trust.aggregate.sourceUrl,/google/i);assert.deepEqual(client.trust.reviews,[]);assert.equal(client.trust.hours,null);assert.deepEqual(client.trust.areas,[]);assert.match(client.trust.mapUrl,/google/i);});
test('trust selection is deterministic and stays within visual budget',()=>{const a=select(client,donor),b=select(client,donor);assert.deepEqual(a.ids,b.ids);assert.ok(a.visualCount<=donor.trust.max_visual_modules);});
