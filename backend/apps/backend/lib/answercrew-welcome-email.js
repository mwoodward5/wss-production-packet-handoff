"use strict";
// AnswerCrew welcome email — sent once after the first successful checkout.
// Warm-paper brand: paper #f7f5ef, navy #17271d, green #23633a, gold #ffd05f.
const { sendResendEmail } = require("./email");

const START_URL = "https://getanswercrew.com/start";
const GUIDE_PDF_URL = "https://getanswercrew.com/answercrew-getting-started.pdf";
const COCKPIT_URL = "https://missioncontrol.wss-ai.com/login";

function firstName(name = "") {
  const n = String(name || "").trim().split(/\s+/)[0];
  return n && n.length > 1 ? n : "there";
}

function welcomeHtml({ ownerName = "", planName = "Solo" } = {}) {
  const hi = firstName(ownerName);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f7f5ef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ef"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
  <tr><td style="background:#17271d;border-radius:16px 16px 0 0;padding:36px 36px 30px;text-align:center">
    <div style="display:inline-block;width:52px;height:52px;background:#ffd05f;border-radius:14px;font:800 28px/52px Georgia,serif;color:#17271d">A</div>
    <div style="font:800 26px/1.3 Georgia,'Times New Roman',serif;color:#ffffff;padding-top:14px">Your crew just clocked in.</div>
    <div style="font:400 15px/1.5 Arial,sans-serif;color:#9fb8a7;padding-top:6px">Welcome to AnswerCrew, ${hi} — the ${planName} plan is live on your account.</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 36px 8px;border-left:1px solid #e6e2d6;border-right:1px solid #e6e2d6">
    <p style="margin:0 0 18px;font:15px/1.65 Arial,sans-serif;color:#303a33">From this moment, no call to your business has to go unanswered. Your AI team member answers, takes perfect notes, books the job, and texts the caller back — while you work.</p>
    <p style="margin:0 0 6px;font:700 13px/1.4 Arial,sans-serif;color:#8a8272;letter-spacing:.08em;text-transform:uppercase">Three steps and you're live</p>
  </td></tr>
  <tr><td style="background:#ffffff;padding:6px 36px;border-left:1px solid #e6e2d6;border-right:1px solid #e6e2d6">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td width="44" valign="top"><div style="width:32px;height:32px;background:#eef4ee;border-radius:50%;text-align:center;font:800 15px/32px Arial;color:#23633a">1</div></td>
      <td style="padding:2px 0 16px"><b style="font:700 15px Arial;color:#17271d">Tell us about your business</b><br><span style="font:14px/1.55 Arial;color:#5a6157">Name, hours, what you do. Five boxes, two minutes. Your crew learns it instantly.</span></td></tr>
      <tr><td width="44" valign="top"><div style="width:32px;height:32px;background:#eef4ee;border-radius:50%;text-align:center;font:800 15px/32px Arial;color:#23633a">2</div></td>
      <td style="padding:2px 0 16px"><b style="font:700 15px Arial;color:#17271d">Make a practice call</b><br><span style="font:14px/1.55 Arial;color:#5a6157">Call your own crew and hear them answer. Free, private, as many times as you like.</span></td></tr>
      <tr><td width="44" valign="top"><div style="width:32px;height:32px;background:#eef4ee;border-radius:50%;text-align:center;font:800 15px/32px Arial;color:#23633a">3</div></td>
      <td style="padding:2px 0 8px"><b style="font:700 15px Arial;color:#17271d">Flip the switch</b><br><span style="font:14px/1.55 Arial;color:#5a6157">Forward your line (we show you the exact buttons to press) and your crew is on duty 24/7.</span></td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#ffffff;padding:16px 36px 34px;text-align:center;border-left:1px solid #e6e2d6;border-right:1px solid #e6e2d6">
    <a href="${COCKPIT_URL}" style="display:inline-block;padding:15px 34px;background:#23633a;border-radius:10px;color:#ffffff;font:700 16px Arial,sans-serif;text-decoration:none">Open my crew &rarr;</a>
    <div style="padding-top:14px;font:13px/1.5 Arial,sans-serif;color:#8a8272">
      Prefer a guided tour? <a href="${START_URL}" style="color:#23633a;font-weight:700">Step-by-step guide</a> &middot; <a href="${GUIDE_PDF_URL}" style="color:#23633a;font-weight:700">Printable PDF</a>
    </div>
  </td></tr>
  <tr><td style="background:#fdfbf4;border:1px solid #e6e2d6;border-top:1px dashed #d8d2c0;padding:20px 36px">
    <p style="margin:0;font:14px/1.6 Arial,sans-serif;color:#5a6157"><b style="color:#17271d">A human is always here.</b> Reply to this email and a real person answers. No phone trees. No tickets. That would be ironic.</p>
  </td></tr>
  <tr><td style="padding:20px 36px;text-align:center;font:12px/1.6 Arial,sans-serif;color:#8a8272">
    AnswerCrew by WSS Labs &middot; a Woodward Software Systems company<br>655 S Main St, Suite 200, Orange, CA 92868<br>
    You're receiving this because you created an AnswerCrew account.
  </td></tr>
</table></td></tr></table></body></html>`;
}

function welcomeText({ ownerName = "", planName = "Solo" } = {}) {
  const hi = firstName(ownerName);
  return `Your crew just clocked in.

Welcome to AnswerCrew, ${hi} — the ${planName} plan is live.

Three steps and you're live:
1. Tell us about your business (five boxes, two minutes): ${COCKPIT_URL}
2. Make a practice call — hear your crew answer, free and private.
3. Flip the switch — forward your line and your crew is on duty 24/7.

Guided tour: ${START_URL}
Printable guide: ${GUIDE_PDF_URL}

A human is always here — just reply to this email.

AnswerCrew by WSS Labs · a Woodward Software Systems company
655 S Main St, Suite 200, Orange, CA 92868`;
}

async function sendAnswerCrewWelcomeEmail({ email, ownerName = "", planName = "Solo" } = {}) {
  if (!email) return { sent: false, reason: "no_recipient" };
  return sendResendEmail({
    senderKind: "transactional",
    to: email,
    subject: "Your crew just clocked in — here's how to go live in 10 minutes",
    html: welcomeHtml({ ownerName, planName }),
    text: welcomeText({ ownerName, planName }),
  });
}

module.exports = { sendAnswerCrewWelcomeEmail, welcomeHtml, welcomeText };
