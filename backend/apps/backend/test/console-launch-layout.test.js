"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../lib/console-page.js"),"utf8");
test("launch deck is bounded",()=>{assert.match(source,/\.launch\{display:grid;grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);assert.match(source,/\.launch-note\{grid-column:1\/-1;/);assert.doesNotMatch(source,/\.launch\{display:flex;gap:12px;flex-wrap:wrap/)});
test("launch deck stacks on phones",()=>{assert.match(source,/@media\(max-width:640px\)[\s\S]*\.launch #laneMode,\.launch #mineVertical,\.launch #mineLocation\{grid-column:1\/-1\}/);assert.match(source,/@media\(max-width:420px\)[\s\S]*\.launch \.launchBtn\{grid-column:1\/-1\}/)});
