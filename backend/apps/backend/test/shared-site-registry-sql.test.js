"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SQL_PATH = path.join(__dirname, "../supabase/shared-site-releases.sql");
const sql = fs.readFileSync(SQL_PATH, "utf8");

function functionBlock(schema, name) {
  const marker = `create or replace function ${schema}.${name}(`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `${schema}.${name} must exist`);
  const tail = sql.slice(start + marker.length);
  const next = tail.search(/\ncreate or replace function\s/i);
  return next === -1 ? sql.slice(start) : sql.slice(start, start + marker.length + next);
}

test("stable identity RPC owns one canonical slug and wildcard host", () => {
  const body = functionBlock("ghost_agency_private", "ensure_shared_site_identity");
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = ''/i);
  assert.match(body, /p_normalized_host is distinct from p_canonical_slug \|\| '\.wss-ai\.com'/i);
  assert.match(body, /pg_advisory_xact_lock[\s\S]*hashtextextended/i);
  assert.match(body, /where canonical_slug = p_canonical_slug[\s\S]*for update/i);
  assert.match(body, /where normalized_host = p_normalized_host[\s\S]*for update/i);
  assert.match(body, /v_site_id := pg_catalog\.gen_random_uuid\(\)/i);
  assert.match(body, /values \(\s*p_normalized_host, v_site_id, 'pending', false\s*\)/i);
  assert.match(body, /v_host\.site_id is distinct from v_site_id/i);
  assert.match(body, /v_host\.tombstoned_at is not null or v_host\.status = 'retired'/i);
  assert.match(body, /'site_id', v_site_id[\s\S]*'generation', v_site\.generation/i);
  assert.doesNotMatch(body, /delete from|on conflict[\s\S]*do update/i);

  const wrapper = functionBlock("public", "ensure_shared_site_identity");
  assert.match(wrapper, /security invoker/i);
  assert.doesNotMatch(wrapper, /security definer/i);
});

test("generation read is exact and returns the active immutable proof tuple", () => {
  const body = functionBlock("ghost_agency_private", "read_shared_site_generation");
  assert.match(body, /stable/i);
  assert.match(body, /s\.site_id = p_site_id/i);
  assert.match(body, /s\.canonical_slug = p_canonical_slug/i);
  assert.match(body, /h\.normalized_host = p_normalized_host/i);
  assert.match(body, /p_normalized_host = p_canonical_slug \|\| '\.wss-ai\.com'/i);
  assert.match(body, /h\.status in \('pending', 'active'\)/i);
  assert.match(body, /h\.tombstoned_at is null/i);
  assert.match(body, /release_id = v_site\.active_release_id/i);
  assert.match(body, /state = 'active'/i);
  assert.match(body, /active_host\.status = 'active'[\s\S]*active_host\.is_primary[\s\S]*active_host\.tombstoned_at is null/i);
  for (const key of [
    "site_id",
    "canonical_slug",
    "canonical_host",
    "generation",
    "active_release_id",
    "active_build_hash",
    "active_manifest_path",
    "active_manifest_sha256",
    "active_published_generation",
    "active_deployment_env",
  ]) assert.match(body, new RegExp(`'${key}'`, "i"), `${key} must be returned`);
  assert.doesNotMatch(body, /insert into|update public|delete from/i);
});

test("stage and verify retries accept only the identical immutable tuple", () => {
  const stage = functionBlock("ghost_agency_private", "stage_site_release");
  for (const predicate of [
    "site_id = p_site_id",
    "build_hash = p_build_hash",
    "manifest_path = p_manifest_path",
    "manifest_sha256 = p_manifest_sha256",
    "canonical_host = p_canonical_host",
    "published_generation = p_published_generation",
    "deployment_env = p_deployment_env",
  ]) assert.match(stage, new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(stage, /v_existing\.state in \('staged', 'verified', 'active', 'retired'\)/i);
  assert.match(stage, /'idempotent', true/i);
  assert.match(stage, /release_identity_conflict/i);
  assert.doesNotMatch(stage, /on conflict[\s\S]*do update/i);

  const verify = functionBlock("ghost_agency_private", "verify_site_release");
  assert.match(verify, /and state = 'staged'/i);
  assert.match(verify, /v_existing\.state in \('verified', 'active', 'retired'\)/i);
  assert.match(verify, /'idempotent', true/i);
  assert.match(verify, /release_verify_cas_refused/i);
});

test("activation and rollback replay exact completed CAS before conflict", () => {
  const activate = functionBlock("ghost_agency_private", "activate_site_release");
  const activateReplay = activate.indexOf("v_site.generation = p_expected_generation + 1");
  const activateConflict = activate.indexOf("v_site.generation <> p_expected_generation");
  assert.ok(activateReplay >= 0 && activateReplay < activateConflict);
  assert.match(activate, /v_site\.active_release_id = p_release_id/i);
  assert.match(activate, /v_site\.serve_mode = 'shared'/i);
  assert.match(activate, /published_generation = p_expected_generation \+ 1/i);
  assert.match(activate, /deployment_env = p_deployment_env/i);
  assert.match(activate, /state = 'active'/i);
  assert.match(activate, /status = 'active'[\s\S]*is_primary[\s\S]*tombstoned_at is null/i);

  const rollback = functionBlock("ghost_agency_private", "rollback_site_release");
  const rollbackReplay = rollback.indexOf("v_site.generation = p_expected_generation + 1");
  const rollbackConflict = rollback.indexOf("v_site.generation <> p_expected_generation");
  assert.ok(rollbackReplay >= 0 && rollbackReplay < rollbackConflict);
  assert.match(rollback, /v_site\.active_release_id = p_release_id/i);
  assert.match(rollback, /v_site\.previous_release_id is not null/i);
  assert.match(rollback, /published_generation < p_expected_generation \+ 1/i);
  assert.match(rollback, /deployment_env = p_deployment_env/i);
  assert.match(rollback, /'idempotent', true/i);
});

test("public resolver exposes the immutable active release generation, not the mutable CAS generation", () => {
  const resolver = functionBlock("ghost_agency_private", "resolve_shared_site");
  assert.match(resolver, /r\.deployment_env, r\.published_generation/i);
  assert.doesNotMatch(resolver, /r\.deployment_env, s\.generation/i);
});

test("new RPCs remain service-role-only behind invoker wrappers", () => {
  const signatures = [
    ["ensure_shared_site_identity", "text, text"],
    ["read_shared_site_generation", "uuid, text, text"],
  ];
  for (const [name, signature] of signatures) {
    const privateBody = functionBlock("ghost_agency_private", name);
    const wrapper = functionBlock("public", name);
    assert.match(privateBody, /security definer/i);
    assert.match(privateBody, /set search_path = ''/i);
    assert.match(wrapper, /security invoker/i);
    assert.match(
      sql,
      new RegExp(`revoke all on function ghost_agency_private\\.${name}\\(${signature}\\) from public, anon, authenticated, service_role`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${name}\\(${signature}\\) from public, anon, authenticated, service_role`, "i"),
    );
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role`, "i"));
  }

  for (const table of ["ghost_agency_sites", "ghost_agency_site_hosts", "ghost_agency_site_releases"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`, "i"));
  }
  assert.match(sql, /values \('wss-site-releases', 'wss-site-releases', false, 67108864\)/i);
  assert.doesNotMatch(sql, /create policy[^;]+on storage\.objects/i);
});
