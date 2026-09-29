"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  ENV_FILE_VARIABLE,
  SCHEMA_FILE,
  TABLE,
  SEQUENCE,
  PRODUCERS,
  STATUSES,
  EXPECTED_COLUMNS,
  SchemaSafetyError,
  assertSafeSql,
  loadSecureConfig,
  parseEnvText,
  publicErrorLine,
  runCli,
  runDatabaseAction,
  validateProjectBinding,
  verifySchema,
} = require("../scripts/apply-hero-reel-schema");

const PROJECT_REF = "abcdefghijklmnopqrst";
const API_URL = `https://${PROJECT_REF}.supabase.co`;
const DIRECT_URL = `postgresql://postgres:super-secret@db.${PROJECT_REF}.supabase.co:5432/postgres`;
const POOLER_URL = `postgresql://postgres.${PROJECT_REF}:super-secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
const SCHEMA_SQL = fs.readFileSync(SCHEMA_FILE, "utf8");
const ADDITIVE_SCHEMA_SQL = SCHEMA_SQL;

function catchesCode(fn, code) {
  assert.throws(fn, (error) => error instanceof SchemaSafetyError && error.code === code);
}

function row(constraint_name, constraint_type, definition) {
  return { constraint_name, constraint_type, definition };
}

function validColumns() {
  return EXPECTED_COLUMNS.map((column, offset) => ({
    ordinal_position: offset + 1,
    column_name: column.name,
    data_type: column.type,
    not_null: column.notNull,
    identity_kind: column.identityKind,
    default_expression: column.defaultExpression,
  }));
}

function validConstraints() {
  return [
    row("ghost_agency_hero_reel_jobs_pkey", "p", "PRIMARY KEY (id)"),
    row("ghost_agency_hero_reel_jobs_job_id_key", "u", "UNIQUE (job_id)"),
    row("ghost_agency_hero_reel_jobs_prospect_id_key", "u", "UNIQUE (prospect_id)"),
    row(
      "ghost_agency_hero_reel_jobs_producer_check",
      "c",
      `CHECK (producer = ANY (ARRAY[${PRODUCERS.map((value) => `'${value}'::text`).join(", ")}]))`,
    ),
    row(
      "ghost_agency_hero_reel_jobs_status_check",
      "c",
      `CHECK (status = ANY (ARRAY[${STATUSES.map((value) => `'${value}'::text`).join(", ")}]))`,
    ),
    row("ghost_agency_hero_reel_jobs_attempts_check", "c", "CHECK (attempts >= 0)"),
    row(
      "ghost_agency_hero_reel_jobs_lease_complete",
      "c",
      "CHECK ((((status = 'running'::text) AND (lease_token IS NOT NULL) AND (lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status <> 'running'::text) AND (lease_token IS NULL) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL))))",
    ),
  ];
}

function indexRow(index_name, is_unique, key_columns, predicate = "") {
  return { index_name, is_unique, key_columns, predicate };
}

function validIndexes() {
  return [
    indexRow("ghost_agency_hero_reel_jobs_pkey", true, ["id"]),
    indexRow("ghost_agency_hero_reel_jobs_job_id_key", true, ["job_id"]),
    indexRow("ghost_agency_hero_reel_jobs_prospect_id_key", true, ["prospect_id"]),
    indexRow("ghost_agency_hero_reel_jobs_claim_idx", false, ["status", "created_at"], "status = 'queued'::text"),
    indexRow("ghost_agency_hero_reel_jobs_lease_expiry_idx", false, ["lease_expires_at"], "status = 'running'::text"),
  ];
}

function validAccess() {
  return [{
    rls_enabled: true,
    force_rls: false,
    service_select: true,
    service_insert: true,
    service_update: true,
    service_delete: false,
    service_truncate: false,
    service_references: false,
    service_trigger: false,
    anon_any: false,
    authenticated_any: false,
    public_any: false,
  }];
}

function validSequence() {
  return [{
    sequence_name: SEQUENCE,
    service_usage: true,
    service_select: true,
    service_update: false,
    anon_any: false,
    authenticated_any: false,
    public_any: false,
  }];
}

function catalogClient(overrides = {}) {
  const catalogs = {
    columns: validColumns(),
    constraints: validConstraints(),
    indexes: validIndexes(),
    access: validAccess(),
    sequence: validSequence(),
    policies: [],
    ...overrides,
  };
  return {
    async query(sql) {
      const match = String(sql).match(/hero_reel_schema:([a-z]+)/);
      if (!match) throw new Error("unexpected query");
      return { rows: catalogs[match[1]] };
    },
  };
}

test("env parsing and project binding do not alter or disclose secret text", () => {
  const parsed = parseEnvText(`\uFEFFexport SUPABASE_DB_URL="${DIRECT_URL}?password_has_hash=#kept"\nSUPABASE_URL='${API_URL}'\nignored-key=no\n`);
  assert.equal(parsed.SUPABASE_DB_URL, `${DIRECT_URL}?password_has_hash=#kept`);
  assert.equal(parsed.SUPABASE_URL, API_URL);
  assert.equal(parsed["ignored-key"], undefined);

  const config = loadSecureConfig({
    env: { SUPABASE_DB_URL: POOLER_URL, SUPABASE_URL: API_URL },
    envFile: "unused",
    existsSync: () => true,
    readFileSync: () => `SUPABASE_DB_URL=${DIRECT_URL}\nSUPABASE_URL=https://wrong.supabase.co`,
  });
  assert.equal(config.binding.projectRef, PROJECT_REF);
  assert.equal(config.binding.connectionKind, "pooler");
});

