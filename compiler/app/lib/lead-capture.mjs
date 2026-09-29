import path from "node:path";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

export function wireLeadCapture(siteDir, { project, publicUrl }) {
  if (!project?.id || !project?.lead_token || !siteDir) return { files: 0, forms: 0 };
  const base = String(publicUrl || "https://siteforge-app-seven.vercel.app").replace(/\/$/, "");
  const action = `${base}/api/leads/${encodeURIComponent(project.id)}`;
  let files = 0;
  let forms = 0;
  for (const file of htmlFiles(siteDir)) {
    const html = readFileSync(file, "utf8");
    let changed = 0;
    const next = html.replace(/<form\s+class="quote-form"\s+action="mailto:[^"]*"\s+method="get"([^>]*)>/gi, (_, tail) => {
      changed += 1;
      return `<form class="quote-form" action="${escapeAttr(action)}" method="post"${tail}><input type="hidden" name="lead_token" value="${escapeAttr(project.lead_token)}"><input type="text" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">`;
    });
    if (changed) {
      writeFileSync(file, next);
      files += 1;
      forms += changed;
    }
  }
  return { files, forms };
}

function htmlFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (path.extname(name).toLowerCase() === ".html") files.push(file);
    }
  };
  walk(root);
  return files;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
