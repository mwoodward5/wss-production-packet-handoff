"use strict";

// Caller resolution + collision safety for the voice site-edit loop.
//
// The failure this file exists to prevent: a caller is resolved to the WRONG
// business and their edit lands on a stranger's live site. That is silent,
// unrecoverable from the caller's side (they hear "done"), and was reachable on
// production data before this guard existed — measured 2026-07-31 against the
// live table, "United Roofing" and "California Landscape" each matched 4
// distinct businesses in 4 different cities, and the old code took ranked[0].
//
// Fixtures below are shaped exactly like the real rows they were copied from,
// including the "(NNN) NNN-NNNN" phone formatting that broke the old lookup.

const assert = require("node:assert/strict");
const test = require("node:test");

const TARGETS = "../lib/site-edit-targets";
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}

// Real Flint Plumbing row shape. prospect_id is NOT the slug — the slug lives
// in the preview_url host. That distinction is the whole reason siteSlugFromRow
// exists, so the fixture keeps them different on purpose.
const FLINT = {
  id: "c60bbc89-89a1-4d46-83d6-bcc05661edcb",
  prospect_id: "place-chij0-rnqpvnw4yrabvk8grzuyk",
  business_name: "Flint Plumbing LLC",
  phone: "(512) 971-2445",
  city: "Austin",
  state: "TX",
  preview_url: "https://wss-test-flint-plumbing-s5.wss-ai.com/",
  record: {},
};
const FLINT_CLIENT_ID = "WSS-F15219"; // derived sha256 of the prospect_id

const UNITED = ["LLC", "& Sheetmetal, Inc", "California", "& General Contractors"].map((suffix, i) => ({
  id: `u${i}`,
  prospect_id: `place-united-${i}`,
  business_name: `United Roofing ${suffix}`,
  phone: `(214) 555-01${String(i).padStart(2, "0")}`,
  city: ["Washington", "Bryan", "Sherman Oaks", "Dallas"][i],
  state: ["DC", "TX", "CA", "TX"][i],
  preview_url: `https://united-${i}.wss-ai.com/`,
  record: {},
}));

/**
 * Stand in for Supabase. Answers the PostgREST-ish queries resolveCaller emits
 * by filtering `rows` the same way the database would.
 */
function mockSupabase(rows) {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const q = decodeURIComponent(u);
    let out = rows;
    let m;
    if ((m = q.match(/prospect_id=eq\.([^&]+)/))) out = rows.filter((r) => r.prospect_id === m[1]);
    else if (/reference=eq\./.test(q)) out = []; // column is null in production
    else if ((m = q.match(/email=eq\.([^&]+)/))) out = rows.filter((r) => String(r.email || "").toLowerCase() === m[1].toLowerCase());
    else if ((m = q.match(/owner_email=eq\.([^&]+)/))) out = rows.filter((r) => String(r.owner_email || "").toLowerCase() === m[1].toLowerCase());
    else if ((m = q.match(/phone=ilike\.([^&]+)/))) {
      const rx = new RegExp(m[1].replace(/\*/g, ".*"), "i");
      out = rows.filter((r) => rx.test(String(r.phone || "")));
    } else if ((m = q.match(/business_name=ilike\.([^&]+)/))) {
      const rx = new RegExp(m[1].replace(/\*/g, ".*"), "i");
      out = rows.filter((r) => rx.test(String(r.business_name || "")));
    }
    if ((m = q.match(/offset=(\d+)/))) out = out.slice(Number(m[1]));
    if ((m = q.match(/limit=(\d+)/))) out = out.slice(0, Number(m[1]));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => out, text: async () => JSON.stringify(out) };
  };
  return calls;
}

function freshModule() {
  delete require.cache[require.resolve(TARGETS)];
  return require(TARGETS);
}

