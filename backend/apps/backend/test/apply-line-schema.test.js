"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  SCHEMA_FILE,
  TABLES,
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
} = require("../scripts/apply-line-schema");

const PROJECT_REF = "abcdefghijklmnopqrst";
const API_URL = `https://${PROJECT_REF}.supabase.co`;
const DIRECT_URL = `postgresql://postgres:super-secret@db.${PROJECT_REF}.supabase.co:5432/postgres`;
const POOLER_URL = `postgresql://postgres.${PROJECT_REF}:super-secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
const SCHEMA_SQL = fs.readFileSync(SCHEMA_FILE, "utf8");

function catchesCode(fn, code) {
  assert.throws(fn, (error) => error instanceof SchemaSafetyError && error.code === code);
}

function validColumns() {
  return TABLES.flatMap((tableName) => EXPECTED_COLUMNS[tableName].map((column, index) => ({
    table_name: tableName,
    ordinal_position: index + 1,
    column_name: column.name,
    data_type: column.type,
    not_null: column.notNull,
    default_expression: column.defaultExpression === null
      ? null
      : `${column.defaultExpression}::${column.type === "timestamp with time zone" ? "timestamptz" : column.type}`,
  })));
}

function validConstraints() {
  return [
    row("ghost_agency_line_batches", "ghost_agency_line_batches_pkey", "p", "PRIMARY KEY (batch_id)"),
    row("ghost_agency_line_batches", "ghost_agency_line_batches_lane_check", "c", "CHECK (lane = ANY (ARRAY['sandbox'::text, 'live'::text]))"),
    row("ghost_agency_line_batches", "ghost_agency_line_batches_requested_check", "c", "CHECK ((requested >= 0) AND (requested <= 500))"),
    row("ghost_agency_line_batches", "ghost_agency_line_batches_status_check", "c", "CHECK (status = ANY (ARRAY['building'::text, 'running'::text, 'awaiting_approval'::text, 'approved'::text, 'sending'::text, 'done'::text, 'halted'::text]))"),
    row("ghost_agency_line_batches", "ghost_agency_line_batches_pick_state_check", "c", "CHECK (pick_state = ANY (ARRAY['pending'::text, 'picking'::text, 'complete'::text, 'failed'::text]))"),
    row("ghost_agency_line_batches", "ghost_agency_line_batches_version_check", "c", "CHECK (version >= 0)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_pkey", "p", "PRIMARY KEY (row_id)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_id_fkey", "f", "FOREIGN KEY (batch_id) REFERENCES public.ghost_agency_line_batches(batch_id) ON DELETE CASCADE"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_row_index_check", "c", "CHECK (row_index >= 0)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_status_check", "c", "CHECK (status = ANY (ARRAY['picked'::text, 'qualified'::text, 'mirrored'::text, 'gate_passed'::text, 'queued'::text, 'sent'::text, 'rejected'::text, 'gate_failed'::text, 'error'::text]))"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_version_check", "c", "CHECK (version >= 0)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_attempt_count_check", "c", "CHECK (attempt_count >= 0)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_logo_sha256_check", "c", "CHECK ((logo_sha256 IS NULL) OR (logo_sha256 ~ '^[0-9a-f]{64}$'::text))"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_index_unique", "u", "UNIQUE (batch_id, row_index)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_prospect_unique", "u", "UNIQUE (batch_id, prospect_id)"),
    row("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_lease_complete", "c", "CHECK (((lease_token IS NULL) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL)))"),
  ];
}

function row(table_name, constraint_name, constraint_type, definition) {
  return { table_name, constraint_name, constraint_type, definition };
}

function validIndexes() {
  return [
    indexRow("ghost_agency_line_batches", "ghost_agency_line_batches_pkey", true, ["batch_id"]),
    indexRow("ghost_agency_line_batches", "ghost_agency_line_batches_status_updated_idx", false, ["status", "updated_at"]),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_pkey", true, ["row_id"]),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_index_unique", true, ["batch_id", "row_index"]),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_prospect_unique", true, ["batch_id", "prospect_id"]),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_claim_idx", false, ["batch_id", "status", "row_index"], "status = ANY (ARRAY['picked'::text, 'qualified'::text, 'mirrored'::text, 'gate_passed'::text])"),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_send_idx", false, ["batch_id", "row_index"], "status = 'queued'::text"),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_lease_expiry_idx", false, ["lease_expires_at"], "lease_token IS NOT NULL"),
    indexRow("ghost_agency_line_batch_rows", "ghost_agency_line_batch_rows_batch_logo_unique", true, ["batch_id", "logo_sha256"], "(logo_sha256 IS NOT NULL) AND (status = ANY (ARRAY['gate_passed'::text, 'queued'::text, 'sent'::text]))"),
  ];
}

function indexRow(table_name, index_name, is_unique, key_columns, predicate = "") {
  return { table_name, index_name, is_unique, key_columns, predicate };
}

function validAccess() {
  return TABLES.map((table_name) => ({
    table_name,
    rls_enabled: true,
    force_rls: false,
    service_select: true,
    service_insert: true,
    service_update: true,
    service_delete: true,
    service_truncate: false,
    service_references: false,
    service_trigger: false,
    anon_any: false,
    authenticated_any: false,
    public_any: false,
  }));
}

function catalogClient(overrides = {}) {
  const catalogs = {
    columns: validColumns(),
    constraints: validConstraints(),
    indexes: validIndexes(),
    access: validAccess(),
    policies: [],
    ...overrides,
  };
  return {
    async query(sql) {
      const match = String(sql).match(/line_schema:([a-z]+)/);
      if (!match) throw new Error("unexpected query");
      return { rows: catalogs[match[1]] };
    },
  };
}

test("env parser handles export and quotes without changing secret text", () => {
  const parsed = parseEnvText(`\uFEFFexport SUPABASE_DB_URL="${DIRECT_URL}?password_has_hash=#kept"\nSUPABASE_URL='${API_URL}'\nIGNORED-key=no\n`);
  assert.equal(parsed.SUPABASE_DB_URL, `${DIRECT_URL}?password_has_hash=#kept`);
  assert.equal(parsed.SUPABASE_URL, API_URL);
  assert.equal(parsed["IGNORED-key"], undefined);
});

