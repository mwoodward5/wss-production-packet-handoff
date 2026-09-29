const {execFileSync}=require('node:child_process');
const q="SELECT record->'genie_canonical_packet',record->'photo_bank',record->'media_bank',record->'brand_truth',record->'site_palette',record->'truth_packet' FROM ghost_agency_prospects WHERE prospect_id='lm-5fc8274e4324bff121368303b318bd9a7f22f466';";
const raw=execFileSync('docker',['exec','wss-local-db','psql','-X','-U','postgres','-d','postgres','-t','-A','-F','\t','-c',q],{encoding:'utf8',maxBuffer:100*1024*1024}).trim();
const cols=raw.split('\t').map(x=>x?JSON.parse(x):null);
const [g,photo,media,brand,palette,truth]=cols;
function shape(x,d=0){if(d>3)return Array.isArray(x)?'array('+x.length+')':typeof x;if(Array.isArray(x))return {type:'array',length:x.length,sample:x.slice(0,2).map(v=>shape(v,d+1))};if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,shape(v,d+1)]));return x;}
const out={genie:shape(g),photo_bank:shape(photo),media_bank:shape(media),brand_truth:shape(brand),site_palette:palette,truth_packet:shape(truth)};
require('fs').writeFileSync('C:/Users/Main/ZCodeProject/wss-render-v2/evidence/burns-packet-shape.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2).slice(0,50000));
