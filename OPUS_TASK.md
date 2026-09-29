# Implement the remaining WSS production integration

## Objective

Make WSS consume full PageHub Intake Genie packets across every supported category in the pruned 34-donor catalog, preserving source truth and fail-closed gates. Deliver implementation and tests in a PR. Local production deployment, real-row proof, publishing and owner email are performed by Codex after review.

## 1. Repair the shared direct/import request contract first

Read:

- `backend/apps/backend/lib/intake-genie-client.js`
- `backend/apps/backend/lib/line-adapters.js`
- `backend/apps/backend/lib/pagehub-build-packet.js`
- `backend/apps/backend/api/admin/intake-packet-v2.js`
- `backend/apps/backend/test/packet2-import-seam.test.js`
- `backend/apps/backend/test/packet2-line-admission.test.js`
- `backend/apps/backend/test/packet2-row-bind-external.test.js`
- `pagehub/api/intake-genie-compile.js`
- `pagehub/api/lib/packet2-import.js`
- `pagehub/tests/packet2-import.test.js`

Existing direct selected-template ID:
`ghost:<prospect_id>:template:single-cinematic-motion:line-genie-certified-v7`

Existing import ID still expected:
`ghost:<prospect_id>:line-genie-certified-v7`

Both requests currently inherit LeadMiner `prospect_hints.services`. PageHub correctly rejects these as unverified request corrections. Some hint values are slogans rather than services.

Required:

1. Explicit PageHub selected-template direct requests omit service hints. Ordinary SiteForge requests preserve their current behavior.
2. Packet2 import derives its template only from the immutable snapshot, never from the ambient direct-template environment. Validate allowed IDs using the PageHub UI/API contract.
3. Direct and import requests use identical canonical fields and template-scoped identity. PageHub accepts that exact scoped identity only when prospect ID, pipeline version, selected template, snapshot template and embedded intakeRequest agree.
4. Retain exact snapshot bytes/hash, embedded request equality, archived source integrity, same-business/domain/fresh-source checks, aggregate visitor quality and no-unverified-corrections checks.
5. Never mutate a saved snapshot to make it match. Generate fresh exact-request fixtures.
6. Negative tests: wrong row, wrong domain, wrong template, altered byte/hash, conflicting source, stale receipt, unverified hints, and review/block quality all refuse. Keep the Perplexity row A/B binding regression passing.

Template passthrough and direct receipt template-cache checks are already implemented in current source. Inspect and reuse them; do not duplicate or erase them.

## 2. Support genuine manual/email Packet2 safely

The current importer is effectively a WSS URL-first replay gate. Manual UI/email packets may have another original request ID or no intakeRequest. Do not silently force them through the direct replay contract.

Implement a separate explicit import envelope that preserves the original immutable Packet2 and binds it to the requested target prospect through exact source/domain identity, archived content integrity, fresh source verification and clean visitor quality. Bind snapshot hash plus target identity in the resulting signed certification. Do not trust a user-written verified flag or merely matching business name. Missing source evidence must refuse with a useful reason. Add adversarial tests for cross-business reuse and snapshot mutation. If the available schema cannot securely support a historical packet, return an exact unavailable reason and document the missing evidence; do not fabricate it.

## 3. Finish category-wide donor contracts

Catalog: `render-v2/categories/donor-catalog.json`.
Donors: `render-v2/donors/catalog/<key>/`.

Preserve exactly the 34 retained donors. There are 18 installed categories; 16 overlap the larger 40-category target list. Do not re-add removed generic scaffolds or claim 40-category readiness.

Check every retained donor's mapping, runtime trade/category guard, per-service markdown consumption, bundle pins and auditable content_render_targets. A mapping must not accept a packet that its actual runtime refuses. Declare only selectors that visibly render the source-backed content. Missing reviews/hours/FAQs/areas stay unavailable. Never add invented reviews or claims to pass a content floor.

Known implemented repairs: donor06 mapping now matches its stricter service-name guard; generic source-backed Okie services route to donor50. Electrical05/38 and fencing42/49 have new native service targets. The proof baseline uses trade-compatible sentinel text. Verify these changes rather than repeating them.

Known bad input: the saved Texas Urban Elements packet is labeled fencing but contains patio/hardscape/drainage services and no fence service. Correct refusal is expected; do not loosen fencing mappings to accept it.

Provide a matrix for all 18 categories with installed donors, source/binding coverage, actual tested fixture, proof result and exact blocker. Distinguish synthetic contract tests from real source-backed browser proofs. Do not mark runtime/visual eligibility true from static tests alone.

## 4. Preserve actual Genie content and mode

The direct PageHub API previously forced a multi-page plan. Current source accepts `selectedTemplateId=single-cinematic-motion` and outputs a Home-only plan. Match requested mode to donor needs; do not globally truncate every packet or substitute category defaults.

The latest Custom Lawn single-page dry run had 7 services, 1 FAQ, 19 visitor files and 4,768 visitor words; its manual request ID prevented import. Okie originally included slogans as services; current local source replay rejects those and retains source-offered noun phrases. Verify with exact fixtures and negative tests. Preserve full private source archives while selecting only supported public copy.

## 5. Verification and deliverables

The owner's six external audit files are in `work/perplexity-package/`. Read its README, run them, and review their contracts before using them. They are advisory. Their local result was 32 passed, 1 Windows symlink test skipped, 0 failed. The catalog audit found 24 missing channel declarations across the 34 retained donors.

Use existing runners:

- Backend, from `backend/apps/backend/`: `npm test`; `GHOST_AGENCY_LIGHT_VERIFICATION=0 npm run test:mirror-engine`; focused Packet2 tests above.
- PageHub: `node --test tests/*.test.*` (inspect existing test extensions and execute the complete applicable suite).
- Render V2: `npm test` and `npm run check`.
- Compiler: `npm test` and `npm run build` when compiler changes are necessary.

Install declared dependencies normally if needed. Do not use production secrets. If a test requires unavailable host-only browser tooling or live infrastructure, report it precisely and still run all available offline checks. Do not change tests to hide product failures.

Return a PR with code and tests, exact files, pass/fail counts, category coverage, remaining live verification, and a concise integration sequence. Do not merge or deploy. If GitHub writing is unavailable, return complete unified diffs for all changed files instead. Reports alone do not complete this task.
