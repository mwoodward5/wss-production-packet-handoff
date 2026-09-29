'use strict';
const {parseServiceMarkdown}=require('../../../contracts/genie-packet.cjs');
function mapDonor({facts,services,files,manifest}){
 if(!facts||!['rv repair','rv-repair'].includes(String(facts.category).toLowerCase())|| !['rv repair','rv-repair'].includes(String(manifest?.category||manifest?.vertical).toLowerCase()))throw Error('rv_trade_mismatch');
 for(const k of ['name','city','state','phone','website'])if(typeof facts[k]!=='string'||!facts[k].trim())throw Error('rv_identity_missing:'+k);
 if(!services?.length)throw Error('rv_services_missing');
 for(const s of services){if(!s.file||!files[s.file])throw Error('rv_service_unbound');const p=parseServiceMarkdown(files[s.file],s.name);if(p.description!==s.description)throw Error('rv_service_copy_mismatch');}
 const home=parseServiceMarkdown(files['content/home.md']);
 const about=parseServiceMarkdown((files['content/about.md'] || files['content/home.md']));
 // Each headline segment is an exact certified identity/service string.
 return Object.freeze({heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.city+', '+facts.state,support:home.description},serviceIntro:home.description,about:about.description,whyHeadline:about.heading,values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports={mapDonor};
