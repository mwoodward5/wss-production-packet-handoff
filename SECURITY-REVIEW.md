# Snapshot publication review

The source snapshot was checked with Gitleaks 8.30.1 and an independent read-only review. This was not a zero-finding scan: 108 findings were classified, primarily synthetic redaction-test strings, identifiers and file-hash maps. No confirmed privileged API key was found among those findings.

Publication excludes `compiler/factory/proof/` (214 archived production proof files), environment files, credential folders and live databases. Two operational UUID token fields in fixtures were replaced with a fixed synthetic UUID: Burns `claim_token` and the golden recipe's `report_token`. Original source files on the host were not changed by this sanitization.

The legacy tattoo client bundle includes a Supabase public anon JWT. It is a public client identifier, not a service-role key; this review does not validate the remote database's access policy. Test secret-shaped strings are retained because they test redaction. No credential values are reproduced in this report.

The repository is private. Do not add production secrets or enable customer sends. Source tests and this review do not establish production readiness.
