"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ENV_FILE = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
const SCHEMA_FILE = path.resolve(__dirname, "..", "supabase", "line-batches.sql");
const DEFAULT_PG_MODULE_PATH = "C:/Users/Main/AppData/Local/Temp/claude/C--Users-Main-Documents-Dark-Signal/c5530dca-45ae-49de-a01c-2a6a99301c56/scratchpad/pgclient/node_modules/pg";

const TABLES = Object.freeze([
  "ghost_agency_line_batches",
  "ghost_agency_line_batch_rows",
]);

const EXPECTED_COLUMNS = Object.freeze({
  ghost_agency_line_batches: Object.freeze([
    column("batch_id", "text", true),
    column("lane", "text", true),
    column("target", "text", true, "''"),
    column("requested", "integer", true),
    column("status", "text", true, "'building'"),
    column("pick_state", "text", true, "'pending'"),
    column("mine_funnel", "jsonb", true, "'{}'"),
    column("approval", "jsonb", false),
    column("halt_reason", "text", false),
    column("version", "bigint", true, "0"),
    column("mutation_token", "uuid", false),
    column("started_at", "timestamp with time zone", true, "now()"),
    column("created_at", "timestamp with time zone", true, "now()"),
    column("updated_at", "timestamp with time zone", true, "now()"),
    column("settled_at", "timestamp with time zone", false),
    column("sent_at", "timestamp with time zone", false),
  ]),
  ghost_agency_line_batch_rows: Object.freeze([
    column("row_id", "text", true),
    column("batch_id", "text", true),
    column("row_index", "integer", true),
    column("prospect_id", "text", true),
    column("status", "text", true, "'picked'"),
    column("payload", "jsonb", true, "'{}'"),
    column("version", "bigint", true, "0"),
    column("mutation_token", "uuid", false),
    column("lease_token", "uuid", false),
    column("lease_owner", "text", false),
    column("lease_expires_at", "timestamp with time zone", false),
    column("attempt_count", "integer", true, "0"),
    column("last_retryable_error", "text", false),
    column("logo_sha256", "text", false),
    column("terminal_at", "timestamp with time zone", false),
    column("created_at", "timestamp with time zone", true, "now()"),
    column("updated_at", "timestamp with time zone", true, "now()"),
  ]),
});

const EXPECTED_CONSTRAINTS = Object.freeze({
  ghost_agency_line_batches: Object.freeze({
    ghost_agency_line_batches_pkey: exactConstraint("p", "primary key (batch_id)"),
    ghost_agency_line_batches_lane_check: enumConstraint("lane", ["sandbox", "live"]),
    ghost_agency_line_batches_requested_check: fragmentConstraint("c", [
      "requested >= 0",
      "requested <= 500",
      " and ",
    ]),
    ghost_agency_line_batches_status_check: enumConstraint("status", [
      "building", "running", "awaiting_approval", "approved", "sending", "done", "halted",
    ]),
    ghost_agency_line_batches_pick_state_check: enumConstraint("pick_state", [
      "pending", "picking", "complete", "failed",
    ]),
    ghost_agency_line_batches_version_check: fragmentConstraint("c", ["version >= 0"]),
  }),
  ghost_agency_line_batch_rows: Object.freeze({
    ghost_agency_line_batch_rows_pkey: exactConstraint("p", "primary key (row_id)"),
    ghost_agency_line_batch_rows_batch_id_fkey: fragmentConstraint("f", [
      "foreign key (batch_id)",
      "references ghost_agency_line_batches(batch_id)",
      "on delete cascade",
    ]),
    ghost_agency_line_batch_rows_row_index_check: fragmentConstraint("c", ["row_index >= 0"]),
    ghost_agency_line_batch_rows_status_check: enumConstraint("status", [
      "picked", "qualified", "mirrored", "gate_passed", "queued", "sent", "rejected", "gate_failed", "error",
    ]),
    ghost_agency_line_batch_rows_version_check: fragmentConstraint("c", ["version >= 0"]),
    ghost_agency_line_batch_rows_attempt_count_check: fragmentConstraint("c", ["attempt_count >= 0"]),
    ghost_agency_line_batch_rows_logo_sha256_check: regexConstraint("logo_sha256", "^[0-9a-f]{64}$"),
    ghost_agency_line_batch_rows_batch_index_unique: exactConstraint("u", "unique (batch_id, row_index)"),
    ghost_agency_line_batch_rows_batch_prospect_unique: exactConstraint("u", "unique (batch_id, prospect_id)"),
    ghost_agency_line_batch_rows_lease_complete: fragmentConstraint("c", [
      "lease_token is null and lease_owner is null and lease_expires_at is null",
      "lease_token is not null and lease_owner is not null and lease_expires_at is not null",
      " or ",
    ]),
  }),
});

