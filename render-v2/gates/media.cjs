'use strict';
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function assertMedia(result){for(const e of result.media_evidence||[]){if(!e.originalBytes)continue;const key=String(e.path||'').replace(/^\/+/, '');const b=result.files[key];if(!b)throw Error('spa_media_output_missing:'+e.path);if(sha(b)!==e.sourceSha256)throw Error('spa_media_hash_mismatch:'+e.path);}return {ok:true,count:(result.media_evidence||[]).filter(x=>x.originalBytes).length};}
module.exports={assertMedia};
