const fs=require('fs'),path=require('path');
for(const f of ['firecrawl-intake.js','google-places-intake.js','compile-build-packet.js','intake-genie-compile.js','send-intake-packet.js']){
 const p='C:/ghx-genie/api/'+f,s=fs.readFileSync(p,'utf8');
 const hits=[];
 for(const re of [/req\.body[^\n]{0,220}/g,/action[^\n]{0,180}/gi,/compile[^\n]{0,180}/gi,/harvest[^\n]{0,180}/gi,/place[_A-Za-z]*id[^\n]{0,180}/gi,/packet[^\n]{0,180}/gi]){
   for(const m of s.matchAll(re)){if(hits.length<60)hits.push(m[0].trim())}
 }
 console.log('\n### '+f+'\n'+[...new Set(hits)].join('\n'));
}