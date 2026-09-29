"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ENV_FILE_VARIABLE = "GHOST_AGENCY_HERO_SCHEMA_ENV_FILE";
const SCHEMA_FILE = path.resolve(__dirname, "..", "sql", "hero_reel_jobs.sql");
const TABLE = "ghost_agency_hero_reel_jobs";
const SEQUENCE = "ghost_agency_hero_reel_jobs_id_seq";
const PRODUCERS = Object.freeze(["wan2_i2v_local", "ads_image_to_video", "openrouter_seedance"]);
const STATUSES = Object.freeze([
  "queued",
  "running",
  "awaiting_review",
  "done",
  "refused",
  "failed",
]);

const EXPECTED_COLUMNS = Object.freeze([
  column("id", "bigint", true, null, "a"),
  column("job_id", "text", true),
  column("prospect_id", "text", true),
  column("producer", "text", true, "'openrouter_seedance'"),
  column("status", "text", true, "'queued'"),
  column("attempts", "integer", true, "0"),
  column("payload", "jsonb", true, "'{}'"),
  column("result", "jsonb", false),
  column("lease_token", "uuid", false),
  column("lease_owner", "text", false),
  column("lease_expires_at", "timestamp with time zone", false),
  column("created_at", "timestamp with time zone", true, "now()"),
  column("updated_at", "timestamp with time zone", true, "now()"),
  column("finished_at", "timestamp with time zone", false),
]);

const EXPECTED_CONSTRAINTS = Object.freeze({
  ghost_agency_hero_reel_jobs_pkey: exactConstraint("p", "primary key (id)"),
  ghost_agency_hero_reel_jobs_job_id_key: exactConstraint("u", "unique (job_id)"),
  ghost_agency_hero_reel_jobs_prospect_id_key: exactConstraint("u", "unique (prospect_id)"),
  ghost_agency_hero_reel_jobs_producer_check: enumConstraint("producer", PRODUCERS),
  ghost_agency_hero_reel_jobs_status_check: enumConstraint("status", STATUSES),
  ghost_agency_hero_reel_jobs_attempts_check: exactConstraint("c", "check (attempts >= 0)"),
  ghost_agency_hero_reel_jobs_lease_complete: exactConstraint("c", [
    "check (",
    "status = 'running' and lease_token is not null and lease_owner is not null and lease_expires_at is not null",
    " or ",
    "status <> 'running' and lease_token is null and lease_owner is null and lease_expires_at is null",
    ")",
  ].join("")),
});

const EXPECTED_INDEXES = Object.freeze({
  ghost_agency_hero_reel_jobs_pkey: index(["id"], { unique: true }),
  ghost_agency_hero_reel_jobs_job_id_key: index(["job_id"], { unique: true }),
  ghost_agency_hero_reel_jobs_prospect_id_key: index(["prospect_id"], { unique: true }),
  ghost_agency_hero_reel_jobs_claim_idx: index(["status", "created_at"], {
    predicate: enumPredicate("status", ["queued"]),
  }),
  ghost_agency_hero_reel_jobs_lease_expiry_idx: index(["lease_expires_at"], {
    predicate: enumPredicate("status", ["running"]),
  }),
});

const EXPLICIT_INDEX_NAMES = Object.freeze([
  "ghost_agency_hero_reel_jobs_claim_idx",
  "ghost_agency_hero_reel_jobs_lease_expiry_idx",
]);

class SchemaSafetyError extends Error {
  constructor(code, dbCode = "") {
    super(code);
    this.name = "SchemaSafetyError";
    this.code = code;
    this.dbCode = /^[A-Z0-9]{4,8}$/.test(String(dbCode || "")) ? String(dbCode) : "";
  }
}

function column(name, type, notNull, defaultExpression = null, identityKind = "") {
  return Object.freeze({ name, type, notNull, defaultExpression, identityKind });
}

function exactConstraint(type, definition) {
  return Object.freeze({ type, exact: normalizeSqlExpression(definition) });
}

