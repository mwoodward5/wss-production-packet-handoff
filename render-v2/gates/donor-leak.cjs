'use strict';
const TERMS=Object.freeze(['Greenfront Lawn & Landscape','greenfrontbham@gmail.com','205-603-4987','Birmingham, AL','Meadowbrook','clienthub.getjobber.com']);
function normalizedTerms(terms){return [...new Set((Array.isArray(terms)&&terms.length?terms:TERMS).map(x=>String(x||'').trim()).filter(x=>x.length>=3))]}
function scan(files,terms=TERMS){
  const hits=[], needles=normalizedTerms(terms);
  for(const [p,b] of Object.entries(files||{})){
    if(!/\.(?:html|js|json|css)$/i.test(p)||!Buffer.isBuffer(b))continue;
    const s=b.toString('utf8').toLowerCase();
    for(const term of needles)if(s.includes(term.toLowerCase()))hits.push({path:p,term});
  }
  return {ok:hits.length===0,hits};
}
function assertClean(files,terms=TERMS){const r=scan(files,terms);if(!r.ok){const e=new Error('spa_donor_leak_detected');e.detail=r.hits;throw e;}return r}
module.exports=Object.freeze({TERMS,normalizedTerms,scan,assertClean});
