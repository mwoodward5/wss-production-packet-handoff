'use strict';
const SHA256 = /^[a-f0-9]{64}$/i;
const PROJECT_ID = /^[a-f0-9-]{36}$/i;
function fail(code,path,detail){const e=new Error(code);e.code=code;e.path=path;if(detail!==undefined)e.detail=detail;throw e;}
function validate(manifest,{category='',expectedProjectId='',expectedRef=''}={}){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('donor_manifest_required','/');
 if(manifest.renderer!=='spa-v2')fail('donor_renderer_invalid','/renderer',manifest.renderer);
 const cat=String(manifest.category||'').trim().toLowerCase();
 if(!cat)fail('donor_category_required','/category');
 if(category&&cat!==String(category).trim().toLowerCase())fail('donor_category_invalid','/category',cat);
 const pid=String(manifest.source?.project_id||'');
 if(!PROJECT_ID.test(pid))fail('donor_source_project_invalid','/source/project_id',pid);
 if(expectedProjectId&&pid!==expectedProjectId)fail('donor_source_pin_invalid','/source/project_id',pid);
 const ref=String(manifest.source?.ref||'');
 if(!ref)fail('donor_source_ref_required','/source/ref');
 if(expectedRef&&ref!==expectedRef)fail('donor_source_pin_invalid','/source/ref',ref);
 if(manifest.flags?.fleet_polish!==false||manifest.flags?.generic_mobile_polish!==false||manifest.flags?.generic_theme_reconstruction!==false)fail('donor_spa_polish_must_be_off','/flags');
 const bp=manifest.breakpoints;
 if(!Array.isArray(bp)||bp.join(',')!=='1440,768,390')fail('donor_breakpoints_invalid','/breakpoints');
 if(!Array.isArray(manifest.visual?.fonts)||!manifest.visual.fonts.length)fail('donor_fonts_required','/visual/fonts');
 if(!Number.isSafeInteger(manifest.visual?.expected_animations)||manifest.visual.expected_animations<0)fail('donor_animation_contract_invalid','/visual/expected_animations');
 if(manifest.bundle){
  if(!SHA256.test(String(manifest.bundle.tree_sha256||'')))fail('donor_bundle_tree_hash_invalid','/bundle/tree_sha256');
  for(const [p,sha] of Object.entries(manifest.bundle.files||{}))if(!p||!SHA256.test(String(sha)))fail('donor_bundle_hash_invalid','/bundle/files/'+p);
 }
 return Object.freeze(manifest);
}
module.exports=Object.freeze({RENDERER:'spa-v2',validate,fail});