test("caller resolution + collision safety", async (t) => {
  t.after(() => { global.fetch = originalFetch; restoreEnv(); });

  await t.test("resolves by Client-ID to the right prospect_id, slug and preview_url", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ reference: FLINT_CLIENT_ID });
    assert.equal(who.status, "ok");
    assert.equal(who.matched_by, "client_id");
    assert.equal(who.business_name, "Flint Plumbing LLC");
    assert.equal(who.prospect_id, FLINT.prospect_id);
    assert.equal(who.site_slug, "wss-test-flint-plumbing-s5");
    assert.equal(who.preview_url, FLINT.preview_url);
  });

  await t.test("absorbs transcription noise in a spoken Client-ID", async () => {
    for (const spoken of ["W S S dash F 1 5 2 1 9", "wss f15219", "F15219", "  WSS-f15219  "]) {
      mockSupabase([FLINT, ...UNITED]);
      const { resolveCaller } = freshModule();
      const who = await resolveCaller({ reference: spoken });
      assert.equal(who.status, "ok", `"${spoken}" should resolve`);
      assert.equal(who.prospect_id, FLINT.prospect_id);
    }
  });

  await t.test("resolves by phone REGARDLESS of stored formatting", async () => {
    // Regression: the old query was phone=ilike.*<last 7 digits>*, but every
    // stored phone is "(NNN) NNN-NNNN" — the 7-digit run spans the hyphen, so
    // it matched 0 of 930 production rows. The phone path never worked at all.
    for (const spoken of ["(512) 971-2445", "5129712445", "+15129712445", "512-971-2445", "1 (512) 971 2445"]) {
      mockSupabase([FLINT, ...UNITED]);
      const { resolveCaller } = freshModule();
      const who = await resolveCaller({ phone: spoken });
      assert.equal(who.status, "ok", `"${spoken}" should resolve`);
      assert.equal(who.matched_by, "phone");
      assert.equal(who.prospect_id, FLINT.prospect_id);
      assert.equal(who.site_slug, "wss-test-flint-plumbing-s5");
    }
  });

  await t.test("AMBIGUOUS name reads back candidates instead of picking one", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ businessName: "United Roofing" });
    assert.equal(who.status, "ambiguous", "4 matching businesses must never resolve to one");
    assert.equal(who.candidates.length, 4);
    assert.ok(/which one is yours/i.test(who.say), "must ask, not assert");
    assert.ok(/client id/i.test(who.say), "must steer to the unambiguous identifier");
    // A caller who has not proven which business is theirs gets no client data.
    assert.equal(who.prospect_id, undefined);
    for (const c of who.candidates) {
      assert.equal(c.preview_url, undefined, "no preview_url before identity is proven");
      assert.ok(c.client_id, "each option needs a Client ID to disambiguate with");
    }
  });

  await t.test("a colliding PHONE is ambiguous too, not first-wins", async () => {
    const twins = [
      { ...FLINT, id: "t1", prospect_id: "place-twin-1", business_name: "Twin A" },
      { ...FLINT, id: "t2", prospect_id: "place-twin-2", business_name: "Twin B" },
    ];
    mockSupabase(twins);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ phone: "(512) 971-2445" });
    assert.equal(who.status, "ambiguous");
    assert.equal(who.candidates.length, 2);
  });

  await t.test("disambiguating with a Client-ID after the read-back resolves cleanly", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();
    const amb = await resolveCaller({ businessName: "United Roofing" });
    assert.equal(amb.status, "ambiguous");
    const chosen = amb.candidates[2];
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller: again } = freshModule();
    const who = await again({ reference: chosen.client_id });
    assert.equal(who.status, "ok");
    assert.equal(who.business_name, chosen.business_name);
  });

  await t.test("an unknown caller is not_found, never a nearest guess", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ businessName: "Zzyzx Aerospace", phone: "(999) 000-1111" });
    assert.equal(who.status, "not_found");
    assert.equal(who.prospect_id, undefined);
  });

  await t.test("a lookup failure fails CLOSED", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    global.fetch = async () => { throw new Error("network down"); };
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ reference: FLINT_CLIENT_ID });
    assert.equal(who.status, "not_found");
    assert.equal(who.prospect_id, undefined);
  });

  await t.test("the derived-Client-ID scan pages past the first 1000 rows", async () => {
    // Regression: the scan read one 1000-row page against a 1103-row table, so
    // the 103 oldest clients could never be resolved by the Client ID printed
    // on their own outreach email.
    const filler = Array.from({ length: 1100 }, (_, i) => ({
      id: `f${i}`, prospect_id: `place-filler-${i}`, business_name: `Filler ${i}`,
      phone: `(555) 000-${String(i).padStart(4, "0")}`, record: {},
    }));
    mockSupabase([...filler, FLINT]); // Flint sits at index 1100, past page one
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ reference: FLINT_CLIENT_ID });
    assert.equal(who.status, "ok", "a client past row 1000 must still resolve");
    assert.equal(who.prospect_id, FLINT.prospect_id);
  });

  await t.test("siteSlugFromPreviewUrl only trusts ghost-owned hosts", async () => {
    const { siteSlugFromPreviewUrl } = freshModule();
    assert.equal(siteSlugFromPreviewUrl("https://wss-test-flint-plumbing-s5.wss-ai.com/"), "wss-test-flint-plumbing-s5");
    // SiteForge's multi-tenant app is not a ghost-owned deploy target, so it
    // must not yield a slug that looks redeployable.
    assert.equal(siteSlugFromPreviewUrl("https://siteforge-app-seven.vercel.app/try/flint/"), "");
    assert.equal(siteSlugFromPreviewUrl("https://evil.com/wss-ai.com/"), "");
    assert.equal(siteSlugFromPreviewUrl(""), "");
  });

  await t.test("resolveSiteEditTargetForCaller withholds a target unless identity is unique", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveSiteEditTargetForCaller } = freshModule();
    const amb = await resolveSiteEditTargetForCaller({ businessName: "United Roofing" });
    assert.equal(amb.status, "ambiguous");
    assert.equal(amb.target, null, "an ambiguous caller must never get a deploy target");
  });
});

