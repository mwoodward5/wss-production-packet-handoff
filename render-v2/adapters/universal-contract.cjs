'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalize}=require('../contracts/client-site-data.cjs');
const {select}=require('./trust-adapter.cjs');
const {coordinate}=require('../build/metadata.cjs');
function readJson(dir,name,fallback){try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch{return fallback}}
function readText(dir,name){try{return fs.readFileSync(path.join(dir,name),'utf8')}catch{return ''}}
function googleSourceUrl(g){return String(g?.fields?.gbpLink||'').startsWith('https://')?g.fields.gbpLink:''}
function applyUniversalContract(client,dir,{google=null,verifiedLogo=false,donorManifest=null}={}){
 const c=JSON.parse(JSON.stringify(client));
 const business=readJson(dir,'client.json',{});
 const services=readJson(dir,'services.json',[]);
 const pages=readJson(dir,'pages.json',[]);
 const faqs=readJson(dir,'faqs.json',[]);
 const social=readJson(dir,'social.json',{});
 const googleUrl=googleSourceUrl(google);
 const sourceBoundDepth=c.source?.depthProvenance==='source-bound-v1';
 if(business.email)c.identity.email=String(business.email);
 if(verifiedLogo){c.identity.logoOnDark='/assets/client-logo.png';c.identity.logoOnLight='/assets/client-logo.png';}
 if(!sourceBoundDepth&&Array.isArray(services)&&services.length){
   const richBy=new Map(services.map(x=>[String(x.name||'').toLowerCase(),x]));
   c.services=c.services.map(prior=>{const x=richBy.get(String(prior.name).toLowerCase());if(!x)return prior;return {name:prior.name,shortLabel:prior.shortLabel,description:String(x.longDescMd||x.shortDesc||prior.description||'').replace(/^# .*?\n+/,'').slice(0,1800),href:typeof x.slug==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.slug)?String(donorManifest?.service_route_prefix||'')+'/'+x.slug:prior.href,source:{file:'services.json'}}});
 }
 if(!sourceBoundDepth&&Array.isArray(faqs))c.content.faqs=faqs.slice(0,20).filter(x=>x&&x.q&&x.a).map(x=>({q:String(x.q),a:String(x.a)}));
 if(google?.status==='mapped'){
   const f=google.fields||{};const rating=Number(String(f.reviewsProof||'').match(/rating\s+([0-5](?:\.\d+)?)/i)?.[1]);const count=Number(String(f.reviewsProof||'').match(/from\s+(\d+)\s+public reviews/i)?.[1]);
   if(Number.isFinite(rating)&&Number.isSafeInteger(count)&&count>0&&googleUrl)c.trust.aggregate={rating,count,sourceUrl:googleUrl};
   if(!sourceBoundDepth&&f.hours)c.trust.hours={text:String(f.hours),source:'Google Business Profile'};
   if(!sourceBoundDepth&&f.serviceArea)c.trust.areas=[String(f.serviceArea)];
   if(googleUrl)c.trust.mapUrl=googleUrl;
 }
 const socials=[];for(const v of Object.values(social||{})){if(typeof v==='string'&&/^https:\/\//.test(v))socials.push(v);if(Array.isArray(v))for(const x of v)if(typeof x==='string'&&/^https:\/\//.test(x))socials.push(x)}c.trust.socials=[...new Set(socials)].slice(0,30);
 let normalized=normalize(c);
 if(donorManifest){const plan=select(normalized,donorManifest);normalized=normalize({...c,trustModules:plan.ids});}
 const content={home:readText(dir,'content/home.md'),services:'',gallery:'',about:readText(dir,'content/about.md'),'service-area':readText(dir,'content/service-areas.md'),contact:readText(dir,'content/contact.md')};
 const plan={schema:'wss-rich-site-plan-v1',pages,services,content,forms:readJson(dir,'forms.json',{}),localPresence:readJson(dir,'local-presence-plan.json',{}),search:readJson(dir,'search-optimization-plan.json',{}),visual:readJson(dir,'visual-system-contract.json',{}),premiumVisual:readJson(dir,'premium-visual-stack.json',{}),seoAssets:{answerEngine:readJson(dir,'answer-engine.json',{}),entity:readJson(dir,'entity.json',{}),localBusiness:readJson(dir,'local-business.jsonld',{})}};
 if(google?.status==='mapped' && plan.localPresence?.mapAndDirections){
   const f=google.fields||{};const lat=coordinate(f.geoLat,-90,90),lng=coordinate(f.geoLng,-180,180);
   plan.localPresence.businessIdentity={...(plan.localPresence.businessIdentity||{}),gbpPlaceId:f.gbpPlaceId||'',hours:f.hours||'',hoursSource:f.hoursSource||'',serviceArea:f.serviceArea||''};
   plan.localPresence.mapAndDirections={...(plan.localPresence.mapAndDirections||{}),googleBusinessUrl:f.gbpLink||'',googlePlaceId:f.gbpPlaceId||'',geo:{lat:Number.isFinite(lat)?lat:null,lng:Number.isFinite(lng)?lng:null,source:'Google Places refreshed lookup',verified:lat!==null&&lng!==null,schemaAllowed:lat!==null&&lng!==null}};
 }
 const packetHash=crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 return {client:normalized,sitePlan:Object.freeze({...plan,packetHash})};
}
module.exports=Object.freeze({applyUniversalContract});