const EXPECTED_INDEXES = Object.freeze({
  ghost_agency_line_batches: Object.freeze({
    ghost_agency_line_batches_pkey: index(["batch_id"], { unique: true }),
    ghost_agency_line_batches_status_updated_idx: index(["status", "updated_at"]),
  }),
  ghost_agency_line_batch_rows: Object.freeze({
    ghost_agency_line_batch_rows_pkey: index(["row_id"], { unique: true }),
    ghost_agency_line_batch_rows_batch_index_unique: index(["batch_id", "row_index"], { unique: true }),
    ghost_agency_line_batch_rows_batch_prospect_unique: index(["batch_id", "prospect_id"], { unique: true }),
    ghost_agency_line_batch_rows_claim_idx: index(["batch_id", "status", "row_index"], {
      predicate: enumPredicate("status", ["picked", "qualified", "mirrored", "gate_passed"]),
    }),
    ghost_agency_line_batch_rows_send_idx: index(["batch_id", "row_index"], {
      predicate: enumPredicate("status", ["queued"]),
    }),
    ghost_agency_line_batch_rows_lease_expiry_idx: index(["lease_expires_at"], {
      predicate: fragmentPredicate(["lease_token is not null"]),
    }),
    ghost_agency_line_batch_rows_batch_logo_unique: index(["batch_id", "logo_sha256"], {
      unique: true,
      predicate: combinedPredicate(
        fragmentPredicate(["logo_sha256 is not null", " and "]),
        enumPredicate("status", ["gate_passed", "queued", "sent"]),
      ),
    }),
  }),
});

const EXPLICIT_INDEX_NAMES = Object.freeze([
  "ghost_agency_line_batches_status_updated_idx",
  "ghost_agency_line_batch_rows_claim_idx",
  "ghost_agency_line_batch_rows_send_idx",
  "ghost_agency_line_batch_rows_lease_expiry_idx",
  "ghost_agency_line_batch_rows_batch_logo_unique",
]);

class SchemaSafetyError extends Error {
  constructor(code, dbCode = "") {
    super(code);
    this.name = "SchemaSafetyError";
    this.code = code;
    this.dbCode = /^[A-Z0-9]{4,8}$/.test(String(dbCode || "")) ? String(dbCode) : "";
  }
}

function column(name, type, notNull, defaultExpression = null) {
  return Object.freeze({ name, type, notNull, defaultExpression });
}

function exactConstraint(type, definition) {
  return Object.freeze({ type, exact: normalizeSqlExpression(definition) });
}

function fragmentConstraint(type, fragments) {
  return Object.freeze({ type, fragments: fragments.map(normalizeSqlExpression) });
}

function enumConstraint(columnName, values) {
  return Object.freeze({
    type: "c",
    fragments: [normalizeSqlExpression(columnName)],
    enumColumn: normalizeSqlExpression(columnName),
    quotedValues: [...values].sort(),
  });
}

function regexConstraint(columnName, pattern) {
  return Object.freeze({
    type: "c",
    fragments: [
      normalizeSqlExpression(`${columnName} is null`),
      normalizeSqlExpression(`${columnName} ~`),
      " or ",
    ],
    quotedValues: [pattern],
  });
}