test("schema credentials use process env unless one explicit portable env file is named", () => {
  let fileChecks = 0;
  catchesCode(() => loadSecureConfig({
    env: {},
    existsSync() { fileChecks += 1; return true; },
    readFileSync() { throw new Error("must not read an implicit machine file"); },
  }), "missing_supabase_db_url");
  assert.equal(fileChecks, 0);

  const seen = [];
  const config = loadSecureConfig({
    env: { [ENV_FILE_VARIABLE]: "fixture.env" },
    existsSync(file) { seen.push(["exists", file]); return true; },
    readFileSync(file) {
      seen.push(["read", file]);
      return `SUPABASE_DB_URL=${DIRECT_URL}\nSUPABASE_URL=${API_URL}\n`;
    },
  });
  assert.deepEqual(seen, [["exists", "fixture.env"], ["read", "fixture.env"]]);
  assert.equal(config.binding.projectRef, PROJECT_REF);
});

test("missing explicit env files fail without printing their path", () => {
  let error;
  try {
    loadSecureConfig({
      env: { [ENV_FILE_VARIABLE]: "private-schema.env" },
      existsSync: () => false,
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof SchemaSafetyError);
  assert.equal(publicErrorLine(error), "ERROR schema_env_file_missing");
  assert.equal(publicErrorLine(error).includes("private-schema.env"), false);
});

test("schema tool source contains no user-specific absolute path", () => {
  const source = fs.readFileSync(require.resolve("../scripts/apply-hero-reel-schema"), "utf8");
  assert.doesNotMatch(source, /[A-Za-z]:[\\/](?:Users|Documents)[\\/]/i);
  assert.doesNotMatch(source, /\/(?:Users|home)\//i);
});

test("only direct or pooler URLs bound to the same Supabase project are accepted", () => {
  assert.equal(validateProjectBinding(DIRECT_URL, API_URL).connectionKind, "direct");
  assert.equal(validateProjectBinding(POOLER_URL, API_URL).connectionKind, "pooler");
  catchesCode(
    () => validateProjectBinding(DIRECT_URL.replace(PROJECT_REF, "differentprojectref"), API_URL),
    "supabase_project_mismatch",
  );
  catchesCode(
    () => validateProjectBinding("postgresql://postgres:secret@localhost:5432/postgres", API_URL),
    "supabase_project_mismatch",
  );
  catchesCode(
    () => validateProjectBinding(DIRECT_URL.replace(/\/postgres$/, "/template1"), API_URL),
    "unexpected_database_name",
  );
});

test("checked-in hero queue SQL is target-bound and safely migrates all durable producers", () => {
  const safety = assertSafeSql(SCHEMA_SQL);
  assert.deepEqual({
    tables: safety.tables,
    indexes: safety.indexes,
    statements: safety.statements,
  }, {
    tables: 1,
    indexes: 2,
    statements: 15,
  });
  assert.match(safety.sha256, /^[0-9a-f]{64}$/);
  assert.ok(STATUSES.includes("awaiting_review"));
  assert.deepEqual(PRODUCERS, ["wan2_i2v_local", "ads_image_to_video", "openrouter_seedance"]);
  assert.match(SCHEMA_SQL, /drop constraint if exists ghost_agency_hero_reel_jobs_producer_check/i);
  assert.match(SCHEMA_SQL, /add constraint ghost_agency_hero_reel_jobs_producer_check[\s\S]*not valid/i);
  assert.match(SCHEMA_SQL, /validate constraint ghost_agency_hero_reel_jobs_producer_check/i);
});

test("destructive, data-changing, dynamic, policy, and unexpected-target SQL is rejected", () => {
  catchesCode(() => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\ndrop table public.${TABLE};`), "destructive_drop");
  catchesCode(
    () => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\nalter table public.${TABLE} drop constraint ghost_agency_hero_reel_jobs_status_check;`),
    "destructive_drop",
  );
  catchesCode(() => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\ndelete from public.${TABLE};`), "destructive_delete");
  catchesCode(() => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\nupdate public.${TABLE} set status='done';`), "data_update_forbidden");
  catchesCode(() => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\ndo $$ begin null; end $$;`), "dollar_quoted_sql_forbidden");
  catchesCode(() => assertSafeSql(`${ADDITIVE_SCHEMA_SQL}\ncreate policy open on public.${TABLE} using (true);`), "policy_sql_forbidden");
  catchesCode(
    () => assertSafeSql(ADDITIVE_SCHEMA_SQL.replace(`public.${TABLE}`, "public.some_other_table")),
    "unexpected_table_target",
  );
});

test("status contract fails closed when awaiting_review is absent or an extra state appears", () => {
  catchesCode(
    () => assertSafeSql(ADDITIVE_SCHEMA_SQL.replace("'awaiting_review', ", "")),
    "status_contract_mismatch",
  );
  catchesCode(
    () => assertSafeSql(ADDITIVE_SCHEMA_SQL.replace("'failed'", "'failed', 'mystery'")),
    "status_contract_mismatch",
  );
});

test("producer contract fails closed when Seedance, WAN, Ads, or the exact migration shape drifts", () => {
  catchesCode(
    () => assertSafeSql(ADDITIVE_SCHEMA_SQL.replace(
      "producer in ('wan2_i2v_local', 'ads_image_to_video', 'openrouter_seedance')",
      "producer in ('wan2_i2v_local', 'ads_image_to_video')",
    )),
    "producer_contract_mismatch",
  );
  catchesCode(
    () => assertSafeSql(ADDITIVE_SCHEMA_SQL.replace("not valid;", ";")),
    "unexpected_schema_statement",
  );
});

test("catalog verification accepts the exact columns, constraints, indexes, RLS, grants, and zero policies", async () => {
  assert.deepEqual(await verifySchema(catalogClient()), {
    tables: 1,
    columns: 14,
    constraints: 7,
    indexes: 5,
    sequences: 1,
    rlsPolicies: 0,
  });
});

test("catalog verification fails on status, lease, identity, access, sequence, or policy drift", async () => {
  const badStatus = validConstraints();
  badStatus.find((entry) => entry.constraint_name.endsWith("_status_check")).definition = "CHECK (status = 'queued'::text)";
  await assert.rejects(verifySchema(catalogClient({ constraints: badStatus })), (error) => (
    ["constraint_definition_mismatch", "constraint_values_mismatch"].includes(error.code)
  ));

  const badProducer = validConstraints();
  badProducer.find((entry) => entry.constraint_name.endsWith("_producer_check")).definition = "CHECK (producer = 'ads_image_to_video'::text)";
  await assert.rejects(verifySchema(catalogClient({ constraints: badProducer })), (error) => (
    ["constraint_definition_mismatch", "constraint_values_mismatch"].includes(error.code)
  ));

  const badLease = validConstraints();
  badLease.find((entry) => entry.constraint_name.endsWith("_lease_complete")).definition = "CHECK (lease_token IS NULL)";
  await assert.rejects(verifySchema(catalogClient({ constraints: badLease })), (error) => error.code === "constraint_definition_mismatch");

  const badIdentity = validColumns();
  badIdentity[0].identity_kind = "";
  await assert.rejects(verifySchema(catalogClient({ columns: badIdentity })), (error) => error.code === "column_definition_mismatch");

  const openAccess = validAccess();
  openAccess[0].authenticated_any = true;
  await assert.rejects(verifySchema(catalogClient({ access: openAccess })), (error) => error.code === "unexpected_table_privilege");

  const broadSequence = validSequence();
  broadSequence[0].service_update = true;
  await assert.rejects(verifySchema(catalogClient({ sequence: broadSequence })), (error) => error.code === "unexpected_sequence_privilege");

  await assert.rejects(
    verifySchema(catalogClient({ policies: [{ policy_name: "unexpected" }] })),
    (error) => error.code === "unexpected_rls_policy",
  );
});

test("default mode is a credential-free dry run and cannot create a database client", async () => {
  const output = [];
  let clientCalls = 0;
  const result = await runCli([], {
    env: {},
    existsSync() { throw new Error("dry run must not inspect credentials"); },
    readFileSync: () => ADDITIVE_SCHEMA_SQL,
    stdout: { write(value) { output.push(value); } },
    createClient() { clientCalls += 1; throw new Error("must not connect"); },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(clientCalls, 0);
  const transcript = output.join("");
  assert.match(transcript, /DRY_RUN_OK/);
  assert.match(transcript, /NO_DATABASE_CONNECTION NO_CHANGES/);
  assert.equal(transcript.includes("super-secret"), false);
  assert.equal(transcript.includes(PROJECT_REF), false);
  assert.equal(transcript.includes("C:\\"), false);
});

test("apply runs one locked transaction, verifies before commit, and rolls back on drift", async () => {
  const calls = [];
  const catalog = catalogClient();
  const client = {
    async connect() { calls.push("connect"); },
    async end() { calls.push("end"); },
    async query(sql, params) {
      const value = String(sql);
      calls.push(value);
      if (/hero_reel_schema:/.test(value)) return catalog.query(value, params);
      return { rows: [] };
    },
  };
  const summary = await runDatabaseAction(client, ADDITIVE_SCHEMA_SQL, true);
  assert.equal(summary.tables, 1);
  assert.equal(calls[1], "BEGIN");
  assert.ok(calls.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(calls.includes("SET LOCAL statement_timeout = '30s'"));
  assert.ok(calls.some((value) => value.includes("pg_advisory_xact_lock")));
  assert.ok(calls.indexOf("COMMIT") > calls.indexOf(ADDITIVE_SCHEMA_SQL));
  assert.equal(calls.at(-1), "end");

  const failedCalls = [];
  const failedCatalog = catalogClient({ policies: [{ policy_name: "unexpected" }] });
  const failedClient = {
    async connect() {},
    async end() {},
    async query(sql, params) {
      const value = String(sql);
      failedCalls.push(value);
      if (/hero_reel_schema:/.test(value)) return failedCatalog.query(value, params);
      return { rows: [] };
    },
  };
  await assert.rejects(runDatabaseAction(failedClient, ADDITIVE_SCHEMA_SQL, true), (error) => error.code === "unexpected_rls_policy");
  assert.ok(failedCalls.includes("ROLLBACK"));
  assert.equal(failedCalls.includes("COMMIT"), false);
});

test("verify is read-only and public errors never expose credentials, SQL, or paths", async () => {
  const calls = [];
  const catalog = catalogClient();
  const client = {
    async connect() {},
    async end() {},
    async query(sql, params) {
      const value = String(sql);
      calls.push(value);
      if (/hero_reel_schema:/.test(value)) return catalog.query(value, params);
      return { rows: [] };
    },
  };
  await runDatabaseAction(client, ADDITIVE_SCHEMA_SQL, false);
  assert.equal(calls[0], "BEGIN READ ONLY");
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.includes(ADDITIVE_SCHEMA_SQL), false);

  const error = new SchemaSafetyError("schema_apply_failed", "42P01");
  error.message = `${DIRECT_URL} C:\\private\\file.sql DROP TABLE secret`;
  assert.equal(publicErrorLine(error), "ERROR schema_apply_failed db_code=42P01");
});
