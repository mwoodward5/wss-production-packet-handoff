"use strict";

// scripts/supabase-diagnose-and-migrate.js — H1-H6 probes, then the 7 migrations.
//
// Written because this machine has NO psql and no pg client in either repo, so
// the shell version of the apply script would have failed the moment the URI
// arrived. This uses a pg driver installed under the session scratchpad, so it
// adds no dependency to the repo.
//
//   SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<host>:6543/postgres' \
//     node apps/backend/scripts/supabase-diagnose-and-migrate.js            # probes only
//     node apps/backend/scripts/supabase-diagnose-and-migrate.js --apply    # probes + migrations
//
// Use the TRANSACTION POOLER (6543). At ~74% memory a direct 5432 connection
// costs a whole backend, which is the thing we are trying to measure.
//
// The probes are H1-H6 from docs/supabase-wal-memory-hypotheses.sql, in the
// order that decides "real defect vs undersized tier" fastest:
//   H1 wal_level/max_wal_size  -> is 576MB WAL simply configured retention?
//   H2 shared_buffers/work_mem -> is 74% memory just the tier's resident floor?
//   H3 pg_net response backlog -> THE one likely free fix
//   H4 extension bg workers    -> what the two observed workers actually do
//   H6 publications            -> explains WAL > DB size with ZERO slots
//
// Migrations run one file per transaction with ON_ERROR_STOP semantics: any
// failure rolls that file back and stops the run.

const fs = require("node:fs");
const path = require("node:path");

// Same env-file convention the outreach senders already use, so the pooler URI
// can live beside SUPABASE_URL / RESEND_API_KEY instead of being pasted into a
// chat transcript. A real process.env value always wins over the file.
const ENV_FILE = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PG = "C:/Users/Main/AppData/Local/Temp/claude/C--Users-Main-Documents-Dark-Signal/c5530dca-45ae-49de-a01c-2a6a99301c56/scratchpad/pgclient/node_modules/pg";
const SNAP = "C:/Users/Main/Documents/New project 2/_tmp_leadminer_credit_verify_20260729/supabase/migrations";
const MIGRATIONS = [
  "20260730190533_admin_grant_credits.sql",
  "20260730191008_website_intelligence.sql",
  "20260730191009_email_validation.sql",
  "20260730191010_outreach_draft_queue.sql",
  "20260730191011_mining_accounting_hardening.sql",
  "20260730191012_enrichment_claim_hardening.sql",
  "20260730191013_project_archive.sql",
];

const bar = (s) => console.log("\n" + s + "\n" + "-".repeat(Math.min(78, s.length + 20)));

async function q(client, sql, params = []) {
  try { return (await client.query(sql, params)).rows; }
  catch (e) { return { __error: String(e.message || e).split("\n")[0] }; }
}
const show = (rows, empty = "(no rows)") => {
  if (rows && rows.__error) return console.log("   probe unavailable: " + rows.__error);
  if (!rows || !rows.length) return console.log("   " + empty);
  for (const r of rows) {
    console.log("   " + Object.entries(r).map(([k, v]) => `${k}=${v === null ? "-" : v}`).join("  "));
  }
};