function index(columns, options = {}) {
  return Object.freeze({
    columns: Object.freeze([...columns]),
    unique: Boolean(options.unique),
    predicate: options.predicate || emptyPredicate,
  });
}

function emptyPredicate(value) {
  return String(value || "").trim() === "";
}

function fragmentPredicate(fragments) {
  const normalized = fragments.map(normalizeSqlExpression);
  return (value) => normalized.every((fragment) => normalizeSqlExpression(value).includes(fragment));
}

function enumPredicate(columnName, values) {
  const expected = [...values].sort();
  return (value) => {
    const normalized = normalizeSqlExpression(value);
    const column = normalizeSqlExpression(columnName);
    const hasExactOperator = normalized.includes(`${column} = any array`)
      || normalized.includes(`${column} in `)
      || (expected.length === 1 && normalized.includes(`${column} = `));
    const actual = extractQuotedLiterals(value).sort();
    return hasExactOperator && arraysEqual(actual, expected);
  };
}

function combinedPredicate(...predicates) {
  return (value) => predicates.every((predicate) => predicate(value));
}

function parseEnvText(text) {
  const output = {};
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

function loadSecureConfig(options = {}) {
  const env = options.env || process.env;
  const envFile = options.envFile || ENV_FILE;
  const readFileSync = options.readFileSync || fs.readFileSync;
  const existsSync = options.existsSync || fs.existsSync;
  const fileValues = existsSync(envFile) ? parseEnvText(readFileSync(envFile, "utf8")) : {};
  const value = (name) => String(env[name] || fileValues[name] || "").trim();
  const dbUrl = value("SUPABASE_DB_URL");
  const supabaseUrl = value("SUPABASE_URL");
  if (!dbUrl) throw new SchemaSafetyError("missing_supabase_db_url");
  if (!supabaseUrl) throw new SchemaSafetyError("missing_supabase_url");
  const binding = validateProjectBinding(dbUrl, supabaseUrl);
  return Object.freeze({
    dbUrl,
    supabaseUrl,
    binding,
    pgModulePath: value("PG_MODULE_PATH") || DEFAULT_PG_MODULE_PATH,
  });
}

function validateProjectBinding(dbUrl, supabaseUrl) {
  let database;
  let api;
  try {
    database = new URL(String(dbUrl));
    api = new URL(String(supabaseUrl));
  } catch {
    throw new SchemaSafetyError("invalid_supabase_url");
  }

  if (!["postgres:", "postgresql:"].includes(database.protocol)) {
    throw new SchemaSafetyError("invalid_database_protocol");
  }
  if (api.protocol !== "https:") throw new SchemaSafetyError("invalid_supabase_api_protocol");
  if (!database.username || !database.password) throw new SchemaSafetyError("incomplete_database_credentials");
  if (database.pathname !== "/postgres") throw new SchemaSafetyError("unexpected_database_name");

  const apiHost = api.hostname.toLowerCase();
  const apiMatch = apiHost.match(/^([a-z0-9-]+)\.supabase\.co$/);
  if (!apiMatch) throw new SchemaSafetyError("unverifiable_supabase_project");
  const projectRef = apiMatch[1];
  const dbHost = database.hostname.toLowerCase();
  let username = "";
  try {
    username = decodeURIComponent(database.username).toLowerCase();
  } catch {
    throw new SchemaSafetyError("invalid_database_username");
  }

  const directHost = `db.${projectRef}.supabase.co`;
  const directMatch = dbHost === directHost && ["postgres", `postgres.${projectRef}`].includes(username);
  const poolerMatch = dbHost.endsWith(".pooler.supabase.com") && username === `postgres.${projectRef}`;
  if (!directMatch && !poolerMatch) throw new SchemaSafetyError("supabase_project_mismatch");

  return Object.freeze({ projectRef, connectionKind: poolerMatch ? "pooler" : "direct" });
}

function stripSqlCommentsAndLiterals(sql) {
  const input = String(sql || "");
  let output = "";
  let state = "code";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "literal") {
      if (char === "'" && next === "'") {
        output += "  ";
        index += 1;
      } else if (char === "'") {
        output += "'";
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
    } else if (char === "'") {
      output += "'";
      state = "literal";
    } else {
      output += char;
    }
  }
  if (state === "block-comment") throw new SchemaSafetyError("unterminated_sql_comment");
  if (state === "literal") throw new SchemaSafetyError("unterminated_sql_literal");
  return output;
}

