const { copyFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

mkdirSync(publicDir, { recursive: true });
copyFileSync(path.join(root, "index.html"), path.join(publicDir, "index.html"));
console.log("Prepared public/index.html for Vercel output.");
