"use strict";

function required(v,key){if(typeof v!=="string"||!v.trim())throw new Error("donor_required_"+key);return v.trim();}

function parse(markdown){const lines=required(markdown,"copy").replace(/\r\n/g,"\n").split("\n");return {heading:lines[0].replace(/^#+\s*/,""),body:lines.slice(1).join("\n").trim().split(/\n\n+/)[0]};}

function mapDonor({facts,services,files,manifest}={}){

 if(!facts||!manifest||facts.category!=="landscaping"||manifest.category!=="landscaping")throw new Error("donor_trade_mismatch");

 for(const key of ["name","city","state","website","phone"])required(facts[key],key);

 if(facts.services_source!=="source_bound"||!Array.isArray(services)||!services.length||!Array.isArray(facts.services))throw new Error("donor_services_required");

 if(services.length!==facts.services.length)throw new Error("donor_services_unbound");

 for(const service of services){

   if(!facts.services.includes(service.name)||!service.file?.startsWith("content/services/"))throw new Error("donor_service_unbound");

   const copy=parse(files?.[service.file]);

   if(copy.heading.toLowerCase()!==service.name.toLowerCase()||copy.body!==service.description||copy.body.length<20)throw new Error("donor_service_copy_unbound");

 }

 const home=parse(files?.["content/home.md"]);if(home.body.length<20)throw new Error("donor_home_copy_missing");

 const about=(files?.["content/about.md"] || files?.["content/home.md"])?parse((files["content/about.md"] || files["content/home.md"])).body:home.body;

 const contact=files?.["content/contact.md"]?parse(files["content/contact.md"]):null;

 return Object.freeze({

  heroText:{line1:facts.name,emphasis:services[0].name,line3:facts.city+", "+facts.state,eyebrow:facts.city+", "+facts.state,support:home.body},

  serviceIntro:home.body,about,whyHeadline:(files?.["content/about.md"] || files?.["content/home.md"])?parse((files["content/about.md"] || files["content/home.md"])).heading:"",values:[],seasonalNote:"",

  ctaHeadline:contact?.heading||"",ctaBody:contact?.body||"",

  serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))

 });

}

module.exports=Object.freeze({mapDonor});