function assertSafeSql(sql) {
  const source = String(sql || "");
  if (!source.trim()) throw new SchemaSafetyError("empty_schema_sql");
  if (Buffer.byteLength(source, "utf8") > 128 * 1024) throw new SchemaSafetyError("schema_sql_too_large");
  if (/\$[A-Za-z0-9_]*\$/i.test(source)) throw new SchemaSafetyError("dollar_quoted_sql_forbidden");

  const clean = stripSqlCommentsAndLiterals(source);
  const forbidden = [
    ["destructive_drop", /\bdrop\b/i],
    ["destructive_truncate", /\btruncate\b/i],
    ["destructive_delete", /\bdelete\s+from\b/i],
    ["data_update_forbidden", /\bupdate\s+[\s\S]*?\bset\b/i],
    ["data_insert_forbidden", /\binsert\s+into\b/i],
    ["merge_forbidden", /\bmerge\s+into\b/i],
    ["dynamic_sql_forbidden", /\b(?:do|call|execute)\b/i],
    ["copy_forbidden", /\bcopy\b/i],
    ["maintenance_sql_forbidden", /\b(?:vacuum|cluster|reindex)\b/i],
    ["role_sql_forbidden", /\b(?:create|alter)\s+(?:role|user)\b/i],
    ["database_sql_forbidden", /\b(?:create|alter)\s+(?:database|schema|extension)\b/i],
    ["security_definer_forbidden", /\bsecurity\s+definer\b/i],
  ];
  for (const [code, pattern] of forbidden) {
    if (pattern.test(clean)) throw new SchemaSafetyError(code);
  }

  const expectedTables = new Set(TABLES);
  const expectedIndexes = new Set(EXPLICIT_INDEX_NAMES);
  const seen = new Set();
  const statements = clean.split(";").map((value) => value.trim()).filter(Boolean);
  for (const statement of statements) {
    const compact = statement.replace(/\s+/g, " ").trim().toLowerCase();
    let match = compact.match(/^create table if not exists public\.([a-z0-9_]+)\s*\(/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "table", match[1]);
      continue;
    }
    match = compact.match(/^create (?:unique )?index if not exists ([a-z0-9_]+) on public\.([a-z0-9_]+)\s*\(/);
    if (match) {
      requireExpectedAndUnique(expectedIndexes, seen, "index", match[1]);
      if (!expectedTables.has(match[2])) throw new SchemaSafetyError("unexpected_index_table");
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) enable row level security$/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "rls", match[1]);
      continue;
    }
    match = compact.match(/^revoke all on table public\.([a-z0-9_]+) from public, anon, authenticated$/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "revoke", match[1]);
      continue;
    }
    match = compact.match(/^revoke all on table public\.([a-z0-9_]+) from service_role$/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "service-revoke", match[1]);
      continue;
    }
    match = compact.match(/^grant select, insert, update, delete on table public\.([a-z0-9_]+) to service_role$/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "grant", match[1]);
      continue;
    }
    match = compact.match(/^comment on table public\.([a-z0-9_]+) is\s*'\s*'$/);
    if (match) {
      requireExpectedAndUnique(expectedTables, seen, "comment", match[1]);
      continue;
    }
    throw new SchemaSafetyError("unexpected_schema_statement");
  }

  for (const tableName of expectedTables) {
    for (const category of ["table", "rls", "revoke", "service-revoke", "grant", "comment"]) {
      if (!seen.has(`${category}:${tableName}`)) throw new SchemaSafetyError(`missing_${category}_statement`);
    }
  }
  for (const indexName of expectedIndexes) {
    if (!seen.has(`index:${indexName}`)) throw new SchemaSafetyError("missing_index_statement");
  }

  return Object.freeze({
    statements: statements.length,
    tables: expectedTables.size,
    indexes: expectedIndexes.size,
    sha256: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
  });
}

