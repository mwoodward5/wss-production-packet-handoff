'use strict';
/*
 WSS Intake Genie concurrent-runner contract.
 This module deliberately contains no browser implementation: it is the
 fail-closed workflow/state machine consumed by the authorized UI driver.
*/
const MAX_CONCURRENCY=10;
const SELECTORS=Object.freeze({
 website:'[data-field="websiteUrl"]',
 harvest:'#importBtn',
 google:'#gbpLookupBtn',
 marketing:'#createMarketingPlanBtn',
 compile:'#generateTop',
 forbiddenSend:'#generateBtn',
 compileStatus:'#formStatus',
 googleStatus:'#gbpLookupStatus',
});
const STAGES=Object.freeze(['website','harvest','google','marketing','compile','snapshot','render-v2','verify']);
function validateJob(job){
 if(!job||typeof job!=='object')throw Error('intake_job_required');
 const u=new URL(String(job.website||''));if(u.protocol!=='https:'||u.username||u.password)throw Error('intake_job_https_website_required');
 return Object.freeze({id:String(job.id||u.hostname),website:u.href,category:String(job.category||'').trim().toLowerCase()});
}
function plan(jobs,{concurrency=MAX_CONCURRENCY}={}){
 if(!Array.isArray(jobs)||!jobs.length)throw Error('intake_jobs_required');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>MAX_CONCURRENCY)throw Error('intake_concurrency_out_of_range');
 const normalized=jobs.map(validateJob);const ids=new Set(normalized.map(x=>x.id));if(ids.size!==normalized.length)throw Error('intake_job_id_duplicate');
 return Object.freeze({schema:'wss-intake-concurrent-plan-v1',concurrency,jobs:normalized,stages:STAGES,selectors:SELECTORS,customerSend:false,forbiddenSelector:SELECTORS.forbiddenSend});
}
module.exports=Object.freeze({MAX_CONCURRENCY,SELECTORS,STAGES,validateJob,plan});
