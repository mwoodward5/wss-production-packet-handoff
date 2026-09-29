const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {readTree,treeHash}=require('../build/file-tree.cjs');
const src=path.join(__dirname,'../donors/landscaping/source/dist'),dst=path.join(__dirname,'../donors/landscaping/bundle');
fs.rmSync(dst,{recursive:true,force:true});fs.cpSync(src,dst,{recursive:true});
const files=readTree(dst);const hashes=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,crypto.createHash('sha256').update(v).digest('hex')]));
const p=path.join(__dirname,'../donors/landscaping/donor.json'),m=JSON.parse(fs.readFileSync(p));m.bundle={tree_sha256:treeHash(files),files:hashes};fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({tree:m.bundle.tree_sha256,files:Object.keys(hashes)},null,2));