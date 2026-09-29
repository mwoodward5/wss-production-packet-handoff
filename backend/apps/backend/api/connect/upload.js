"use strict";

// POST /api/connect/upload — one authenticated customer file per request.
// The tenant token decides the storage prefix; filenames never decide paths.
// Photos/PDFs keep the original byte-sniffed path, while the rich adapter adds
// the reference formats exposed by the restored customer editor.

const { resolveConnectScope } = require("../../lib/connect");
const { readJson } = require("../../lib/http");
const { recordEvent } = require("../../lib/store");
const { MAX_UPLOAD_BYTES, ensureUploadBucket, storeCustomerUpload } = require("../../lib/customer-uploads-rich");

const SLUG_RE=/^[a-z0-9][a-z0-9-]{1,80}$/;
const MAX_BASE64_CHARS=Math.ceil(MAX_UPLOAD_BYTES/3)*4+4096;

function cors(req,res){
  const origin=String(req.headers.origin||"");
  const allowed=["https://connect.wss-labs.com","https://wss-ai.com","https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin",allowed.includes(origin)?origin:"https://wss-ai.com");res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, x-connect-token, x-admin-token");res.setHeader("Access-Control-Max-Age","86400");
  if(req.method==="OPTIONS"){res.statusCode=204;res.end();return true;}return false;
}
function send(res,status,payload){res.statusCode=status;res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");return res.end(JSON.stringify(payload));}
let bucketReady=null;

module.exports=async function handler(req,res){
  if(cors(req,res))return;if(req.method!=="POST")return send(res,405,{ok:false,error:"method_not_allowed"});
  const scope=resolveConnectScope(req);if(!scope)return send(res,401,{ok:false,error:"unauthorized"});
  const asked=String((req.query&&req.query.slug)||"").trim().toLowerCase();
  const siteSlug=scope.mode==="tenant"?String(scope.siteSlug||""):(SLUG_RE.test(asked)?asked:"");
  if(!SLUG_RE.test(siteSlug))return send(res,400,{ok:false,reason:"no_site_bound_to_this_login",say:"This login isn't linked to a website yet, so there's nowhere to put that file."});

  let body;try{body=await readJson(req);}catch{return send(res,400,{ok:false,reason:"invalid_json",say:"That upload didn't arrive in one piece. Try it once more."});}
  const raw=String(body.data||body.dataBase64||"");const base64=raw.startsWith("data:")?raw.slice(raw.indexOf(",")+1):raw;
  if(!base64)return send(res,400,{ok:false,reason:"no_file",say:"No file came through with that."});
  if(base64.length>MAX_BASE64_CHARS)return send(res,413,{ok:false,reason:"too_large",say:`That file is bigger than the ${(MAX_UPLOAD_BYTES/1e6).toFixed(1)} MB we can take. A smaller copy will go straight through.`});
  let buffer;try{buffer=Buffer.from(base64,"base64");}catch{buffer=Buffer.alloc(0);}

  try{
    if(!bucketReady)bucketReady=ensureUploadBucket().catch(()=>({ok:false}));await bucketReady;
    const stored=await storeCustomerUpload({siteSlug,buffer,displayName:body.name});
    if(!stored.ok){await recordEvent("ghost_agency_customer_upload_refused",{siteSlug,reason:stored.reason,bytes:buffer.length}).catch(()=>{});return send(res,stored.reason==="too_large"?413:400,{ok:false,reason:stored.reason,say:stored.say});}
    await recordEvent("ghost_agency_customer_upload_stored",{siteSlug,kind:stored.attachment.kind,type:stored.attachment.type||null,bytes:stored.attachment.bytes,sha256:stored.attachment.sha256}).catch(()=>{});
    return send(res,200,{ok:true,attachment:{url:stored.attachment.url,name:stored.attachment.name,kind:stored.attachment.kind,type:stored.attachment.type||null,bytes:stored.attachment.bytes}});
  }catch(error){return send(res,500,{ok:false,reason:String((error&&error.message)||error).slice(0,160),say:"We couldn't store that file just now. Try again in a moment."});}
};