// ===========================================================================
// THE MULTI-STRATEGY RESOLVER — the 2026-08-17 hardening
// ===========================================================================
// Field log: two callers were lost to "could not locate account". The ladder
// gained an email rung and a city tiebreak, and the total miss stopped being a
// dead end — it now asks for the ONE strongest identifier the caller has not
// given yet, and the question is the sentence Riley speaks.
test("the ladder: email, city, and the ask-instead-of-dead-end", async (t) => {
  t.after(() => { global.fetch = originalFetch; restoreEnv(); });

  await t.test("resolves by EMAIL — the address the report went to", async () => {
    const withEmail = { ...FLINT, email: "owner@flintplumbing.example" };
    mockSupabase([withEmail, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ email: "Owner@FlintPlumbing.example" });
    assert.equal(who.status, "ok", JSON.stringify(who).slice(0, 200));
    assert.equal(who.matched_by, "email");
    assert.equal(who.prospect_id, FLINT.prospect_id);
  });

  await t.test("an email stored only inside record still resolves — the scan rung", async () => {
    const rec = { ...FLINT, id: "r1", email: "", owner_email: "", record: { email: "records.only@flintplumbing.example" } };
    mockSupabase([rec, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ email: "records.only@flintplumbing.example" });
    assert.equal(who.status, "ok");
    assert.equal(who.matched_by, "email");
  });

  await t.test("a colliding email is ambiguous, not first-wins", async () => {
    const twins = [
      { ...FLINT, id: "e1", prospect_id: "place-email-1", business_name: "Email Twin A", email: "shared@example.com" },
      { ...FLINT, id: "e2", prospect_id: "place-email-2", business_name: "Email Twin B", email: "shared@example.com" },
    ];
    mockSupabase(twins);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ email: "shared@example.com" });
    assert.equal(who.status, "ambiguous");
    assert.equal(who.candidates.length, 2);
  });

  await t.test("CITY disambiguates the name tie: 'the Dallas one' resolves", async () => {
    mockSupabase([FLINT, ...UNITED]); // 4 United Roofings in 4 cities, 2 in TX
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ businessName: "United Roofing", city: "Washington" });
    assert.equal(who.status, "ok", JSON.stringify(who).slice(0, 200));
    assert.equal(who.matched_by, "business_name+city");
    assert.equal(who.city, "Washington");
    // The OTHER Washington-united business is Sherman Oaks/Dallas/Bryan — only
    // one row carries the city, so the tie is broken by a fact, not a pick.
  });

  await t.test("a city that matches SEVERAL of the tied rows is still ambiguous", async () => {
    mockSupabase([FLINT, ...UNITED]); // Dallas TX and Bryan TX are different cities,
    // but two rows share TX — prove the principle with a shared city:
    // Different phones on purpose: same name + same phone is one business the
    // harvester wrote twice, and collapseSameBusiness() correctly folds it —
    // this test is about TWO businesses the city cannot tell apart.
    const sameCity = [
      { ...FLINT, id: "c1", prospect_id: "place-city-1", business_name: "Capital Roofing", phone: "(512) 555-0101", city: "Austin", state: "TX" },
      { ...FLINT, id: "c2", prospect_id: "place-city-2", business_name: "Capital Roofing", phone: "(512) 555-0102", city: "Austin", state: "TX" },
    ];
    mockSupabase(sameCity);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ businessName: "Capital Roofing", city: "Austin" });
    assert.equal(who.status, "ambiguous", "a city that cannot break the tie must not resolve it");
    assert.equal(who.candidates.length, 2);
  });

  await t.test("no city given: the name tie still reads back — city is a bonus, not a new guess", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();
    const who = await resolveCaller({ businessName: "United Roofing" });
    assert.equal(who.status, "ambiguous");
  });

  await t.test("unmatched ASKS for the strongest key not yet tried — never dead-ends", async () => {
    mockSupabase([FLINT, ...UNITED]);
    const { resolveCaller } = freshModule();

    // Only a name was given and it missed: the ask is the Client ID.
    const byName = await resolveCaller({ businessName: "Zzyzx Aerospace" });
    assert.equal(byName.status, "not_found");
    assert.equal(byName.unmatched.ask_for, "client_id");
    assert.match(byName.say, /client id/i);
    assert.match(byName.say, /W S S/);
    assert.deepEqual(byName.unmatched.tried, ["business_name"]);

    // A name AND a Client-ID both missed: the ask moves down the ladder to the
    // phone — the field log's exact lost-call shape.
    const byNameAndCode = await resolveCaller({ businessName: "Zzyzx Aerospace", reference: "WSS-000000" });
    assert.equal(byNameAndCode.unmatched.ask_for, "phone");
    assert.match(byNameAndCode.say, /phone number printed on your website/i);

    // Name + ID + phone all missed: ask for the email.
    const plusPhone = await resolveCaller({ businessName: "Zzyzx Aerospace", reference: "WSS-000000", phone: "(999) 000-1111" });
    assert.equal(plusPhone.unmatched.ask_for, "email");
    assert.match(plusPhone.say, /email address your report went to/i);

    // Everything given and still nothing: an honest handoff, no more questions.
    const everything = await resolveCaller({
      businessName: "Zzyzx Aerospace", reference: "WSS-000000", phone: "(999) 000-1111", email: "nobody@nowhere.example",
    });
    assert.equal(everything.unmatched.ask_for, null);
    assert.match(everything.say, /not going to guess/i);
    assert.ok(/team/i.test(everything.say), "ends with a person, not a shrug");
  });
});
