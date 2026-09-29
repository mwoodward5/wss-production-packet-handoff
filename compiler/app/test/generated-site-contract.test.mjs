import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { build } from "../../factory/pipeline/05-build-v8.mjs";
import { enforceBusinessTruth } from "../lib/business-truth.mjs";
import { blobRelativePath } from "../lib/blob-path.mjs";

test("blob routes resolve directory URLs to index documents",()=>{assert.equal(blobRelativePath("about/"),"about/index.html");assert.equal(blobRelativePath("services/fence-repair/"),"services/fence-repair/index.html");assert.equal(blobRelativePath("media/og.svg"),"media/og.svg")});

function fixture(name, category, city, state, services, contact = {}) {
  return enforceBusinessTruth({ slug:`qa-${name.toLowerCase().replace(/\W+/g,"-")}`, forge:{demo:true}, build_type:"multi-page", hero_family:category === "fencing" ? "atlas-grid-reveal" : "split-editorial-index", business:{name,category,city,state,...contact}, services, enrichment_sources:{ phone:contact.phone ? {value:contact.phone}:undefined, address:contact.address ? {value:contact.address}:undefined }, source_evidence:[{field:"category",value:category,confidence:.95}] });
}

for (const packet of [
  fixture("Red Clay Fencing","fencing","Moultrie","GA",["Fence installation","Fence repairs"]),
  fixture("Barriga Landscaping","landscaping","Sacramento","CA",[],{phone:"(916) 926-8639",address:"2805 Wah Ave, Sacramento, CA 95822"}),
]) test(`generated contract: ${packet.business.name}`, async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"siteforge-contract-"));
  try {
    await build(packet,{outDir:dir});
    const files=[]; const walk=(d)=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):e.name.endsWith(".html")&&files.push(p)}}; walk(dir);
    const home=new JSDOM(readFileSync(path.join(dir,"index.html"),"utf8"));
    assert.equal(home.window.document.querySelectorAll("[data-action-tile]").length,1);
    assert.equal(home.window.document.querySelectorAll('input[type="range"]').length,0);
    for(const file of files){const dom=new JSDOM(readFileSync(file,"utf8"));for(const a of dom.window.document.querySelectorAll("a[href]")){const href=a.getAttribute("href");if(!href||/^(?:#|https?:|tel:|mailto:|javascript:)/.test(href))continue;const target=path.resolve(path.dirname(file),href.split(/[?#]/)[0]);const resolved=path.extname(target)?target:path.join(target,"index.html");assert.equal(existsSync(resolved),true,`${path.relative(dir,file)} -> ${href}`)}}
    if(packet.business.phone){
      const html=home.serialize();
      assert.match(html,/tel:9169268639/);assert.match(html,/2805 Wah Ave/);
      assert.doesNotMatch(html,/Landscape design|Paver patios|flagstone|drip line|native planting|steel edging|core services|Licensed & local|written scopes|quote is the price|walkthrough before|costs nothing/i);
    }
  } finally {rmSync(dir,{recursive:true,force:true})}
});
