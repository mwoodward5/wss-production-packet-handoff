"use strict";

// lib/edit-clarify.js — the clarifying-question turn.
//
// Before Riley queues a website edit it now decides ONE thing: can this request
// be acted on as-is, or does it need one warm question first (like Lovable does)?
// A "build me a team page with everyone's photo" ask has nothing to build from
// until the owner provides the people — so Riley should ASK, with options, not
// queue a doomed edit that reports "didn't go through". A clear ask ("make the
// phone bigger", "add more blue") is actioned with no question.
//
// FAIL-OPEN, ALWAYS. Any model error, timeout, or unparseable reply returns
// { needsInput: false } so the edit path behaves exactly as it did before this
// file existed. This runs on the live customer edit path; it can slow a first
// turn by one fast Haiku call but it can never block or break an edit.

const { callModel } = require("./connect-ai-reply");

const SYSTEM = `You are Riley, WSS's friendly website assistant, talking to a small-business owner inside their dashboard. They just asked you to change their website. Decide ONE thing: can you act on this as-is, or should you ask ONE short question first so you do it right?

ASK a question (needsInput true) when the request needs content or assets you do not have — most importantly:
- A new PAGE or SECTION about PEOPLE (team, staff, "profiles for everyone", "meet the team") needs each person's NAME and PHOTO. You NEVER invent people or use stock faces, so you must get them from the owner.
- Adding or swapping a specific photo needs the actual photo (offer the upload button).
- A vague target ("make it pop", "move that up", "fix the top") needs to know which part.

Do NOT ask (needsInput false) when you can clearly act on their own site already: recolour, reword or resize existing text, restyle, reorder, change existing content, update hours, change a price. Bias toward acting; only ask when acting well is genuinely impossible without more from them.

When you ask, be warm, brief, and give concrete OPTIONS. Example for a team page: "Love this — a team page builds trust fast. To do it right I need your people. You can (1) type each person's name and I'll set up the layout, (2) tap Attach and upload a photo + name for each, or (3) I can make a clean team section from what's already on your site. Which works?"

Reply with ONLY a JSON object and nothing else: {"needsInput": true|false, "say": "<message to the owner, or empty string when needsInput is false>"}`;

// First complete brace-balanced object (string/escape aware), so a model that
// adds a stray note after the JSON does not defeat the parse.
function firstJsonObject(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/**
 * assessEditRequest({ message, businessName, hasAttachments }) ->
 *   { needsInput:true, say } | { needsInput:false }
 * Never throws; fails open to { needsInput:false }.
 */
async function assessEditRequest({
  message = "",
  businessName = "",
  hasAttachments = false,
  callModelImpl = callModel,
} = {}) {
  const text = String(message || "").trim();
  if (!text) return { needsInput: false };
  const user = `Business: ${businessName || "(unknown)"}\nThe owner ${hasAttachments ? "attached a file and " : ""}wrote:\n"${text.slice(0, 1200)}"`;
  let out;
  try {
    out = await callModelImpl({ system: SYSTEM, user });
  } catch {
    return { needsInput: false };
  }
  if (!out || out.ok !== true || !out.text) return { needsInput: false };
  const slice = firstJsonObject(out.text);
  if (!slice) return { needsInput: false };
  let parsed;
  try { parsed = JSON.parse(slice); } catch { return { needsInput: false }; }
  if (parsed && parsed.needsInput === true && typeof parsed.say === "string" && parsed.say.trim()) {
    return { needsInput: true, say: parsed.say.trim().slice(0, 900) };
  }
  return { needsInput: false };
}

module.exports = { assessEditRequest, firstJsonObject };
