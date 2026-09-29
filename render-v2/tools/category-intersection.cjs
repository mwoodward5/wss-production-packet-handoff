const fs=require('fs');
const approved=require('/app/lib/copilot').APPROVED_CATEGORIES;
const routes=JSON.parse(fs.readFileSync('/app/data/donor-verticals.json'));
const installed=new Set(fs.readdirSync('/app/donors-clean',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name));
const out=[];
for(const c of approved){
  const exact=routes.canonical[c.name]||routes.aliases[c.name]||null;
  out.push({name:c.name,donor:exact,installed:!!(exact&&installed.has(exact))});
}
console.log(JSON.stringify({total:out.length,installed:out.filter(x=>x.installed).length,rows:out},null,2));