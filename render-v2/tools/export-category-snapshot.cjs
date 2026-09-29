const fs=require('fs');
const approved=require('/app/lib/copilot').APPROVED_CATEGORIES;
const routes=JSON.parse(fs.readFileSync('/app/data/donor-verticals.json'));
const installed=new Set(fs.readdirSync('/app/donors-clean',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name));
const rows=approved.map(c=>({category:c.name,aliases:c.aliases||[],donor:routes.canonical[c.name]||routes.aliases[c.name]||null,installed:!!((routes.canonical[c.name]||routes.aliases[c.name])&&installed.has(routes.canonical[c.name]||routes.aliases[c.name]))}));
console.log(JSON.stringify({captured_from:'live /app/lib/copilot.js + /app/data/donor-verticals.json',approved_count:rows.length,installed_route_count:rows.filter(x=>x.installed).length,rows},null,2));