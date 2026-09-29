'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const registry=require('../categories/donor-catalog-registry.cjs');
const {bundleFor}=require('../build/build-site.cjs');
const smokeEnv={GHOST_AGENCY_LINE_LIVE_SENDS:'0',GHOST_AGENCY_SANDBOX_AUTOSEND:'true'};
const liveEnv={GHOST_AGENCY_LINE_LIVE_SENDS:'1',GHOST_AGENCY_SANDBOX_AUTOSEND:'true'};
test('owner smoke admits adapted pinned donors but live does not',()=>{
 const smoke=registry.pickDonor('electrical','smoke-1',{smoke:true,env:smokeEnv});
 assert.ok(smoke); assert.equal(smoke.category,'electrical');
 assert.equal(registry.pickDonor('electrical','live-1',{smoke:false,env:liveEnv}),null);
});
test('customer-send switch disables smoke eligibility',()=>{
 const row=registry.catalog.donors.find(r=>r.key==='05-dn-electric-ltd');
 assert.equal(registry.smokeEligible(row,smokeEnv),true);
 assert.equal(registry.smokeEligible(row,liveEnv),false);
});
test('promoted adapted bundle is hash-pinned and loadable only in smoke mode',()=>{
 const row=registry.catalog.donors.find(r=>r.key==='05-dn-electric-ltd');
 const oldLive=process.env.GHOST_AGENCY_LINE_LIVE_SENDS, oldAuto=process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
 process.env.GHOST_AGENCY_LINE_LIVE_SENDS='0'; process.env.GHOST_AGENCY_SANDBOX_AUTOSEND='true';
 const loaded=bundleFor(row.vertical,row.key,{smoke:true});
 assert.equal(loaded.manifest.bundle.tree_sha256,row.bundle);
 assert.ok(loaded.bundle['index.html']);
 process.env.GHOST_AGENCY_LINE_LIVE_SENDS='1';
 assert.throws(()=>bundleFor(row.vertical,row.key),/spa_v2_donor_not_adapted/);
 if(oldLive===undefined) delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS; else process.env.GHOST_AGENCY_LINE_LIVE_SENDS=oldLive;
 if(oldAuto===undefined) delete process.env.GHOST_AGENCY_SANDBOX_AUTOSEND; else process.env.GHOST_AGENCY_SANDBOX_AUTOSEND=oldAuto;
});
