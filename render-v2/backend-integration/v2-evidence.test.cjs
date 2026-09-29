'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {signEvidence}=require('/app/lib/mirror-engine/engine');
const {nativeMirrorBuildEvidence}=require('/app/lib/line-adapters');
const {lineReleaseInput}=require('/app/lib/owner-proof-delivery');

const buildHash='a'.repeat(64);
const preview='https://wss-test-v2-fixture.wss-ai.com/';
const siteId='11111111-1111-4111-8111-111111111111';
const releaseId='22222222-2222-4222-8222-222222222222';
function evidence(){
  const value={
    renderer:'spa-v2',
    qc_contract:'wss-render-v2-qc-v1',
    evidence_schema:'wss-render-v2-evidence-v1',
    revealable:true,
    build_hash:buildHash,
    preview_url:preview,
    proofIdentity:{site_id:siteId,release_id:releaseId,build_hash:buildHash},
    sharedReleaseEvidence:{
      evidence_schema:'shared-site-release-evidence-v1',
      state:'active',site_id:siteId,release_id:releaseId,build_hash:buildHash,
      canonical_host:'wss-test-v2-fixture.wss-ai.com',
    },
    checks:{render:{status:'passed'},content:{status:'injected'}},
  };
  value.evidence_sha=signEvidence(value);
  return value;
}
test('signed spa-v2 release is native persistence evidence',()=>{
  const e=evidence();
  const out=nativeMirrorBuildEvidence({
    renderer:e.renderer,qc_contract:e.qc_contract,evidence_schema:e.evidence_schema,
    evidence_sha:e.evidence_sha,build_hash:e.build_hash,release_evidence:e,
    ready:true,qc_passed:true,visual_qc_passed:true,content_source:'verified',
  },preview);
  assert.equal(out.native,true);assert.equal(out.reason,'');
  assert.equal(out.evidence.renderer,'spa-v2');
  assert.equal(out.evidence.build_hash,buildHash);
});
test('owner-proof parser accepts exact signed spa-v2 tuple',()=>{
  const e=evidence();
  const out=lineReleaseInput({
    buildHash,previewUrl:preview,proofIdentity:e.proofIdentity,
    buildEvidence:{renderer:e.renderer,qc_contract:e.qc_contract,evidence_schema:e.evidence_schema,evidence_sha:e.evidence_sha,build_hash:buildHash,release_evidence:e},
    releaseEvidence:e,
  },preview);
  assert.ok(out);assert.equal(out.buildHash,buildHash);assert.equal(out.proofIdentity.release_id,releaseId);
});
test('mismatched spa-v2 tuple fails closed',()=>{
  const e=evidence();e.qc_contract='wrong';e.evidence_sha=signEvidence({...e,evidence_sha:undefined});
  const out=nativeMirrorBuildEvidence({renderer:e.renderer,qc_contract:e.qc_contract,evidence_schema:e.evidence_schema,evidence_sha:e.evidence_sha,build_hash:e.build_hash,release_evidence:e,ready:true,qc_passed:true,visual_qc_passed:true},preview);
  assert.equal(out.evidence,null);
});