function requireExpectedAndUnique(expected, seen, category, name) {
  if (!expected.has(name)) throw new SchemaSafetyError(`unexpected_${category}_target`);
  const key = `${category}:${name}`;
  if (seen.has(key)) throw new SchemaSafetyError(`duplicate_${category}_statement`);
  seen.add(key);
}

function normalizeSqlExpression(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/public\./g, "")
    .replace(/::(?:character varying|timestamp with time zone|[a-z0-9_]+)(?:\[\])?/g, "")
    .replace(/[()]/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .toLowerCase()
    .replace(/::(?:character varying|timestamp with time zone|[a-z0-9_]+)(?:\[\])?/g, "")
    .replace(/^\((.*)\)$/s, "$1")
    .replace(/\s+/g, "")
    .trim();
}

function extractQuotedLiterals(value) {
  const output = [];
  const pattern = /'((?:''|[^'])*)'/g;
  let match;
  while ((match = pattern.exec(String(value || "")))) output.push(match[1].replace(/''/g, "'"));
  return output;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function verifySchema(client) {
  const columns = rowsOf(await client.query(`/* line_schema:columns */
    select c.relname as table_name,
           a.attnum as ordinal_position,
           a.attname as column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public'
       and c.relname = any($1::text[])
       and c.relkind in ('r', 'p')
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname, a.attnum`, [TABLES]));
  verifyColumns(columns);

  const constraints = rowsOf(await client.query(`/* line_schema:constraints */
    select c.relname as table_name,
           x.conname as constraint_name,
           x.contype as constraint_type,
           pg_catalog.pg_get_constraintdef(x.oid, true) as definition
      from pg_catalog.pg_constraint x
      join pg_catalog.pg_class c on c.oid = x.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1::text[])
     order by c.relname, x.conname`, [TABLES]));
  verifyConstraints(constraints);

  const indexes = rowsOf(await client.query(`/* line_schema:indexes */
    select t.relname as table_name,
           i.relname as index_name,
           x.indisunique as is_unique,
           array(select pg_catalog.pg_get_indexdef(x.indexrelid, position, true)
                   from generate_series(1, x.indnkeyatts) as position
                  order by position) as key_columns,
           coalesce(pg_catalog.pg_get_expr(x.indpred, x.indrelid), '') as predicate
      from pg_catalog.pg_index x
      join pg_catalog.pg_class t on t.oid = x.indrelid
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = any($1::text[])
     order by t.relname, i.relname`, [TABLES]));
  verifyIndexes(indexes);

  const access = rowsOf(await client.query(`/* line_schema:access */
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as force_rls,
           pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') as service_select,
           pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT') as service_insert,
           pg_catalog.has_table_privilege('service_role', c.oid, 'UPDATE') as service_update,
           pg_catalog.has_table_privilege('service_role', c.oid, 'DELETE') as service_delete,
           pg_catalog.has_table_privilege('service_role', c.oid, 'TRUNCATE') as service_truncate,
           pg_catalog.has_table_privilege('service_role', c.oid, 'REFERENCES') as service_references,
           pg_catalog.has_table_privilege('service_role', c.oid, 'TRIGGER') as service_trigger,
           (pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
             or pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
             or pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
             or pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
             or pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE')
             or pg_catalog.has_table_privilege('anon', c.oid, 'REFERENCES')
             or pg_catalog.has_table_privilege('anon', c.oid, 'TRIGGER')) as anon_any,
           (pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'REFERENCES')
             or pg_catalog.has_table_privilege('authenticated', c.oid, 'TRIGGER')) as authenticated_any,
           exists (
             select 1
               from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
              where acl.grantee = 0
                and acl.privilege_type = any(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
           ) as public_any
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1::text[])
       and c.relkind in ('r', 'p')
     order by c.relname`, [TABLES]));
  verifyAccess(access);

  const policies = rowsOf(await client.query(`/* line_schema:policies */
    select tablename as table_name, policyname as policy_name
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = any($1::text[])
     order by tablename, policyname`, [TABLES]));
  if (policies.length !== 0) throw new SchemaSafetyError("unexpected_rls_policy");

  return Object.freeze({
    tables: TABLES.length,
    columns: columns.length,
    constraints: constraints.length,
    indexes: indexes.length,
    rlsPolicies: policies.length,
  });
}