test("process env wins over the secure file and project binding is validated", () => {
  const config = loadSecureConfig({
    env: { SUPABASE_DB_URL: POOLER_URL, SUPABASE_URL: API_URL },
    envFile: "never-read",
    existsSync: () => true,
    readFileSync: () => `SUPABASE_DB_URL=${DIRECT_URL}\nSUPABASE_URL=https://wrong.supabase.co`,
  });
  assert.equal(config.dbUrl, POOLER_URL);
  assert.equal(config.binding.projectRef, PROJECT_REF);
  assert.equal(config.binding.connectionKind, "pooler");
});

test("direct and pooler URLs bind only to the matching Supabase project", () => {
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

test("the checked-in schema passes the strict additive allowlist", () => {
  const result = assertSafeSql(SCHEMA_SQL);
  assert.deepEqual({ tables: result.tables, indexes: result.indexes, statements: result.statements }, {
    tables: 2,
    indexes: 5,
    statements: 17,
  });
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test("comments and comment literals cannot cause false destructive matches", () => {
  const withWords = SCHEMA_SQL
    .replace("-- Canonical state", "-- DROP TABLE and DELETE FROM are only comment text\n-- Canonical state")
    .replace("'Canonical durable state for operator Line batches; service-role only.'", "'DROP TABLE public.anything' ");
  assert.equal(assertSafeSql(withWords).tables, 2);
});

test("destructive, dynamic, data, and unexpected privilege SQL is refused", () => {
  catchesCode(() => assertSafeSql(`${SCHEMA_SQL}\ndrop table public.ghost_agency_line_batches;`), "destructive_drop");
  catchesCode(() => assertSafeSql(`${SCHEMA_SQL}\ndelete from public.ghost_agency_line_batches;`), "destructive_delete");
  catchesCode(() => assertSafeSql(`${SCHEMA_SQL}\nupdate public.ghost_agency_line_batches set status='done';`), "data_update_forbidden");
  catchesCode(() => assertSafeSql(`${SCHEMA_SQL}\ndo $$ begin null; end $$;`), "dollar_quoted_sql_forbidden");
  catchesCode(
    () => assertSafeSql(`${SCHEMA_SQL}\ngrant select on table public.ghost_agency_line_batches to authenticated;`),
    "unexpected_schema_statement",
  );
});

test("exact catalog verifier accepts the intended columns, constraints, indexes, RLS, and grants", async () => {
  const result = await verifySchema(catalogClient());
  assert.deepEqual(result, {
    tables: 2,
    columns: 33,
    constraints: 16,
    indexes: 9,
    rlsPolicies: 0,
  });
});

test("catalog verifier fails closed on drift or public access", async () => {
  const missingColumn = validColumns().slice(1);
  await assert.rejects(verifySchema(catalogClient({ columns: missingColumn })), (error) => error.code === "column_count_mismatch");

  const changedConstraint = validConstraints();
  changedConstraint.find((entry) => entry.constraint_name === "ghost_agency_line_batches_lane_check").definition = "CHECK (lane = 'live'::text)";
  await assert.rejects(
    verifySchema(catalogClient({ constraints: changedConstraint })),
    (error) => ["constraint_definition_mismatch", "constraint_values_mismatch"].includes(error.code),
  );

  const openAccess = validAccess();
  openAccess[0].authenticated_any = true;
  await assert.rejects(verifySchema(catalogClient({ access: openAccess })), (error) => error.code === "unexpected_table_privilege");

  await assert.rejects(
    verifySchema(catalogClient({ policies: [{ table_name: TABLES[0], policy_name: "unexpected" }] })),
    (error) => error.code === "unexpected_rls_policy",
  );
});

test("default CLI mode validates locally and never creates a database client", async () => {
  const output = [];
  let clientCalls = 0;
  const result = await runCli([], {
    env: { SUPABASE_DB_URL: DIRECT_URL, SUPABASE_URL: API_URL },
    existsSync: () => false,
    readFileSync: () => SCHEMA_SQL,
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
});

test("apply mode uses one transaction, verifies before commit, and rolls back on drift", async () => {
  const calls = [];
  const catalog = catalogClient();
  const client = {
    async connect() { calls.push("connect"); },
    async end() { calls.push("end"); },
    async query(sql, params) {
      const value = String(sql);
      calls.push(value);
      if (/line_schema:/.test(value)) return catalog.query(value, params);
      return { rows: [] };
    },
  };
  const summary = await runDatabaseAction(client, SCHEMA_SQL, true);
  assert.equal(summary.tables, 2);
  assert.equal(calls[1], "BEGIN");
  assert.ok(calls.some((value) => value.includes("pg_advisory_xact_lock")));
  assert.ok(calls.includes(SCHEMA_SQL));
  assert.ok(calls.indexOf("COMMIT") > calls.indexOf(SCHEMA_SQL));
  assert.equal(calls.at(-1), "end");

  const failedCalls = [];
  const badCatalog = catalogClient({ access: validAccess().map((entry, index) => ({
    ...entry,
    anon_any: index === 0,
  })) });
  const failedClient = {
    async connect() {},
    async end() {},
    async query(sql, params) {
      const value = String(sql);
      failedCalls.push(value);
      if (/line_schema:/.test(value)) return badCatalog.query(value, params);
      return { rows: [] };
    },
  };
  await assert.rejects(runDatabaseAction(failedClient, SCHEMA_SQL, true), (error) => error.code === "unexpected_table_privilege");
  assert.ok(failedCalls.includes("ROLLBACK"));
  assert.equal(failedCalls.includes("COMMIT"), false);
});

test("public errors never include credentials, URLs, SQL, or machine paths", () => {
  const error = new SchemaSafetyError("schema_apply_failed", "42P01");
  error.message = `${DIRECT_URL} C:\\private\\file.sql DROP TABLE secret`;
  const line = publicErrorLine(error);
  assert.equal(line, "ERROR schema_apply_failed db_code=42P01");
  assert.equal(line.includes("super-secret"), false);
  assert.equal(line.includes("private"), false);
});
