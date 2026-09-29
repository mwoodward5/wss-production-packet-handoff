"use strict";

// Preserve the proven approval/send machinery while removing the historical
// campaign graveyard from the operator product. This view is now Outreach:
// current building work + work actually ready for review, nothing older.
const base = require("./campaigns-page");
const swaps = [
  [
    'function olderBatches(){return state.batches.filter(function(b){return !isReady(b)&&!isBuilding(b);});}',
    'function olderBatches(){return [];}',
  ],
  [
    'if(t.toLowerCase()==="leadminer")return "Researched leads";',
    'if(t.toLowerCase()==="leadminer")return (Number(b&&b.requested)||0?Number(b.requested)+"-Site ":"")+"Local Growth Sprint";',
  ],
];
let page = base;
for (const [from, to] of swaps) {
  if (!page.includes(from)) throw new Error("outreach_page_contract_missing");
  page = page.replace(from, to);
}
page = page
  .replace(/Your campaigns/g, "Outreach")
  .replace(/The Campaigns page/g, "The Outreach page");
module.exports = page;