function rowsOf(result) {
  if (!result || !Array.isArray(result.rows)) throw new SchemaSafetyError("invalid_database_response");
  return result.rows;
}

function verifyColumns(rows) {
  for (const tableName of TABLES) {
    const actual = rows.filter((row) => row.table_name === tableName);
    const expected = EXPECTED_COLUMNS[tableName];
    if (actual.length !== expected.length) throw new SchemaSafetyError("column_count_mismatch");
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      const found = actual[index];
      if (Number(found.ordinal_position) !== index + 1
        || found.column_name !== wanted.name
        || String(found.data_type).toLowerCase() !== wanted.type
        || Boolean(found.not_null) !== wanted.notNull
        || normalizeDefault(found.default_expression) !== wanted.defaultExpression) {
        throw new SchemaSafetyError("column_definition_mismatch");
      }
    }
  }
}

function verifyConstraints(rows) {
  for (const tableName of TABLES) {
    const actual = rows.filter((row) => row.table_name === tableName);
    const expected = EXPECTED_CONSTRAINTS[tableName];
    if (actual.length !== Object.keys(expected).length) throw new SchemaSafetyError("constraint_count_mismatch");
    for (const [name, wanted] of Object.entries(expected)) {
      const found = actual.find((row) => row.constraint_name === name);
      if (!found || found.constraint_type !== wanted.type) throw new SchemaSafetyError("constraint_missing_or_wrong_type");
      const normalized = normalizeSqlExpression(found.definition);
      if (wanted.exact && normalized !== wanted.exact) throw new SchemaSafetyError("constraint_definition_mismatch");
      if (wanted.fragments && !wanted.fragments.every((fragment) => normalized.includes(fragment))) {
        throw new SchemaSafetyError("constraint_definition_mismatch");
      }
      if (wanted.enumColumn
        && !normalized.includes(`${wanted.enumColumn} = any array`)
        && !normalized.includes(`${wanted.enumColumn} in `)) {
        throw new SchemaSafetyError("constraint_definition_mismatch");
      }
      if (wanted.quotedValues) {
        const actualValues = extractQuotedLiterals(found.definition).sort();
        if (!arraysEqual(actualValues, wanted.quotedValues)) throw new SchemaSafetyError("constraint_values_mismatch");
      }
    }
  }
}

function verifyIndexes(rows) {
  for (const tableName of TABLES) {
    const actual = rows.filter((row) => row.table_name === tableName);
    const expected = EXPECTED_INDEXES[tableName];
    if (actual.length !== Object.keys(expected).length) throw new SchemaSafetyError("index_count_mismatch");
    for (const [name, wanted] of Object.entries(expected)) {
      const found = actual.find((row) => row.index_name === name);
      if (!found) throw new SchemaSafetyError("index_missing");
      const columns = Array.isArray(found.key_columns)
        ? found.key_columns.map((value) => normalizeSqlExpression(value))
        : [];
      if (!arraysEqual(columns, wanted.columns)
        || Boolean(found.is_unique) !== wanted.unique
        || !wanted.predicate(found.predicate)) {
        throw new SchemaSafetyError("index_definition_mismatch");
      }
    }
  }
}