function equalityConstraint(columnName, value) {
  return Object.freeze({
    type: "c",
    exact: normalizeSqlExpression(`check (${columnName} = '${value}')`),
  });
}

function enumConstraint(columnName, values) {
  return Object.freeze({
    type: "c",
    enumColumn: normalizeSqlExpression(columnName),
    quotedValues: [...values].sort(),
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

function enumPredicate(columnName, values) {
  const expected = [...values].sort();
  return (value) => {
    const normalized = normalizeSqlExpression(value);
    const columnNameNormalized = normalizeSqlExpression(columnName);
    const operatorMatches = normalized.includes(`${columnNameNormalized} = any array`)
      || normalized.includes(`${columnNameNormalized} in `)
      || (expected.length === 1 && normalized.includes(`${columnNameNormalized} = `));
    return operatorMatches && arraysEqual(extractQuotedLiterals(value).sort(), expected);
  };
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
  const envFile = String(
    Object.prototype.hasOwnProperty.call(options, "envFile")
      ? options.envFile || ""
      : env[ENV_FILE_VARIABLE] || "",
  ).trim();
  const readFileSync = options.readFileSync || fs.readFileSync;
  const existsSync = options.existsSync || fs.existsSync;
  if (envFile && !existsSync(envFile)) throw new SchemaSafetyError("schema_env_file_missing");
  const fileValues = envFile ? parseEnvText(readFileSync(envFile, "utf8")) : {};
  const value = (name) => String(env[name] || fileValues[name] || "").trim();
  const dbUrl = value("SUPABASE_DB_URL");
  const supabaseUrl = value("SUPABASE_URL");
  if (!dbUrl) throw new SchemaSafetyError("missing_supabase_db_url");
  if (!supabaseUrl) throw new SchemaSafetyError("missing_supabase_url");
  return Object.freeze({
    dbUrl,
    supabaseUrl,
    binding: validateProjectBinding(dbUrl, supabaseUrl),
    pgModulePath: value("PG_MODULE_PATH"),
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

  const apiMatch = api.hostname.toLowerCase().match(/^([a-z0-9-]+)\.supabase\.co$/);
  if (!apiMatch) throw new SchemaSafetyError("unverifiable_supabase_project");
  const projectRef = apiMatch[1];
  const dbHost = database.hostname.toLowerCase();
  let username;
  try {
    username = decodeURIComponent(database.username).toLowerCase();
  } catch {
    throw new SchemaSafetyError("invalid_database_username");
  }

  const direct = dbHost === `db.${projectRef}.supabase.co`
    && ["postgres", `postgres.${projectRef}`].includes(username);
  const pooler = dbHost.endsWith(".pooler.supabase.com") && username === `postgres.${projectRef}`;
  if (!direct && !pooler) throw new SchemaSafetyError("supabase_project_mismatch");
  return Object.freeze({ projectRef, connectionKind: pooler ? "pooler" : "direct" });
}

function stripSqlCommentsAndLiterals(sql) {
  const input = String(sql || "");
  let output = "";
  let state = "code";
  for (let offset = 0; offset < input.length; offset += 1) {
    const char = input[offset];
    const next = input[offset + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        output += "\n";
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        offset += 1;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "literal") {
      if (char === "'" && next === "'") {
        output += "  ";
        offset += 1;
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
      offset += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      offset += 1;
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
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) throw new SchemaSafetyError("schema_sql_too_large");
  if (/\$[A-Za-z0-9_]*\$/i.test(source)) throw new SchemaSafetyError("dollar_quoted_sql_forbidden");

  const clean = stripSqlCommentsAndLiterals(source);
  // The only DROP allowed by this tool is the named producer CHECK that the
  // immediately following statements recreate and validate in one locked
  // transaction. Everything else remains fail-closed.
  const cleanForForbidden = clean.replace(
    /alter\s+table\s+public\.ghost_agency_hero_reel_jobs\s+drop\s+constraint\s+if\s+exists\s+ghost_agency_hero_reel_jobs_producer_check/gi,
    "",
  );
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
    ["policy_sql_forbidden", /\b(?:create|alter)\s+policy\b/i],
  ];
  for (const [code, pattern] of forbidden) {
    if (pattern.test(cleanForForbidden)) throw new SchemaSafetyError(code);
  }

  const seen = new Set();
  const expectedIndexes = new Set(EXPLICIT_INDEX_NAMES);
  const statements = clean.split(";").map((value) => value.trim()).filter(Boolean);
  for (const statement of statements) {
    const compact = statement.replace(/\s+/g, " ").trim().toLowerCase();
    let match = compact.match(/^create table if not exists public\.([a-z0-9_]+)\s*\(/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "table");
      continue;
    }
    match = compact.match(/^create (?:unique )?index if not exists ([a-z0-9_]+) on public\.([a-z0-9_]+)\s*\(/);
    if (match) {
      if (!expectedIndexes.has(match[1])) throw new SchemaSafetyError("unexpected_index_target");
      requireExactTarget(match[2], TABLE, seen, `index:${match[1]}`);
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) drop constraint if exists ghost_agency_hero_reel_jobs_producer_check$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "producer-constraint-drop");
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) add constraint ghost_agency_hero_reel_jobs_producer_check check \(producer in \('\s*', '\s*', '\s*'\)\) not valid$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "producer-constraint-add");
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) validate constraint ghost_agency_hero_reel_jobs_producer_check$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "producer-constraint-validate");
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) alter column producer set default '\s*'$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "producer-default");
      continue;
    }
    match = compact.match(/^alter table public\.([a-z0-9_]+) enable row level security$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "rls");
      continue;
    }
    match = compact.match(/^revoke all on table public\.([a-z0-9_]+) from public, anon, authenticated$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "table-revoke");
      continue;
    }
    match = compact.match(/^revoke all on table public\.([a-z0-9_]+) from service_role$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "service-table-revoke");
      continue;
    }
    match = compact.match(/^grant select, insert, update on table public\.([a-z0-9_]+) to service_role$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "service-table-grant");
      continue;
    }
    match = compact.match(/^revoke all on sequence public\.([a-z0-9_]+) from public, anon, authenticated$/);
    if (match) {
      requireExactTarget(match[1], SEQUENCE, seen, "sequence-revoke");
      continue;
    }
    match = compact.match(/^revoke all on sequence public\.([a-z0-9_]+) from service_role$/);
    if (match) {
      requireExactTarget(match[1], SEQUENCE, seen, "service-sequence-revoke");
      continue;
    }
    match = compact.match(/^grant usage, select on sequence public\.([a-z0-9_]+) to service_role$/);
    if (match) {
      requireExactTarget(match[1], SEQUENCE, seen, "service-sequence-grant");
      continue;
    }
    match = compact.match(/^comment on table public\.([a-z0-9_]+) is\s*'\s*'$/);
    if (match) {
      requireExactTarget(match[1], TABLE, seen, "comment");
      continue;
    }
    throw new SchemaSafetyError("unexpected_schema_statement");
  }

  for (const category of [
    "table",
    "rls",
    "table-revoke",
    "service-table-revoke",
    "service-table-grant",
    "sequence-revoke",
    "service-sequence-revoke",
    "service-sequence-grant",
    "producer-constraint-drop",
    "producer-constraint-add",
    "producer-constraint-validate",
    "producer-default",
    "comment",
  ]) {
    if (!seen.has(category)) throw new SchemaSafetyError(`missing_${category}_statement`);
  }
  for (const indexName of expectedIndexes) {
    if (!seen.has(`index:${indexName}`)) throw new SchemaSafetyError("missing_index_statement");
  }

  const statusMatch = source.match(/constraint\s+ghost_agency_hero_reel_jobs_status_check\s+check\s*\(\s*status\s+in\s*\(([^)]*)\)\s*\)/i);
  if (!/status\s+text\s+not\s+null\s+default\s+'queued'/i.test(source)
    || !statusMatch
    || !arraysEqual(extractQuotedLiterals(statusMatch[1]).sort(), [...STATUSES].sort())) {
    throw new SchemaSafetyError("status_contract_mismatch");
  }

  const producerConstraint = source.match(
    /constraint\s+ghost_agency_hero_reel_jobs_producer_check\s+check\s*\(\s*producer\s+in\s*\(([^)]*)\)\s*\)/i,
  );
  const producerMigration = source.match(
    /alter\s+table\s+public\.ghost_agency_hero_reel_jobs\s+add\s+constraint\s+ghost_agency_hero_reel_jobs_producer_check\s+check\s*\(\s*producer\s+in\s*\(([^)]*)\)\s*\)\s+not\s+valid/i,
  );
  const expectedProducers = [...PRODUCERS].sort();
  if (!/producer\s+text\s+not\s+null\s+default\s+'openrouter_seedance'/i.test(source)
    || !/alter\s+table\s+public\.ghost_agency_hero_reel_jobs\s+alter\s+column\s+producer\s+set\s+default\s+'openrouter_seedance'/i.test(source)
    || !producerConstraint
    || !producerMigration
    || !arraysEqual(extractQuotedLiterals(producerConstraint[1]).sort(), expectedProducers)
    || !arraysEqual(extractQuotedLiterals(producerMigration[1]).sort(), expectedProducers)) {
    throw new SchemaSafetyError("producer_contract_mismatch");
  }

  return Object.freeze({
    statements: statements.length,
    tables: 1,
    indexes: expectedIndexes.size,
    sha256: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
  });
}

