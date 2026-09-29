'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const originalResolve=Module._resolveFilename, originalLoad=Module._load;
const candidates=new Map([
  ['/app/lib/renderer-contract.js','/tmp/wss-v2-int/lib/renderer-contract.js'],
  ['/app/lib/line-adapters.js','/tmp/wss-v2-int/lib/line-adapters.js'],
  ['/app/lib/line-persisted-mirror.js','/tmp/wss-v2-int/lib/line-persisted-mirror.js'],
  ['/app/lib/owner-proof-delivery.js','/tmp/wss-v2-int/lib/owner-proof-delivery.js'],
]);
Module._resolveFilename=function(request,parent,isMain,options){
  if(request==='./renderer-contract' && parent?.filename?.startsWith('/app/lib/')) return '/app/lib/renderer-contract.js';
  return originalResolve.call(this,request,parent,isMain,options);
};
Module._load=function(request,parent,isMain){
  const resolved=Module._resolveFilename(request,parent,isMain);
  const file=candidates.get(resolved);
  if(!file) return originalLoad.call(this,request,parent,isMain);
  if(require.cache[resolved]) return require.cache[resolved].exports;
  const mod=new Module(resolved,parent);require.cache[resolved]=mod;
  mod.filename=resolved;mod.paths=Module._nodeModulePaths(path.dirname(resolved));
  mod._compile(fs.readFileSync(file,'utf8'),resolved);
  return mod.exports;
};
