# Memory pilot checks — test-only rehearsal

This closes a test-coverage gap, not the memory rollout gate. Storage and live-context unit tests existed separately; the SQL verifier now joins the production SQL adapter, memory service and context reader in one synthetic flow. Runtime code, prompts, schema, settings and dependencies are unchanged.

## Automated rehearsal

`scripts/verify-support-db.js` invokes `scripts/verify-memory-context.js` against its existing guarded, dedicated local test database. The existing hosted Postgres job runs the same checks; `--pglite` remains a serialized local alternative, not concurrency proof. Discord posts/messages are deterministic local fixtures. No real Discord or provider calls, credentials, customer data or protected cases are needed.

Eight asserted groups cover:

1. Two prior posts from the same owner/guild/forum, latest three owner references plus one bot reply, staff-chatter exclusion, and `conversation_only`/`previous_post` markers.
2. Recreated SQL adapter/service/reader and current uncached live edits, not stored message copies.
3. Rejection of another participant and a prior post whose live owner changed.
4. Confirmed message deletion removing the SQL pointer and invalidating its stored outcome.
5. Context-off preventing live reads, with forum-wide erasure still available while capture is off.
6. Forgetting all of the owner's forum references, preserving other scopes and suppressing later capture after reader recreation.
7. Creation-based expiry cleanup while off, without silently expiring the opt-out.
8. No fixture text or encryption fields in any memory SQL table, checked **before erasure**, after a live edit and after cleanup.

The private sensitivity run passes the real baseline and rejects five in-memory faults: disconnected reader, missing requester-owner guard, cached live reads, stale outcome after deletion and successful-but-no-op erasure. Repository/runtime files are not modified by these probes. These are test-sensitivity results, not observed production defects or five new runtime fixes.

## What remains unproved

- PGlite does not verify multi-connection PostgreSQL behavior; the hosted database job must pass at the exact head.
- This fixture does not generate an answer or prove that an assistant avoids repeating advice. Existing prompt/handler tests remain separate; enabled generated-answer behavior still needs the approved test-forum scenario.
- The existing timeout/capacity/injection and off-only prompt-parity regressions remain required. This rehearsal does not replace them or introduce a new held-out comparison waiver.
- Reader recreation is not a full bot/platform restart. The live pilot still needs the approved restart, edit/delete, forgetting, expiry, timeout and kill-switch checks, plus at least 48 clean hours. Elapsed time alone is not a pass.
- Retention approval is already recorded. Processor restrictions, backup erasure, security, accurate notice/policy and any required platform review still gate data use. This test does not approve them or switch anything on.

Keep the full C1–C4 acceptance items open and memory/context/fix-inbox off. No merge, deployment, public-forum expansion or training follows from passing this rehearsal. The current canonical product/release status is maintained separately in the master-plan status PR; older deployment checkpoints on this main-based test branch are historical.