function requireExactTarget(actual, expected, seen, category) {
  if (actual !== expected) throw new SchemaSafetyError(`unexpected_${category.split(":")[0]}_target`);
  if (seen.has(category)) throw new SchemaSafetyError(`duplicate_${category.split(":")[0]}_statement`);
  seen.add(category);
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
  return left.length === right.length && left.every((value, offset) => value === right[offset]);
}

async function verifySchema(client) {
  const columns = rowsOf(await client.query(`/* hero_reel_schema:columns */
    select a.attnum as ordinal_position,
           a.attname as column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           a.attidentity as identity_kind,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public'
       and c.relname = $1
       and c.relkind in ('r', 'p')
       and a.attnum > 0
       and not a.attisdropped
     order by a.attnum`, [TABLE]));
  verifyColumns(columns);

  const constraints = rowsOf(await client.query(`/* hero_reel_schema:constraints */
    select x.conname as constraint_name,
           x.contype as constraint_type,
           pg_catalog.pg_get_constraintdef(x.oid, true) as definition
      from pg_catalog.pg_constraint x
      join pg_catalog.pg_class c on c.oid = x.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = $1
     order by x.conname`, [TABLE]));
  verifyConstraints(constraints);

  const indexes = rowsOf(await client.query(`/* hero_reel_schema:indexes */
    select i.relname as index_name,
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
       and t.relname = $1
     order by i.relname`, [TABLE]));
  verifyIndexes(indexes);

  const access = rowsOf(await client.query(`/* hero_reel_schema:access */
    select c.relrowsecurity as rls_enabled,
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
       and c.relname = $1
       and c.relkind in ('r', 'p')`, [TABLE]));
  verifyAccess(access);

  const sequenceAccess = rowsOf(await client.query(`/* hero_reel_schema:sequence */
    select c.relname as sequence_name,
           pg_catalog.has_sequence_privilege('service_role', c.oid, 'USAGE') as service_usage,
           pg_catalog.has_sequence_privilege('service_role', c.oid, 'SELECT') as service_select,
           pg_catalog.has_sequence_privilege('service_role', c.oid, 'UPDATE') as service_update,
           (pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE')
             or pg_catalog.has_sequence_privilege('anon', c.oid, 'SELECT')
             or pg_catalog.has_sequence_privilege('anon', c.oid, 'UPDATE')) as anon_any,
           (pg_catalog.has_sequence_privilege('authenticated', c.oid, 'USAGE')
             or pg_catalog.has_sequence_privilege('authenticated', c.oid, 'SELECT')
             or pg_catalog.has_sequence_privilege('authenticated', c.oid, 'UPDATE')) as authenticated_any,
           exists (
             select 1
               from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))) acl
              where acl.grantee = 0
                and acl.privilege_type = any(array['USAGE', 'SELECT', 'UPDATE'])
           ) as public_any
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = $1
       and c.relkind = 'S'`, [SEQUENCE]));
  verifySequenceAccess(sequenceAccess);

  const policies = rowsOf(await client.query(`/* hero_reel_schema:policies */
    select policyname as policy_name
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = $1
     order by policyname`, [TABLE]));
  if (policies.length !== 0) throw new SchemaSafetyError("unexpected_rls_policy");

  return Object.freeze({
    tables: 1,
    columns: columns.length,
    constraints: constraints.length,
    indexes: indexes.length,
    sequences: sequenceAccess.length,
    rlsPolicies: policies.length,
  });
}

