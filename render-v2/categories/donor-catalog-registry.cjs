'use strict';
const crypto=require('node:crypto');
const catalog=require('./donor-catalog.json');
const target=require('./target-40.json');
function normalize(v){return String(v||'').trim().toLowerCase().replace(/[ _-]+/g,' ').replace(/\s+/g,' ')}
const byVertical=new Map(Object.entries(catalog.by_vertical||{}).map(([k,v])=>[normalize(k),Object.freeze([...v])]));
const aliases=new Map();
function addAlias(alias,category){const a=normalize(alias),c=normalize(category);if(!a||!byVertical.has(c))return;const prior=aliases.get(a);if(prior&&prior!==c){aliases.set(a,null);return}aliases.set(a,c)}
for(const v of byVertical.keys())addAlias(v,v);
for(const row of target.rows||[]){const c=normalize(row.category);if(!byVertical.has(c))continue;addAlias(c,c);for(const a of row.aliases||[])addAlias(a,c)}
const extra={
 'tree care':'tree service','stump grinding':'tree service','arborist':'tree service',
 'roofing contractor':'roofing','electrical contractor':'electrical','plumbing contractor':'plumbing',
 'general contracting':'general contractor','construction company':'general contractor',
 'auto shop':'auto repair','car repair':'auto repair','car detailing':'auto detailing','detailer':'auto detailing',
 'tow truck':'roadside assistance','towing':'roadside assistance','mobile rv repair':'rv repair',
 'black car':'black car service','chauffeur':'black car service','fence contractor':'fencing',
 'photography':'photographer','mattress':'mattress store','hypnosis':'hypnotherapy'
};
for(const [a,c] of Object.entries(extra))addAlias(a,c);
function resolveCategory(value){const k=normalize(value);if(byVertical.has(k))return k;return aliases.get(k)||null}
function pinned(row){return !!row &&
 row.source_import_verified===true && row.client_bindings_verified===true &&
 /^[a-f0-9]{40}$/i.test(row.source_commit||'') &&
 /^[a-f0-9]{64}$/i.test(row.source_tree_sha256||'') &&
 /^[a-f0-9]{64}$/i.test(row.bundle||'')}
function eligible(row){return pinned(row) && row.runtime_eligible===true &&
 row.implementation_status==='WSS_ADAPTED' && row.visual_parity_verified===true}
function smokeEnabled(env=process.env){return String(env.GHOST_AGENCY_LINE_LIVE_SENDS||'')==='0' &&
 String(env.GHOST_AGENCY_SANDBOX_AUTOSEND||'').toLowerCase()==='true'}
function smokeEligible(row,env=process.env){return pinned(row) &&
 row.implementation_status==='WSS_ADAPTED' && smokeEnabled(env)}
function rowFor(key,{smoke=false,env=process.env}={}){const row=catalog.donors.find(r=>r.key===key);
 return smoke?(smokeEligible(row,env)?row:null):(eligible(row)?row:null)}
function readyRow(key){return rowFor(key)}
function donorsFor(value,options={}){const c=resolveCategory(value);return Object.freeze(
 (c?byVertical.get(c)||[]:[]).filter(key=>rowFor(key,options)))}
function pickDonor(value,seed='',options={}){const category=resolveCategory(value);if(!category)return null;
 const list=donorsFor(category,options);if(!list.length)return null;
 if(list.length===1)return Object.freeze({category,donorKey:list[0]});
 const h=crypto.createHash('sha256').update(String(seed||category)).digest();
 return Object.freeze({category,donorKey:list[h.readUInt32BE(0)%list.length]})}
function assertUnambiguous(){for(const [a,c] of aliases)if(c===null){const e=new Error('donor_alias_ambiguous:'+a);e.alias=a;throw e}return true}
module.exports=Object.freeze({catalog,normalize,resolveCategory,donorsFor,pickDonor,assertUnambiguous,
 byVertical,eligible,smokeEligible,smokeEnabled,rowFor,readyRow});
