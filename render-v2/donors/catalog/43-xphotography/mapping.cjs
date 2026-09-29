'use strict';
function copy(files,key){const raw=files?.[key];if(typeof raw!=='string'||!raw.trim())throw new Error('certified_copy_missing:'+key);return raw.replace(/\r\n/g,'\n').trim().split('\n').slice(1).join('\n').trim();}
function mapDonor({facts,services,files,manifest}){
 if(!facts||!['photographer','photography','professional photography'].includes(String(facts.category).trim().toLowerCase())||manifest?.category!=='photographer')throw new Error('photographer_category_mismatch');
 for(const key of ['name','city','state','phone','website'])if(typeof facts[key]!=='string'||!facts[key].trim())throw new Error('identity_required:'+key);
 if(!Array.isArray(services)||!services.length)throw new Error('services_required');
 for(const s of services){
  if(!s||typeof s.name!=='string'||!s.name.trim()||typeof s.file!=='string'||!s.file.startsWith('content/services/')||typeof s.description!=='string'||s.description.length<20)throw new Error('service_copy_required');
  if(!/photograph|portrait|headshot|videograph/i.test(s.name)||/landscap|plumb|roof|electrician|hvac|dentist|massage|cleaning/i.test(s.name))throw new Error('photographer_trade_required');
  const body=copy(files,s.file).split(/\n\n+/)[0].trim();
  const heading=files[s.file].replace(/\r\n/g,'\n').trim().split('\n')[0].replace(/^#+\s*/,'').trim();
  if(body!==s.description||heading.toLowerCase()!==s.name.trim().toLowerCase())throw new Error('service_copy_unbound');
  if(s.name.length>48||s.description.length>1800)throw new Error('service_copy_length');
 }
 const home=copy(files,'content/home.md').split(/\n\n+/)[0];const about=copy(files,'content/about.md');
 if(home.length<20||home.length>800||about.length<20||about.length>2400||facts.name.length>80||services[0].name.length>80||(facts.city+', '+facts.state).length>80)throw new Error('certified_copy_length');
 // The three headline lines are certified identity/taxonomy, not invented marketing claims.
 return {heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+', '+facts.state,eyebrow:facts.name,support:home},serviceIntro:home,about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))};
}
module.exports={mapDonor};
