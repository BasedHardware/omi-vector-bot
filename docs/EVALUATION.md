# Mira evaluation guide

Use synthetic cases and preserve the tested commit, complete results, configuration and source provenance. A structural pass rate is not a whole-product accuracy score. Read the [quality contract](ANSWER_QUALITY_CONTRACT.md) and [stage-evidence limits](ANSWER_STAGE_EVIDENCE.md).

## Checks without provider quota

```sh
npm test
EVAL_NO_MODEL=1 node scripts/customer-eval.js
```

CI runs these on Node20/24 and runs `node scripts/verify-support-db.js` against a disposable local PostgreSQL service. The verifier refuses non-local/non-test database URLs. These SQL fixtures exercise persistence, concurrency, erasure and recovery; they do not use the production database or customer data.

## Deliberate provider-backed evaluation

Only run this after the required quota authorization:

```sh
node scripts/live-eval.js --runs 3 --concurrency 2
```

It uses the configured CommandCode key/models and spends quota. `--root /absolute/path/to/checkout` evaluates a separate commit checkout; keep harness/model/concurrency/configuration identities aligned when comparing arms. Results include replies, stage times and structural outcomes in ignored `eval/results/`. Keep failures, unavailable responses and inconsistent runs in the record; do not overwrite or selectively rerun them to get a pass. Protected cases stay outside the repository and must not be read or used without their separate authorization.

The harness invokes the real handler/answer path but **stubs Discord and staff delivery**. It does not log into Discord, verify staff receipt, look up private orders or publish GitHub issues. It loads public official Help Center/website pages and applies production chunking/ranking **in memory**; it does **not** exercise production PostgreSQL storage or the `fill-db` scheduler. The separate SQL fixtures cover their own isolated database boundaries. Neither check alone proves production delivery, configuration or customer resolution.

Live official sources can change between runs. Record corpus/source identity and execution health; temporally separate arms can experience different docs/provider outages. A missing model usage record or an unavailable fallback is not successful generated-answer evidence. Preserve execution limitations and obtain independent factual, safety, coverage and handoff review before readiness. Stage fingerprints help locate future loss but cannot reconstruct intermediate text never recorded historically.

## Release checks

Use the [runbook](RUNBOOK.md) for exact-commit deployment, verified rollback, health and scoped smokes. Aryan performs Discord inputs/buttons. A synthetic staff-delivery or private-preview test does not authorize publishing a new public Omi issue. Passing evals does not enable memory or authorize a paid rerun.
