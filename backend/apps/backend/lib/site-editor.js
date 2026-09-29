"use strict";
// lib/site-editor.js — applies a natural-language edit instruction to a site
// whose source files are archived in the Supabase "wss-site-sources" bucket,
// then redeploys via the forge Vercel deployer. Only text files (html/js/css)
// are eligible for editing; binaries pass through untouched.

const { vercelDeploy } = require("./forge");

const BUCKET = "wss-site-sources";
const TEXT_EXT = /\.(html?|css|js|json|svg|txt|xml)$/i;

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return { url, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

async function listAll(prefix, sub = "") {
  const { url, headers } = sb();
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: sub ? `${prefix}/${sub}` : prefix, limit: 1000 }),
  });
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`storage list failed: ${JSON.stringify(rows)}`);
  const files = [];
  for (const row of rows) {
    const rel = sub ? `${sub}/${row.name}` : row.name;
    if (row.id === null) {
      files.push(...(await listAll(prefix, rel)));
    } else {
      files.push(rel);
    }
  }
  return files;
}

async function download(prefix, rel) {
  const { url, headers } = sb();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${prefix}/${rel}`, { headers });
  if (!res.ok) throw new Error(`download failed ${rel}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(prefix, rel, buf, contentType) {
  const { url, headers } = sb();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${prefix}/${rel}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload failed ${rel}: ${res.status}`);
}

function editorPrompt(instruction, fileBlocks) {
  return `You are a precise website editor. Apply this customer request to the site files below:\n\nREQUEST: ${instruction}\n\nRules:\n- Change ONLY what the request requires. Do not restyle, reformat, or "improve" anything else.\n- The site is a compiled SPA; page content lives in JS bundles you cannot see. Achieve visual changes (sizes, colors, spacing) by adding a clearly-commented <style> override block in index.html targeting the right selectors. New pages should be standalone HTML files.\n- Never invent business facts, reviews, credentials, or contact info.\n- If the request requires a new page, create it matching the site's existing style, and link it from the nav if one exists.\n- Return EVERY file you changed or created, in full, wrapped exactly as <file path="...">...</file>. Return nothing else. If the request cannot be done safely, return <error>reason</error>.\n\n${fileBlocks}`;
}

function parseEditorOutput(text) {
  const err = text.match(/<error>([\s\S]*?)<\/error>/);
  if (err) throw new Error(`editor declined: ${err[1].trim()}`);
  const out = [];
  const re = /<file path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  let m;
  while ((m = re.exec(text))) out.push({ rel: m[1], text: m[2] });
  if (!out.length) throw new Error("editor returned no files");
  return out;
}

async function editWithGemini(instruction, fileBlocks) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: editorPrompt(instruction, fileBlocks) }] }],
      generationConfig: { maxOutputTokens: 16000 },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`gemini error: ${JSON.stringify(json).slice(0, 300)}`);
  const text = ((json.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return parseEditorOutput(text);
}

async function applyInstructionWithClaude(instruction, editableFiles) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fileBlocks = editableFiles
    .map(({ rel, text }) => `<file path="${rel}">\n${text}\n</file>`)
    .join("\n\n");
  if (!apiKey) return editWithGemini(instruction, fileBlocks);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: `You are a precise website editor. Apply this customer request to the site files below:\n\nREQUEST: ${instruction}\n\nRules:\n- Change ONLY what the request requires. Do not restyle, reformat, or "improve" anything else.\n- The site is a compiled SPA; page content lives in JS bundles you cannot see. Achieve visual changes (sizes, colors, spacing) by adding a clearly-commented <style> override block in index.html targeting the right selectors. New pages should be standalone HTML files.\n- Never invent business facts, reviews, credentials, or contact info.\n- If the request requires a new page, create it matching the site's existing style, and link it from the nav if one exists.\n- Return EVERY file you changed or created, in full, wrapped exactly as <file path="...">...</file>. Return nothing else. If the request cannot be done safely, return <error>reason</error>.\n\n${fileBlocks}`,
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    if (json?.error?.type === "authentication_error") return editWithGemini(instruction, fileBlocks);
    throw new Error(`anthropic error: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const text = (json.content || []).map((c) => c.text || "").join("");
  return parseEditorOutput(text);
}

/**
 * Run one edit job end to end. Returns { deployUrl, alias, changedFiles }.
 */
async function runSiteEdit({ siteSlug, instruction, projectName, aliasHost }) {
  const rels = await listAll(siteSlug);
  if (!rels.length) throw new Error(`no archived source for site '${siteSlug}'`);

  const files = {};
  const editable = [];
  for (const rel of rels) {
    const buf = await download(siteSlug, rel);
    files[rel] = buf;
    // Never hand minified bundles to the editor (assets/ = build output).
    // Shell files only; visual changes to bundled content are done via CSS
    // overrides injected into index.html.
    if (TEXT_EXT.test(rel) && buf.length < 200_000 && !rel.startsWith("assets/")) {
      editable.push({ rel, text: buf.toString("utf8") });
    }
  }

  const changed = await applyInstructionWithClaude(instruction, editable);
  for (const { rel, text } of changed) {
    files[rel] = Buffer.from(text, "utf8");
    await upload(siteSlug, rel, files[rel], rel.endsWith(".html") ? "text/html" : undefined);
  }

  const deployed = await vercelDeploy({ files, projectName, aliasHost });
  return { deployUrl: deployed.url, alias: deployed.alias, changedFiles: changed.map((c) => c.rel) };
}

module.exports = { runSiteEdit, listAll, download, upload };
