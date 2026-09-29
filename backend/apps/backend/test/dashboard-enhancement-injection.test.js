"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.join(__dirname,"..","..","labs-site");
const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
const js=fs.readFileSync(path.join(ROOT,"assets","dashboard-enhance.js"),"utf8");
const css=fs.readFileSync(path.join(ROOT,"assets","dashboard-enhance.css"),"utf8");
const rich=require("../lib/customer-uploads-rich");

test("dashboard navigation gets an uncached v2 enhancement layer",()=>{
  assert.match(sw,/DASHBOARD_NAV/);assert.match(sw,/\/customer\\\/dashboard/);assert.match(sw,/dashboard-enhance\.css\?v=2/);assert.match(sw,/dashboard-enhance\.js\?v=2/);assert.match(sw,/cache-control","no-store/);assert.match(sw,/widenDashboardUploads/);assert.match(sw,/wss-labs-shell-v8/);
});

test("microphone preflight distinguishes permission, device, busy and unsupported states",()=>{
  assert.doesNotThrow(()=>new Function(js));assert.match(js,/navigator\.mediaDevices\.getUserMedia/);assert.match(js,/navigator\.permissions\.query/);assert.match(js,/NotAllowedError/);assert.match(js,/NotFoundError/);assert.match(js,/NotReadableError/);assert.match(js,/SpeechRecognition\|\|window\.webkitSpeechRecognition/);assert.match(js,/data-wss-pass/);
});

test("preview is mobile-first and exposes phone tablet desktop chrome",()=>{
  assert.match(js,/chooseMobileDefault/);assert.match(js,/phone\.click\(\)/);assert.match(js,/previewtablet/);assert.match(js,/setDevice\('tablet'\)/);assert.match(css,/\.preview-canvas\.phone iframe/);assert.match(css,/\.preview-canvas\.tablet iframe/);assert.match(css,/preview-tool\[aria-pressed="true"\]/);
});

test("customer editor restores explicit photo brand document and media upload boxes",()=>{
  for(const label of ["Photos","Logo / brand","Documents","Media"])assert.match(js,new RegExp(label.replace("/","\\/")));
  assert.match(js,/wss-upload-deck/);assert.match(js,/dataTransfer\.files/);assert.match(sw,/docx\|txt\|md\|html/);assert.match(sw,/mp4\|mov\|webm\|mp3\|wav\|m4a\|ogg/);assert.match(css,/#wss-upload-deck/);
});

test("rich upload sniffer accepts the restored reference formats without making them live-site photos",()=>{
  assert.equal(rich.richSniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),"logo.svg").kind,"document");
  assert.equal(rich.richSniff(Buffer.from("hello world\n"),"notes.md").type,"text/plain; charset=utf-8");
  assert.equal(rich.richSniff(Buffer.from([0x50,0x4b,0x03,0x04,1,2,3,4,5,6,7,8]),"brief.docx").kind,"document");
  assert.equal(rich.richSniff(Buffer.from("definitely not a movie"),"clip.mp4"),null);
});

test("preview enhancement keeps reduced-motion accessibility and edit-state feedback",()=>{
  assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/wss-preview-reveal/);assert.match(css,/wss-mic-ring/);assert.match(js,/edittheater/);assert.match(js,/previewstatus/);assert.match(js,/Live preview connected/);
});
