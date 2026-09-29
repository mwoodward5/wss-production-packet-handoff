 'use strict';
function paragraph(md) { return typeof md === 'string' ? md.replace(/\r\n/g,'\n').trim().replace(/^#{1,6}\s+[^\n]*\n+/, '').split(/\n\n+/)[0].trim() : ''; }
function mapDonor({facts,services,files,manifest}) {
 if(!facts || ['name','city','state','phone','website','category'].some(k=>!String(facts[k]||'').trim())) throw Error('roadside_identity_required');
 if(!/^(roadside(?: assistance| services)?|roadside-assistance|automotive|auto-repair|towing)$/i.test(facts.category)) throw Error('roadside_wrong_trade');
 if(!Array.isArray(services)||!services.length||!services.every(s=>s.name&&typeof s.description==='string'&&s.description.length>=20)) throw Error('roadside_services_required');
 if(!services.every(s=>/\b(?:roadside|(?:car |vehicle |automotive |european )?battery (?:replacement|jump|services?)|jump[ -]?starts?|flat tire|tire (?:change|assistance|repair)|tyre|vehicle lockout|car lockout|towing|fuel delivery|winch)\b/i.test(s.name) && !/solar|marine|lawn|boat|bicycle/i.test(s.name))) throw Error('roadside_wrong_trade');
 // Bind every service to its own certified visitor-copy file, never the home fallback.
 if(!services.every(s=>typeof s.file==='string' && /^content\/services\/[a-z0-9][a-z0-9_-]*\.md$/i.test(s.file) && Object.hasOwn(files || {},s.file) && paragraph(files[s.file])===s.description)) throw Error('roadside_service_copy_unbound');
 const home=paragraph(files?.['content/home.md']),about=paragraph(files?.['content/about.md']);
 if(home.length<20||about.length<20) throw Error('roadside_certified_copy_required');
 const serviceCopy=paragraph(files?.['content/services.md']);
 const first=services.find(s=>/battery.*replace|replace.*battery/i.test(s.name)) || services[0];
 return Object.freeze({heroText:{line1:facts.name,emphasis:first.name,line3:facts.city,eyebrow:facts.city+', '+facts.state,support:home},serviceIntro:serviceCopy || services.map(s=>s.name).join(' · '),about,whyHeadline:'',values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))});
}
module.exports=Object.freeze({mapDonor});
