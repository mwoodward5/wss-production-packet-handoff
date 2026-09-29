# External advisory auditors

These six files were supplied by the owner from Opus. Local Windows verification: 33 tests discovered, 32 passed, 1 skipped because symlink creation was unavailable, 0 failed. The traversal assertions preceding the skip ran, but symlink escape protection remains unverified on this host.

Run from repository root:

```
node --test work/perplexity-package/service-label-audit.test.cjs work/perplexity-package/catalog-audit.test.cjs work/perplexity-package/packet-audit.test.cjs
node work/perplexity-package/catalog-audit.cjs --root=render-v2 --catalog=render-v2/categories/donor-catalog.json
```

The real catalog audit found 34 entries and 24 missing content_render_targets declarations. Treat this as static evidence, not proof of production readiness. Initial snapshot packaging omitted three TTF fonts; those files were restored from the original donor bundle before publication.

These modules are advisory, not production admission law. Independently review their contracts against the actual compiler and renderer before integrating. Label heuristics cannot establish source authenticity. Packet byte consistency cannot establish factual truth. Catalog declarations cannot establish rendered browser content. Do not loosen production safeguards merely to satisfy these auditors.
