# Reviewed-knowledge case-reference retention — draft

Expired internal case references must not remain indefinitely just because nobody runs a manual cleanup. This extends the existing reviewed-fact store; it does not publish facts or collect conversations.

## Integrated path

- After database schema initialization, before Discord login, start one tracked cleanup pass. This mandatory metadata deletion is independent of the memory and fix-inbox publication switches. Normal inbox-off answer lookup still performs no optional registry work.
- Select up to 101 affected facts across guilds and examine at most 100 per pass. Reuse fresh-row transactions and the existing guild erasure locks. Remove expired provenance only; preserve fact content, validation, approval, publication/revocation state and timestamps.
- Delete at most 1,000 expired erasure barriers per pass. Recheck expiry on the deleted row, not just the candidate list, so renewed barriers remain protected. The customer-ownership privacy adapter is still unimplemented; this worker is not an authorization API.
- Continue a remaining backlog after 250 ms; wait 60 seconds when idle or after failure. Coalesce local overlapping calls and unref timers. Failed passes emit only `[KnowledgeReview] retention cleanup unavailable; pending retry`, never raw errors or identifiers.
- Shutdown clears future timers and checks for stopping between fact mutations. In-flight work participates in the existing runtime drain. This does not establish a new global exactly-once or fixed shutdown-duration guarantee.
- Cleanup queries and fact mutations use transaction-local five-second server statement/lock deadlines; ordinary query settings are unchanged. Existing pool connection acquisition remains bounded. These are not client network cancellation or a five-second whole-batch deadline.

`examined` counts fact mutation attempts, not deleted references. `barriersDeleted` counts confirmed barrier rows. A full barrier batch can require one extra empty pass. Different bot instances may sweep concurrently; row/guild locking protects state rather than assuming a global singleton.

## Verification and limits

The integrated baseline merges deployed main `5bafe93` into #49 as `141e718`, preserving reference-only memory, ordinary-answer language storage and the memory-off prompt guard. That baseline passes 869 unit tests and combined isolated SQL checks.

Nine new focused checks cover global expiry, 100-fact batching, active barriers, stopping between mutations, the outer SQL expiry predicate, controlled timer scheduling, fixed failure logs, shutdown and startup wiring. Seven tests were observed failing before implementation; the outer-predicate assertion failed before its repair. The additional stop-between-facts check is not claimed as red-before evidence. Timer tests drive callbacks instead of depending on machine speed. Startup/query-shape assertions are not live deployment tests.

The guarded database verifier adds 103 synthetic facts across guilds, checks 100/3 bounded passes, preserves eligible facts and active erasure barriers, races cleanup with revocation, recreates the store, verifies idempotence and checks that the statement timeout does not leak. Loading the pre-cleanup store into the new verifier fails, as expected. Local PGlite is serial evidence; hosted real PostgreSQL must separately verify multi-connection behavior.

This remains an unreviewed, undeployed foundation. Official-evidence/semantic/regression validation, owner-scoped mistake signals, review cards and controls, privacy-workflow ownership checks, nightly regression alerts and weekly scorecards remain open. No memory/context/fix-inbox enablement, paid evaluation, protected-input read, Discord message, production database operation or deployment is part of this change.