function verifyAccess(rows) {
  if (rows.length !== TABLES.length) throw new SchemaSafetyError("table_or_rls_missing");
  for (const tableName of TABLES) {
    const row = rows.find((entry) => entry.table_name === tableName);
    if (!row || row.rls_enabled !== true || row.force_rls !== false) {
      throw new SchemaSafetyError("rls_configuration_mismatch");
    }
    for (const privilege of ["service_select", "service_insert", "service_update", "service_delete"]) {
      if (row[privilege] !== true) throw new SchemaSafetyError("service_role_grant_missing");
    }
    for (const privilege of [
      "service_truncate", "service_references", "service_trigger", "anon_any", "authenticated_any", "public_any",
    ]) {
      if (row[privilege] !== false) throw new SchemaSafetyError("unexpected_table_privilege");
    }
  }
}

function loadPgClient(modulePath) {
  const candidates = [modulePath, "pg"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (loaded && typeof loaded.Client === "function") return loaded.Client;
    } catch {
      // Try the next known location. Details can contain machine paths, so do not print them.
    }
  }
  throw new SchemaSafetyError("pg_driver_unavailable");
}

function createDatabaseClient(config) {
  const Client = loadPgClient(config.pgModulePath);
  return new Client({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false },
    application_name: "ghost-line-schema-v1",
  });
}

async function runDatabaseAction(client, sql, apply) {
  let began = false;
  try {
    await client.connect();
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    began = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    if (apply) {
      await client.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ghost-line-schema-v1', 0))");
      await client.query(sql);
    }
    const summary = await verifySchema(client);
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    began = false;
    return summary;
  } catch (error) {
    if (began) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SchemaSafetyError) throw error;
    throw new SchemaSafetyError(apply ? "schema_apply_failed" : "schema_verify_failed", error && error.code);
  } finally {
    await client.end().catch(() => {});
  }
}

async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const flags = new Set(args);
  for (const value of flags) {
    if (!["--apply", "--verify"].includes(value)) throw new SchemaSafetyError("unknown_argument");
  }
  if (flags.has("--apply") && flags.has("--verify")) throw new SchemaSafetyError("conflicting_modes");

  const readFileSync = dependencies.readFileSync || fs.readFileSync;
  const existsSync = dependencies.existsSync || fs.existsSync;
  const stdout = dependencies.stdout || process.stdout;
  const config = loadSecureConfig({
    env: dependencies.env || process.env,
    envFile: dependencies.envFile || ENV_FILE,
    readFileSync,
    existsSync,
  });
  const sql = readFileSync(dependencies.schemaFile || SCHEMA_FILE, "utf8");
  const safety = assertSafeSql(sql);

  if (!flags.has("--apply") && !flags.has("--verify")) {
    stdout.write(`DRY_RUN_OK tables=${safety.tables} indexes=${safety.indexes} statements=${safety.statements} sha256=${safety.sha256}\n`);
    stdout.write("NO_DATABASE_CONNECTION NO_CHANGES\n");
    return Object.freeze({ mode: "dry-run", safety });
  }

  const createClient = dependencies.createClient || createDatabaseClient;
  const apply = flags.has("--apply");
  const summary = await runDatabaseAction(createClient(config), sql, apply);
  stdout.write(`${apply ? "APPLY" : "VERIFY"}_OK tables=${summary.tables} columns=${summary.columns} constraints=${summary.constraints} indexes=${summary.indexes} rls_policies=${summary.rlsPolicies}\n`);
  return Object.freeze({ mode: apply ? "apply" : "verify", safety, summary });
}

function publicErrorLine(error) {
  const code = error instanceof SchemaSafetyError ? error.code : "unexpected_failure";
  const dbCode = error instanceof SchemaSafetyError ? error.dbCode : "";
  return `ERROR ${code}${dbCode ? ` db_code=${dbCode}` : ""}`;
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${publicErrorLine(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ENV_FILE,
  SCHEMA_FILE,
  TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_INDEXES,
  SchemaSafetyError,
  assertSafeSql,
  extractQuotedLiterals,
  loadSecureConfig,
  normalizeDefault,
  normalizeSqlExpression,
  parseEnvText,
  publicErrorLine,
  runCli,
  runDatabaseAction,
  stripSqlCommentsAndLiterals,
  validateProjectBinding,
  verifyAccess,
  verifyColumns,
  verifyConstraints,
  verifyIndexes,
  verifySchema,
};
