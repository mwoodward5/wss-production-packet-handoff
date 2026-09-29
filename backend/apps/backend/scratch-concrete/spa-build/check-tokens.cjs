// Dev-only checker: flag {{TOKEN}} occurrences that sit OUTSIDE string
// literals on a line (i.e. JSX text / expression position -> bare identifier
// in the compiled bundle -> SSR ReferenceError + scanbare hit).
const fs = require("fs");
const path = require("path");

function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name === "ui") continue;
      out = out.concat(walk(p));
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

let bad = 0;
for (const f of walk("src")) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Char-by-char string stripping with escape handling (single/double/backtick).
    let s = "";
    let q = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (q) {
        if (ch === "\\") { j++; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { q = ch; continue; }
      s += ch;
    }
    const m = s.match(/\{\{[A-Z_]+\}\}/g);
    if (m) { bad++; console.log(`${f}:${i + 1} -> ${m.join(",")}`); }
  });
}
console.log(bad === 0 ? "CLEAN" : "ISSUES=" + bad);
