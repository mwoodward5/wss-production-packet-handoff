// SiteForge SaaS — auth: magic-link email + Google OAuth (when configured).
// Sessions are HMAC-signed HttpOnly cookies referencing a server session row.
import { insert, update, find, get, remove, userByEmail, audit, insert as ins } from "./store.mjs";
import { id, token, nowIso, hmacSign, hmacVerify, parseCookies, cookie, isEmail, rateLimit, ipOf, daysFromNow } from "./util.mjs";

const SECRET = process.env.SITEFORGE_SESSION_SECRET || bootSecret();
function bootSecret() {
  // Deterministic per data dir so dev sessions survive restarts without config.
  return `dev-only-${process.env.SITEFORGE_DATA_DIR || "local"}-siteforge`;
}

export const GOOGLE_ENABLED = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const RESEND_KEY = process.env.RESEND_API_KEY || "";
export const EMAIL_LIVE = Boolean(RESEND_KEY);

// ---------- sessions ----------
export function createSession(user, res) {
  const sess = insert("sessions", { id: id("sess"), user_id: user.id, expires_at: daysFromNow(30) });
  const signed = hmacSign(sess.id, SECRET);
  res.setHeader("Set-Cookie", [cookie("sf_session", signed), cookie("sf_csrf", token(16), { httpOnly: false })]);
  return sess;
}
export function currentUser(req) {
  const raw = parseCookies(req.headers.cookie || "").sf_session;
  if (!raw) return null;
  const sid = hmacVerify(raw, SECRET);
  if (!sid) return null;
  const sess = get("sessions", sid);
  if (!sess || sess.expires_at < nowIso()) return null;
  return get("users", sess.user_id);
}
export function logout(req, res) {
  const raw = parseCookies(req.headers.cookie || "").sf_session;
  const sid = raw ? hmacVerify(raw, SECRET) : null;
  if (sid) remove("sessions", sid);
  res.setHeader("Set-Cookie", cookie("sf_session", "", { maxAge: 0 }));
}
export function csrfOk(req, body) {
  const c = parseCookies(req.headers.cookie || "").sf_csrf;
  const sent = body?._csrf || req.headers["x-csrf-token"];
  return Boolean(c && sent && c === sent);
}
export function csrfOf(req) { return parseCookies(req.headers.cookie || "").sf_csrf || ""; }

// ---------- users ----------
export function findOrCreateUser(email, extra = {}) {
  const existing = userByEmail(email);
  if (existing) return existing;
  const user = insert("users", {
    id: id("user"), email: String(email).toLowerCase().trim(),
    name: extra.name || email.split("@")[0], avatar_url: extra.avatar_url || null,
    auth_provider: extra.provider || "email", plan: "free",
  });
  audit(user.id, "user.signup", user.id, { provider: user.auth_provider });
  return user;
}

// ---------- magic link ----------
export async function sendMagicLink(email, baseUrl, req) {
  if (!isEmail(email)) { const e = new Error("Enter a valid email address."); e.status = 400; throw e; }
  const rl = rateLimit(`magic:${ipOf(req)}`, { max: 8, windowMs: 3600_000 });
  if (!rl.ok) { const e = new Error("Too many sign-in attempts. Try again in an hour."); e.status = 429; throw e; }
  const t = token(24);
  insert("magic_tokens", { id: id("mgk"), email: String(email).toLowerCase().trim(), token: t, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), used: false });
  const link = `${baseUrl}/auth/verify?token=${t}`;
  const subject = "Your WSS Launch sign-in link";
  const bodyText = `Sign in to WSS Launch: ${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`;
  if (EMAIL_LIVE) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: process.env.SITEFORGE_EMAIL_FROM || "WSS Launch <login@siteforge.dev>", to: [email], subject, text: bodyText }),
    }).catch(() => { ins("dev_inbox", { to: email, subject, body: bodyText, note: "resend send failed — dev copy" }); });
  } else {
    ins("dev_inbox", { to: email, subject, body: bodyText, link, note: "email delivery not configured (set RESEND_API_KEY) — dev inbox copy" });
  }
  return { sent: true, dev: !EMAIL_LIVE };
}
export function verifyMagicToken(t) {
  const row = find("magic_tokens", (m) => m.token === t);
  if (!row || row.used || row.expires_at < nowIso()) return null;
  update("magic_tokens", row.id, { used: true });
  return findOrCreateUser(row.email, { provider: "email" });
}

// ---------- Google OAuth ----------
export function googleAuthUrl(baseUrl, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${baseUrl}/auth/google/callback`,
    response_type: "code", scope: "openid email profile", state, prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function googleCallback(code, baseUrl) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${baseUrl}/auth/google/callback`, grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error("Google token exchange failed");
  const { access_token } = await tokenRes.json();
  const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error("Google userinfo failed");
  const info = await infoRes.json();
  if (!info.email) throw new Error("Google account has no email");
  return findOrCreateUser(info.email, { provider: "google", name: info.name, avatar_url: info.picture });
}
