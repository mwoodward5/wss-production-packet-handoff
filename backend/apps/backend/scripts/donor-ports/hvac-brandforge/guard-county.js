"use strict";
/* Guard every [COUNTY] phrase with the lane's [[NEED:]] markers.
 *
 * COUNTY is an OPTIONAL token: plenty of businesses have no verified county,
 * and hydrate.js fails a build CLOSED when a blank optional token is welded to
 * literal copy ("serving Nashville and the surrounding  area"). The markers
 * delete the whole clause instead, which is the only truthful option — the
 * sentence must read correctly with the county and without it.
 */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = "C:/Users/Main/Documents/Dark Signal/site-forge-lane/donors/brand-forge-express";

const EDITS = [
  ["src/components/sections/FAQ.tsx",
   `a: "[BUSINESS_NAME] serves [CITY], [ST] and the surrounding [COUNTY] area. If you're nearby`,
   `a: "[BUSINESS_NAME] serves [CITY], [ST][[NEED:COUNTY]] and the surrounding [COUNTY] area[[/NEED]]. If you're nearby`],

  ["src/components/sections/Footer.tsx",
   `              Residential heating and cooling for [CITY] and the surrounding
              [COUNTY] area.`,
   `              Residential heating and cooling for [CITY][[NEED:COUNTY]] and the
              surrounding [COUNTY] area[[/NEED]].`],

  ["src/components/sections/Gallery.tsx",
   `            text="Heating and cooling across [CITY] and [COUNTY]"`,
   `            text="Heating and cooling across [CITY][[NEED:COUNTY]] and [COUNTY][[/NEED]]"`],

  ["src/components/sections/Hero.tsx",
   `            [BUSINESS_NAME] is a residential HVAC contractor serving [CITY]
            and the surrounding [COUNTY] area — furnace and AC
            repair, new system installation, and vent service done right the
            first time.`,
   `            [BUSINESS_NAME] is a residential HVAC contractor serving [CITY][[NEED:COUNTY]]
            and the surrounding [COUNTY] area[[/NEED]] — furnace and AC
            repair, new system installation, and vent service done right the
            first time.`],

  ["src/components/sections/ServiceArea.tsx",
   `              text="Proudly serving [CITY] and the surrounding [COUNTY] area"`,
   `              text="Proudly serving [CITY][[NEED:COUNTY]] and the surrounding [COUNTY] area[[/NEED]]"`],

  ["src/components/sections/ServiceArea.tsx",
   `                [BUSINESS_NAME] is based in [CITY], [ST] and works with
                homeowners across the surrounding [COUNTY] area. If your town is
                nearby and you don't see it listed, ask — we may still be able
                to help.`,
   `                [BUSINESS_NAME] is based in [CITY], [ST] and works with
                homeowners[[NEED:COUNTY]] across the surrounding [COUNTY] area[[/NEED]]. If your
                town is nearby and you don't see it listed, ask — we may still
                be able to help.`],

  ["index.html",
   `content="[BUSINESS_NAME] provides residential furnace and AC repair, installation, and maintenance in [CITY], [ST] and the surrounding [COUNTY] area."`,
   `content="[BUSINESS_NAME] provides residential furnace and AC repair, installation, and maintenance in [CITY], [ST][[NEED:COUNTY]] and the surrounding [COUNTY] area[[/NEED]]."`],
];

for (const [rel, from, to] of EDITS) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`[${rel}] not found:\n${from}`);
  fs.writeFileSync(file, text.split(from).join(to));
  console.log("  · guarded:", rel);
}

// Nothing may reference COUNTY outside a marker.
for (const rel of [...new Set(EDITS.map((e) => e[0]))]) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const line of text.split("\n")) {
    if (!line.includes("[COUNTY]")) continue;
    const guarded = line.includes("[[NEED:COUNTY]]") || line.includes("[[/NEED]]");
    if (!guarded) throw new Error(`[${rel}] unguarded COUNTY line: ${line.trim()}`);
  }
}
console.log("\nall COUNTY references sit inside [[NEED:COUNTY]] spans");
