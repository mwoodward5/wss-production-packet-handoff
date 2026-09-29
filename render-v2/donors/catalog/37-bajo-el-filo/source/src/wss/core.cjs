'use strict';
const {normalize}=require('../../../WSS-CONTRACTS/contracts/client-site-data.cjs');
function slug(s){return s.normalize('NFKD').replace(/[^\w\s-]/g,'').trim().toLowerCase().replace(/[\s_-]+/g,'-');}
function validatePlan(plan){
 if(plan===undefined)return undefined;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 if(!object(plan)||plan.schema!=='wss-rich-site-plan-v1')throw Error('site_plan_schema_invalid');
 if(plan.services!==undefined&&(!Array.isArray(plan.services)||plan.services.some(s=>!object(s)||typeof s.name!=='string'||typeof s.slug!=='string'||(s.longDescMd!==undefined&&typeof s.longDescMd!=='string'))))throw Error('site_plan_services_invalid');
 if(plan.content!==undefined&&(!object(plan.content)||Object.values(plan.content).some(v=>typeof v!=='string')))throw Error('site_plan_content_invalid');
 return plan;
}
function validate(raw,plan){
 const c=normalize(raw);
 validatePlan(plan);
 // CSD v2 omits category. Conservative service evidence gate complements mapDonor's exact category gate.
 if(!c.services.some(s=>/\b(martial arts|karate|judo|jiu[- ]?jitsu|taekwondo|aikido|kenjutsu|kali|sambo|fencing|boxing|combat|kung fu|hema)\b/i.test(s.name)))throw Error('martial_arts_evidence_required');
 const slugs=c.services.map(s=>s.href?s.href.slice(1):slug(s.name));
 if(slugs.some(s=>!s)||new Set(slugs).size!==slugs.length)throw Error('service_slug_invalid');
 if(slugs.some(s=>!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)))throw Error('service_slug_invalid');
 if(slugs.some(s=>['training','seminars','arts','media','contact'].includes(s)))throw Error('service_route_reserved');
 if(!/\.(png|jpe?g|webp|avif|gif)$/i.test(c.hero.poster))throw Error('hero_poster_image_required');
 if(c.identity.email&&!/^[a-z0-9.!$&'*+\/=_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(c.identity.email))throw Error('contact_email_invalid');
 if(c.trust.hours?.text!==undefined&&typeof c.trust.hours.text!=='string')throw Error('hours_text_invalid');
 return c;
}
function theme(c){return c.design.paletteSource!=='donor-default'&&!/fallback/i.test(c.design.paletteSource)&&/^#[\da-f]{6}$/i.test(c.design.accent)?{'--edge':c.design.accent}:{};}
module.exports={validate,validatePlan,slug,theme};
