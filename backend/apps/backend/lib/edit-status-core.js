"use strict";
// lib/edit-status-core.js — the core of api/vapi-tools/site-edit-status.js,
// extracted so the ONE proxy door (api/vapi-tools/riley.js) can dispatch to it
// as a library function instead of an HTTP hop. Riley polls this tool to report
// the durable state of a real website edit. The route keeps only the
// method/auth/body plumbing; this module owns the lookup, the stall flag and
// the spoken answer, byte-for-byte as the route carried them.

const { select } = require("./store");
const { describeEditProgress, flagStalledEditJob } = require("./edit-progress");
const { asksCallerToDoTheFinding } = require("./site-edit-core");

function promisesNonexistentHandoff(value){
  const text=String(value||"");
  return /\b(?:someone|a person|a developer|a specialist)\s+on\s+(?:our|the)\s+team\b/i.test(text)
    || /\b(?:passed|handed|escalated|flagged)\s+(?:this|it|that)?\s*(?:over\s+)?to\s+(?:our|the)\s+team\b/i.test(text)
    || /\b(?:the\s+)?team\s+(?:has|is|will)\b/i.test(text)
    || /\bflagged\s+it\s+for\s+the\s+team\b/i.test(text);
}
function safeSpoken(value){
  const text=String(value||"").trim();
  if(!text||asksCallerToDoTheFinding(text)||promisesNonexistentHandoff(text))return "";
  return text;
}
function fallback(job,runningLong){
  if(job.status==="done")return "Great news — your change is live. Refresh the site and you'll see it right now.";
  if(job.status==="refused")return "I couldn't complete that change with the current editor, and I won't guess on your live site. The request is recorded as refused and nothing on your site has changed. You can rephrase it or try again after the editor is updated.";
  if(job.status==="failed")return "That change didn't complete. The failure is recorded and I won't claim it worked. Nothing further will happen unless you retry it.";
  if(runningLong)return "This is taking longer than it should, so the job is recorded as stalled. I won't guess at a time — ask me again and I'll read the recorded status.";
  return "It's still running. I'm not going to guess at a time on you — give me a moment and I'll look again.";
}

/**
 * The whole tool, minus transport: given the parsed request body and the
 * query object (a GET can carry jobId there), return `{ status, payload }`
 * where payload is EXACTLY what the route sends — the VAPI envelope applied
 * on the success path exactly as the route always applied it (errors stay
 * flat, exactly as they always were).
 */
async function siteEditStatusCore(body, query = {}){
  const call=body?.message?.toolCalls?.[0];let args=call?.function?.arguments||body;if(typeof args==="string"){try{args=JSON.parse(args);}catch{args={};}}
  const jobId=String(args?.jobId||args?.job_id||query?.jobId||"").trim();if(!jobId)return {status:400,payload:{ok:false,error:"jobId required"}};
  const found=await select("ghost_agency_edit_jobs",`job_id=eq.${encodeURIComponent(jobId)}&limit=1`);const job=found?.ok&&Array.isArray(found.data)?found.data[0]:null;
  if(!job)return {status:404,payload:{ok:false,error:"job not found"}};

  const claimedAt=Date.parse(String(job.updated_at||job.created_at||""));const runningLong=Number.isFinite(claimedAt)&&Date.now()-claimedAt>3*60*1000;
  if(runningLong&&(job.status==="running"||job.status==="queued")){
    const attempts=Number(job.result&&typeof job.result==="object"?job.result.attempts:1);
    await flagStalledEditJob({jobId,attempt:Number.isFinite(attempts)&&attempts>0?Math.floor(attempts):1,stage:job.status,stalledMs:Date.now()-claimedAt,siteSlug:String(job.site_slug||""),source:"riley_status_tool"});
  }
  const meter=await describeEditProgress(job, { select }).catch(()=>null);
  const resultSay=safeSpoken(job.result&&typeof job.result==="object"?job.result.say:"");
  const meterSay=safeSpoken(meter&&typeof meter==="object"?meter.plainWords:"");
  const say=resultSay||meterSay||fallback(job,runningLong);
  const payload={ok:true,jobId,status:job.status,result:job.result||null,meter,say};
  if(call?.id)return {status:200,payload:{results:[{toolCallId:call.id,result:JSON.stringify(payload)}]}};
  return {status:200,payload};
}

module.exports = { siteEditStatusCore, safeSpoken, fallback };
