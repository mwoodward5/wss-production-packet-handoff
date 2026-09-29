"use strict";
// Riley polls this tool to report the durable state of a real website edit.
//
// The tool itself lives in lib/edit-status-core.js so the ONE proxy door
// (api/vapi-tools/riley.js) can dispatch to it as a library function — one
// authentication for every tool, instead of one secret header per route to
// drift out from under a live call. This route keeps only the transport shell
// and answers exactly as before.
const { methodGuard } = require("../../lib/http");
const { authorized } = require("../../lib/vapi-auth");
const { emitRileyToolCall } = require("../../lib/riley-telemetry");
const { siteEditStatusCore } = require("../../lib/edit-status-core");

async function bodyOf(req){if(req.body&&typeof req.body==="object")return req.body;try{const raw=await new Promise((resolve)=>{let data="";req.on("data",(chunk)=>{data+=chunk;});req.on("end",()=>resolve(data||"{}"));});return JSON.parse(raw);}catch{return {};}}

module.exports=async function handler(req,res){
  const startedAt=Date.now();
  if(!methodGuard(req,res,["GET","POST"]))return;
  if(!authorized(req)){
    // THE PROVEN REPEAT OFFENDER. Production ran this route 0-for-3 on auth
    // (calls 7 ×2, call 11) — bare "unauthorized" while request_site_change
    // answered on the same account seconds apart — and nothing in the logs
    // said so, because this route logged nothing. The one structured line
    // names the route, so a drifted/rotated status secret is visible at
    // deploy time, not only on a live call.
    emitRileyToolCall(process.env,{tool:"site_edit_status",status:401,outcome:"unauthorized",ms:Date.now()-startedAt});
    res.statusCode=401;return res.end(JSON.stringify({ok:false,error:"unauthorized"}));
  }
  try{
    const body=await bodyOf(req);
    const out=await siteEditStatusCore(body,req.query||{});
    res.setHeader("Content-Type","application/json");
    res.statusCode=out.status;
    return res.end(JSON.stringify(out.payload));
  }catch(error){res.statusCode=500;return res.end(JSON.stringify({ok:false,error:String(error.message||error)}));}
};