async function main() {
  const url = String(process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    console.error("SUPABASE_DB_URL not set.");
    console.error("Supabase -> Settings -> Database -> Connection string -> Transaction pooler (6543).");
    process.exit(2);
  }
  if (!/:6543\//.test(url)) {
    console.warn("WARNING: this does not look like the pooler (:6543). A direct 5432 connection");
    console.warn("costs a full backend on an instance already at ~74% memory.\n");
  }

  const { Client } = require(PG);
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: "wss-diagnose" });
  await client.connect();
  console.log("connected: " + url.replace(/:\/\/[^@]*@/, "://<redacted>@"));

  // ---------------- H1 ----------------
  bar("H1 — is the 576MB WAL configured retention, or a leak?");
  const h1 = await q(client, `SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('wal_level','max_wal_size','min_wal_size','checkpoint_timeout',
                   'checkpoint_completion_target','wal_keep_size','archive_mode','max_slot_wal_keep_size')
    ORDER BY name`);
  show(h1);
  if (Array.isArray(h1)) {
    const g = (n) => (h1.find((r) => r.name === n) || {}).setting;
    const maxWalMb = Number(g("max_wal_size")) || 0;   // reported in MB
    console.log(`\n   VERDICT: wal_level=${g("wal_level")} · max_wal_size=${maxWalMb}MB`);
    if (maxWalMb >= 512) {
      console.log("   -> 576MB of WAL is NORMAL retention between checkpoints. WAL is a RED HERRING.");
    } else {
      console.log("   -> max_wal_size is below the observed WAL; something else is pinning it.");
    }
    if (g("archive_mode") === "on") console.log("   -> archive_mode=on: a failing archive_command would block WAL recycling.");
    if (Number(g("wal_keep_size")) > 0) console.log(`   -> wal_keep_size=${g("wal_keep_size")}MB is retained deliberately.`);
  }

  // ---------------- H2 ----------------
  bar("H2 — is 74% memory just the tier's resident floor?");
  const h2 = await q(client, `SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('shared_buffers','work_mem','maintenance_work_mem','max_connections',
                   'effective_cache_size','autovacuum_work_mem','max_parallel_workers') ORDER BY name`);
  show(h2);
  if (Array.isArray(h2)) {
    const g = (n) => Number((h2.find((r) => r.name === n) || {}).setting) || 0;
    const sbMb = Math.round((g("shared_buffers") * 8) / 1024);      // 8kB blocks
    const wmMb = Math.round(g("work_mem") / 1024);
    console.log(`\n   shared_buffers ~${sbMb}MB · work_mem ~${wmMb}MB · max_connections ${g("max_connections")}`);
    console.log(`   worst-case sort/hash footprint: ~${Math.round((g("max_connections") * wmMb) / 1024 * 10) / 10}GB on top of shared_buffers`);
    if (wmMb >= 16) console.log("   -> work_mem is high for a 2GB box. ALTER SYSTEM SET work_mem='2MB' is free.");
    else console.log("   -> work_mem is sane; memory is dominated by shared_buffers = the tier's floor.");
  }

  // ---------------- H3 ----------------
  bar("H3 — pg_net response backlog (the one likely FREE fix)");
  const h3 = await q(client, `SELECT count(*)::bigint AS rows,
      pg_size_pretty(pg_total_relation_size('net._http_response')) AS size,
      min(created) AS oldest, max(created) AS newest FROM net._http_response`);
  show(h3, "(net._http_response absent — pg_net not storing responses)");
  if (Array.isArray(h3) && h3[0] && Number(h3[0].rows) > 5000) {
    console.log("\n   -> BACKLOG CONFIRMED. Free fix:");
    console.log("      DELETE FROM net._http_response WHERE created < now() - interval '1 day';");
    console.log("      VACUUM FULL net._http_response;");
  } else if (Array.isArray(h3) && h3[0]) {
    console.log("\n   -> no meaningful backlog. H3 ruled out.");
  }

  // ---------------- H4 ----------------
  bar("H4 — what the two Extension background workers are doing");
  show(await q(client, `SELECT extname, extversion FROM pg_extension ORDER BY extname`));
  console.log("");
  show(await q(client, `SELECT pid, backend_type, application_name, state, wait_event_type, wait_event,
      date_trunc('second', now()-backend_start)::text AS up_for
    FROM pg_stat_activity WHERE backend_type <> 'client backend' ORDER BY backend_start`));

  // ---------------- H6 ----------------
  bar("H6 — publications (explains WAL > DB size with ZERO slots)");
  const h6 = await q(client, `SELECT p.pubname, p.puballtables, count(pr.prrelid)::int AS explicit_tables
    FROM pg_publication p LEFT JOIN pg_publication_rel pr ON pr.prpubid=p.oid
    GROUP BY p.pubname, p.puballtables ORDER BY p.pubname`);
  show(h6, "(no publications)");
  if (Array.isArray(h6) && h6.some((r) => r.puballtables === true)) {
    console.log("\n   -> a puballtables publication WAL-logs every write to every table for logical");
    console.log("      decoding. Free fix: ALTER PUBLICATION <name> DROP TABLE <noisy_table>;");
  }

  // ---------------- migrations ----------------
  if (process.argv.includes("--apply")) {
    bar("APPLYING 7 ADDITIVE MIGRATIONS");
    for (const m of MIGRATIONS) {
      const file = path.join(SNAP, m);
      if (!fs.existsSync(file)) { console.error(`  MISSING ${m}`); process.exit(3); }
      const sql = fs.readFileSync(file, "utf8");
      if (/\bdrop\s+(table|column|database|schema)\b/i.test(sql)) {
        console.error(`  REFUSING ${m}: contains a destructive DROP`); process.exit(4);
      }
      process.stdout.write(`  ${m} ... `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log("applied");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.log("FAILED — rolled back");
        console.error(`     ${String(e.message || e).split("\n")[0]}`);
        process.exit(5);
      }
    }
    bar("SENDING LOCK — must still be present");
    show(await q(client, `SELECT conname FROM pg_constraint
      WHERE conrelid='public.outreach_draft_queue'::regclass
        AND conname IN ('outreach_draft_queue_status_draft_only',
                        'outreach_draft_queue_sending_always_paused',
                        'outreach_draft_queue_never_sent') ORDER BY conname`),
      "NONE FOUND — sending lock missing, investigate before anything else");
    show(await q(client, `SELECT count(*)::int AS queued,
        count(*) FILTER (WHERE sending_paused)::int AS paused,
        coalesce(sum(sent_count),0)::int AS total_sent FROM public.outreach_draft_queue`));
  } else {
    console.log("\n(probes only — pass --apply to run the 7 migrations)");
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