function rowsOf(result) {
  if (!result || !Array.isArray(result.rows)) throw new SchemaSafetyError("invalid_database_response");
  return result.rows;
}

function verifyColumns(rows) {
  if (rows.length !== EXPECTED_COLUMNS.length) throw new SchemaSafetyError("column_count_mismatch");
  for (let offset = 0; offset < EXPECTED_COLUMNS.length; offset += 1) {
    const expected = EXPECTED_COLUMNS[offset];
    const actual = rows[offset];
    if (Number(actual.ordinal_position) !== offset + 1
      || actual.column_name !== expected.name
      || String(actual.data_type).toLowerCase() !== expected.type
      || Boolean(actual.not_null) !== expected.notNull
      || String(actual.identity_kind || "") !== expected.identityKind
      || normalizeDefault(actual.default_expression) !== expected.defaultExpression) {
      throw new SchemaSafetyError("column_definition_mismatch");
    }
  }
}

function verifyConstraints(rows) {
  if (rows.length !== Object.keys(EXPECTED_CONSTRAINTS).length) {
    throw new SchemaSafetyError("constraint_count_mismatch");
  }
  for (const [name, expected] of Object.entries(EXPECTED_CONSTRAINTS)) {
    const actual = rows.find((row) => row.constraint_name === name);
    if (!actual || actual.constraint_type !== expected.type) {
      throw new SchemaSafetyError("constraint_missing_or_wrong_type");
    }
    const normalized = normalizeSqlExpression(actual.definition);
    if (expected.exact && normalized !== expected.exact) {
      throw new SchemaSafetyError("constraint_definition_mismatch");
    }
    if (expected.enumColumn
      && !normalized.includes(`${expected.enumColumn} = any array`)
      && !normalized.includes(`${expected.enumColumn} in `)) {
      throw new SchemaSafetyError("constraint_definition_mismatch");
    }
    if (expected.quotedValues
      && !arraysEqual(extractQuotedLiterals(actual.definition).sort(), expected.quotedValues)) {
      throw new SchemaSafetyError("constraint_values_mismatch");
    }
  }
}

