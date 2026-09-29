const fs=require('fs'),path=require('path'),crypto=require('crypto');
const packet=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/burns-rich-snapshot.json'),'utf8'));
const {materializeUniversalBuildContract}=require('../genie-universal/send-intake-packet.js');
const out=materializeUniversalBuildContract(packet,[]);
const dir=path.join(__dirname,'../evidence/burns-universal-contract');fs.rmSync(dir,{recursive:true,force:true});
for(const [name,content] of Object.entries(out.files)){const rel=name.split('/').slice(1).join('/');const p=path.join(dir,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,String(content));}
const manifest={schema:out.schema,base:out.base,file_count:out.file_count,packet_name:out.packet_name,business_name:out.business_name,snapshot_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../fixtures/burns-rich-snapshot.json'))).digest('hex'),files:Object.fromEntries(Object.entries(out.files).map(([k,v])=>[k,{bytes:Buffer.byteLength(String(v)),sha256:crypto.createHash('sha256').update(String(v)).digest('hex')}]))};
fs.writeFileSync(path.join(__dirname,'../evidence/burns-universal-contract.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({schema:out.schema,file_count:out.file_count,base:out.base,files:Object.keys(out.files).slice(0,80)},null,2));