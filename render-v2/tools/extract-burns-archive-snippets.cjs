const fs=require('fs');
const dir='/app/artifacts/owner-source-revisions/osr_29416a90e616e9f80e5435fa13f3eeb7/';
const pages={
 home:{file:'709f892fe813ee8f5cf2319e5748d3c5fd9883f2682b54861baeb3c47a038f49.html',url:'https://burnslandscapinghouston.com/'},
 reviews:{file:'246986ef14a7ab6eed77b3cb9fb4f9e64c3e6a8ccc927d86efe5302f6cbdb343.html',url:'https://burnslandscapinghouston.com/reviews'},
 about:{file:'e903aabe776e0e6f32d4491a3e644fc548cd0ce57f8fee24c55731e8ebff8502.html',url:'https://burnslandscapinghouston.com/about'}
};
for(const p of Object.values(pages))p.html=fs.readFileSync(dir+p.file,'utf8');
function around(s,t,n=900){const i=s.indexOf(t);return i<0?'':s.slice(Math.max(0,i-n),i+n)}
const out={};
for(const [name,p] of Object.entries(pages)){
 out[name]={url:p.url,sha256:p.file.replace('.html',''),snippets:{}};
 for(const t of ['Paul Dille','Layne Childs','Rita Junker','David Burns','Allie Burns','5,000+','logo']){const x=around(p.html,t);if(x)out[name].snippets[t]=x}
}
fs.writeFileSync('/tmp/burns-archive-snippets.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Object.keys(v.snippets)])),null,2));