function verifyIndexes(rows) {
  if (rows.length !== Object.keys(EXPECTED_INDEXES).length) throw new SchemaSafetyError("index_count_mismatch");
  for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
    const actual = rows.find((row) => row.index_name === name);
    const columns = actual && Array.isArray(actual.key_columns)
      ? actual.key_columns.map((value) => normalizeSqlExpression(value))
      : [];
    if (!actual
      || Boolean(actual.is_unique) !== expected.unique
      || !arraysEqual(columns, expected.columns)
      || !expected.predicate(actual.predicate)) {
      throw new SchemaSafetyError("index_definition_mismatch");
    }
  }
}

function verifyAccess(rows) {
  if (rows.length !== 1) throw new SchemaSafetyError("table_or_rls_missing");
  const row = rows[0];
  if (row.rls_enabled !== true || row.force_rls !== false) {
    throw new SchemaSafetyError("rls_configuration_mismatch");
  }
  for (const privilege of ["service_select", "service_insert", "service_update"]) {
    if (row[privilege] !== true) throw new SchemaSafetyError("service_role_grant_missing");
  }
  for (const privilege of [
    "service_delete",
    "service_truncate",
    "service_references",
    "service_trigger",
    "anon_any",
    "authenticated_any",
    "public_any",
  ]) {
    if (row[privilege] !== false) throw new SchemaSafetyError("unexpected_table_privilege");
  }
}

