# Forgetting reviewed-correction links — draft

Problem: the memory deletion command clears references/outcomes and saves an opt-out, but does not remove the same customer's internal links in the reviewed-fact registry. This draft connects those paths; it does not enable memory or learning.

## One scoped deletion path

1. The command checks the acting Discord user against the current support-post owner. The existing memory scope checks restrict the request to configured help/test forums, not handoff posts. No customer-supplied case list is accepted.
2. Commit the existing forum-wide memory erasure and permanent owner/forum opt-out first. That remains effective even if later correction-link cleanup fails.
3. Look up internal references using stored case ownership, server and forum metadata. Remove only verified matching links from all fact versions, preserving independent product text, approval, validation, publication/revocation and timestamps. Preserve other owners, known other forums and other servers.
4. Require the durable opt-out before erasure. Serialize through the existing guild erasure lock and fresh fact rows. The normal registry writer also checks that opt-out against authoritative case metadata, preventing late writes and new matching cases from restoring forgotten links.
5. Use the same mandatory retention worker to retry stored references covered by an opt-out. Synchronous work is limited to ten passes of 100 facts, with at most 1,000 candidate case IDs and 1,000 redundant erasure barriers per pass. An incomplete pass or database failure never becomes a complete-deletion response.

Only the existing minimal permanent owner/forum opt-out is needed for this fence. Confirmed owned case-specific deletion barriers are removed rather than retaining unnecessary case identifiers. The generic internal case-erasure helper retains its existing separate semantics. There is no second opt-out table or retained message copy.

Cleanup SQL has transaction-local five-second server statement/lock deadlines. Those are not client network cancellation, a whole-command deadline or a guaranteed shutdown time. A failed correction-link cleanup emits fixed metadata only. Production errors never select an in-memory registry fallback. Isolated development without a configured durable registry is explicitly separate.

## Case ownership metadata and legacy limits

Add nullable `guild_id` and `forum_id` to existing support cases; retain every existing case and lifecycle field. The answer path derives them from the existing configured-forum/post-owner checks, independently of optional capture flags. Store identifiers only, never message text. Subsequent calls cannot rebind a known case to another server/forum. A live, owner-scoped ordinary-post event can fill a previously empty pair; the migration itself invents no scope.

The erasure adapter refuses a complete-deletion claim when a candidate link lacks a case record or the required stored scope. It does not guess forum membership or delete another person's unidentified link. The opt-out and memory deletion still persist. The automatic sweep follows the same strict scope requirement: unscoped legacy/orphan links need verified operator reconciliation or ordinary expiry, not an invented forum match. This limitation is an enablement/review gate, not a claim of universally complete legacy erasure.

Operational support cases, independently sourced product facts, Discord messages, backups and other support systems are not deleted by this command. It is not an account-deletion endpoint. The existing private command wording and all normal answer/review prompts are unchanged. Authorized ingestion must supply verified provenance; this draft does not build that collector or the actual fact validator.

## Evidence and release state

Based on #49 head `3f83024`, not main; this is a separate stacked, one-problem draft. The temporary uncommitted checkout disappeared during interruption; work was restored into a permanent workspace and the checks rerun. Previous paid comparison result files remain unchanged; no comparison was restarted.

Nine focused tests cover owner/forum guards, non-rebinding case scope, coordinator bounds/failures and fixed logs. Eight fail on the pre-change source; the unsupported-forum guard already passed and is retained. The new guarded SQL verifier also fails on the baseline. Further observed SQL failures catch automatic legacy/post-scope mismatches and an unidentified deletion-marker omission before repair. Local full 887/offline8/PGlite checks pass. SQL covers 101 facts across two passes, actual memory-command orchestration, other owner/forum/server preservation, unchanged fact state, redundant barrier deletion, opt-out survival, late/new-case writers, worker retry, idempotence, concurrent writing and strict legacy/orphan/marker refusal. Hosted real PostgreSQL must separately verify multi-connection behavior; PGlite alone is serial evidence.

Independent review, parent #49 review/integration, full privacy/security/data-use gates and the enabled memory pilot remain required. No provider/held-out run, production database operation, Discord post, main merge, deploy, permission/settings change or optional enablement. Full C1–C4 and D1–D6 acceptance remains open; score stays 46/100.
