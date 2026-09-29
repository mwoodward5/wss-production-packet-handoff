# WSS production packet repair — current source handoff

This private source snapshot is for completing the WSS PageHub Packet2 → certified prospect → Render V2 → owner-only sandbox pipeline. It is **not a claim that production is ready**.

## Start here

Read `OPUS_TASK.md`, then the current source. Work on a branch and return a PR. Do not deploy, send email, start a campaign, or change production credentials. Codex owns local integration and live proof.

## Source layout

| Directory | Original checkout |
| --- | --- |
| `backend/` | `C:\ghx-localfirst` (monorepo layout preserved) |
| `pagehub/` | `C:\ghx-genie` |
| `compiler/` | `C:\ghx-intake-compiler` |
| `render-v2/` | `C:\Users\Main\ZCodeProject\wss-render-v2` |

`SOURCE-MANIFEST.json` records source baseline commits and the SHA256 of each copied current file. This includes uncommitted task edits; it is not an archive of HEAD alone. The retained catalog contains 34 donors across 18 categories. Rejected donors are excluded. Dependencies, credentials, environment files, live databases and production prospect exports are excluded. Some tests intentionally contain fake secret-shaped strings to verify redaction.

## Last verified live boundary

- Backend: `wss-local-backend:packet-depth-v17-20260929`, image `sha256:239c3f5fbbb4d4213647ec66b795f5affc326f8f899274ae056cd6bbbfc5ae6a`.
- Compiler: v16 locality repair, image `sha256:1db0f59c32824651ab3678d531fb506706a444f66973948f67265a104907ba9e`.
- Customer sends OFF; zero active batches; PageHub import URL not globally enabled.
- Backend v16 was rolled back after a missing landscaping mapping module was found. v17 passed actual in-image renderer module loads and a detached Custom Lawn content/media proof.
- No fresh PageHub packet has yet been staged and certified on the two production proof rows. No owner email has been sent for this repair.
- Current source includes later template/cache and electrical/fencing changes that are not in live backend v17.

## Tests already run in source checkouts

- PageHub full suite: 231 passed.
- Compiler: 674 passed, 3 skipped; build passed.
- Render V2: 72 passed; check passed.
- Backend Packet2 focused suite: 11 passed, including Perplexity's row A/B binding test.
- Backend mirror suite with `GHOST_AGENCY_LIGHT_VERIFICATION=0`: 781 passed.
- Backend `npm test`: passed after correcting the test URL fixture from rejected `.test` to reserved `example.com`.

These results predate the requested remaining contract repair. Re-run relevant tests after changes. A missing dependency in the clean handoff must be repaired or clearly reported; do not silently skip a required test.

## Exact current blocker

New direct PageHub requests use template-scoped IDs, but the import branch and PageHub importer still expect unscoped IDs. Backend requests also carry unverified LeadMiner service hints, which the importer correctly refuses. Fix the shared request contract before generating more packets. Never edit an immutable saved snapshot to force an ID match.

Historical manually generated/email Packet2 import is also unproven. The existing importer is a strict WSS URL-first replay gate. The full objective includes a safe source-bound path for those historical packets; do not declare that solved by only fixing new direct requests.