function verifySequenceAccess(rows) {
  if (rows.length !== 1 || rows[0].sequence_name !== SEQUENCE) {
    throw new SchemaSafetyError("identity_sequence_missing");
  }
  const row = rows[0];
  if (row.service_usage !== true || row.service_select !== true) {
    throw new SchemaSafetyError("service_role_sequence_grant_missing");
  }
  for (const privilege of ["service_update", "anon_any", "authenticated_any", "public_any"]) {
    if (row[privilege] !== false) throw new SchemaSafetyError("unexpected_sequence_privilege");
  }
}

function loadPgClient(modulePath) {
  for (const candidate of [modulePath, "pg"].filter(Boolean)) {
    try {
      const loaded = require(candidate);
      if (loaded && typeof loaded.Client === "function") return loaded.Client;
    } catch {
      // Driver errors can include local paths. Try the next candidate silently.
    }
  }
  throw new SchemaSafetyError("pg_driver_unavailable");
}

function createDatabaseClient(config) {
  const Client = loadPgClient(config.pgModulePath);
  return new Client({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false },
    application_name: "ghost-hero-reel-schema-v1",
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
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '45s'");
    if (apply) {
      await client.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ghost-hero-reel-schema-v1', 0))");
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
  for (const flag of flags) {
    if (!["--apply", "--verify"].includes(flag)) throw new SchemaSafetyError("unknown_argument");
  }
  if (flags.has("--apply") && flags.has("--verify")) throw new SchemaSafetyError("conflicting_modes");

  const readFileSync = dependencies.readFileSync || fs.readFileSync;
  const sql = readFileSync(dependencies.schemaFile || SCHEMA_FILE, "utf8");
  const safety = assertSafeSql(sql);
  const stdout = dependencies.stdout || process.stdout;
  if (!flags.has("--apply") && !flags.has("--verify")) {
    stdout.write(`DRY_RUN_OK tables=${safety.tables} indexes=${safety.indexes} statements=${safety.statements} sha256=${safety.sha256}\n`);
    stdout.write("NO_DATABASE_CONNECTION NO_CHANGES\n");
    return Object.freeze({ mode: "dry-run", safety });
  }

  const config = loadSecureConfig({
    env: dependencies.env || process.env,
    ...(Object.prototype.hasOwnProperty.call(dependencies, "envFile")
      ? { envFile: dependencies.envFile }
      : {}),
    readFileSync,
    existsSync: dependencies.existsSync || fs.existsSync,
  });
  const createClient = dependencies.createClient || createDatabaseClient;
  const apply = flags.has("--apply");
  const summary = await runDatabaseAction(createClient(config), sql, apply);
  stdout.write(`${apply ? "APPLY" : "VERIFY"}_OK tables=${summary.tables} columns=${summary.columns} constraints=${summary.constraints} indexes=${summary.indexes} sequences=${summary.sequences} rls_policies=${summary.rlsPolicies}\n`);
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
  ENV_FILE_VARIABLE,
  SCHEMA_FILE,
  TABLE,
  SEQUENCE,
  PRODUCERS,
  STATUSES,
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
  verifySequenceAccess,
};
