"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const theme=require("../lib/mirror-engine/theme"),{buildLocalSearchPlan}=require("../lib/local-search-plan"),{isGoogleReviewerFace}=require("../lib/verified-trust-lookup");
test("plumbing cinematic donor stays dark unless strong paper evidence",()=>{assert.equal(theme.decideMode(null,{donor:"plumbing-clean"}).mode,"dark");assert.equal(theme.decideMode({mode:"light",basis:"paper",brightShare:.55,darkShare:.2},{donor:"plumbing-clean"}).mode,"dark");assert.equal(theme.decideMode({mode:"light",basis:"paper",brightShare:.82,darkShare:.08},{donor:"plumbing-clean"}).mode,"light")});
test("verified locality plan is bounded and excludes unsupported rows",()=>{const p=buildLocalSearchPlan({profile:{city:"Mission Viejo",state:"CA",industry:"plumbing"},services:["Drain Cleaning"],evidence:{localities:[{name:"Lake Forest",source:"google_places",verified:true,lat:33.64,lng:-117.69},{name:"Laguna Hills",source:"existing_site",verified:true},{name:"Inventedville",source:"model_guess",verified:false}]}});assert.equal(p.contentPlan.serviceAreaPages,3);assert.deepEqual(p.contentPlan.verifiedLocalities.map(x=>x.name),["Mission Viejo","Lake Forest","Laguna Hills"])});
test("Google generated monograms are ineligible reviewer faces",()=>{assert.equal(isGoogleReviewerFace("https://lh3.googleusercontent.com/a/ACg8ocABC"),false);assert.equal(isGoogleReviewerFace("https://lh3.googleusercontent.com/a-/ALV-UjABC"),true)});
test("plumbing hero video has poster fallback",()=>{const h=fs.readFileSync(path.join(__dirname,"..","donors-clean","plumbing-clean","index.html"),"utf8");assert.match(h,/hero-cgi-flagship-Dla_-qtr\.jpg/);// The 2026-08-17 video-ladder consolidation: the old runtime poster backfill
// observer is gone; the poster now ships baked into the bundle element with a
// CSS background fallback and a preload, so the still is on screen before,
// during and after any clip. (The verbatim port's poster is the design's own
// cinematic flagship photograph; the old hand-built shell used the fitting.)
const b=fs.readFileSync(path.join(__dirname,"..","donors-clean","plumbing-clean","assets",require("fs").readdirSync(path.join(__dirname,"..","donors-clean","plumbing-clean","assets")).find(f=>/^index-.*\.js$/.test(f))),"utf8");assert.match(b,/jsx\("video",\{"data-hero-video":"1",poster:/);
assert.match(h,/video\[data-hero-video\] \{ background: #171512 url\("\/assets\/hero-cgi-flagship-Dla_-qtr\.jpg"\)/)})
