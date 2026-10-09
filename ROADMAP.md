# Omi Support Bot Roadmap

This is the living implementation record. A checked implementation item means code exists and its regression checks passed; it does not mean production was deployed. Record release verification separately. Preserve the current official-source answer/review pipeline and improve the whole customer workflow, not isolated examples.

## Current milestone

**The workflow foundation is in [PR #26](https://github.com/BasedHardware/omi-vector-bot/pull/26); durable engineering approvals and destination privacy checks are in [PR #28](https://github.com/BasedHardware/omi-vector-bot/pull/28).** Both are implemented and awaiting production rollout. The independent citation cleanup is [PR #27](https://github.com/BasedHardware/omi-vector-bot/pull/27). No GCP permissions or customer-content access have been granted. Both follow-ups build on #26, not on a separately deployed foundation.

The existing PR #24 smoke-test prerequisite still applies to the approved PR #25 readiness rollout. Do not redeploy over an unfinished smoke test or claim the new foundation is live before deployment and end-to-end checks succeed.

The next delivery-reliability slice is implemented on `feat/support-delivery-receipts`, based on #28. It adds a metadata-only receipt ledger for the ordinary answer path and full private Discord staff cards. It does not yet provide the complete payload outbox or cover every notification transport. Validation and its PR are recorded below after checks finish.

## Already working before this milestone

- [x] Official Help Center/docs/source retrieval, interpretation, independent answer review and grounded source links.
- [x] Explicit mentions in accessible general channels and scoped direct-reply continuations; staff interventions and pure thanks remain quiet.
- [x] Public ephemeral order commands with email ownership verification.
- [x] Private staff handoffs and redacted, staff-approved GitHub filing.
- [x] Per-stage timing/token logging, escalation reasons and a second review after a rejected first review.

These capabilities remain subject to answer-quality checks. Existing functionality is not a blanket company-grade signoff.

## Milestone 1 Reliable support workflows

- [x] Persist verified order-email bindings with owner-bound encryption, 30-day expiry and revocation.
- [x] Persist single-use verification challenges, attempt counts and resend limits; consume the challenge and save the binding atomically. Database errors do not silently downgrade to memory.
- [x] Store one active support case per channel and customer, with operational categories, official source references, linked thread and escalation identifiers.
- [x] Distinguish queued, delivered, accepted, resolved and closed states. Customer-visible cards alone are not delivery proof.
- [x] Let authorized staff accept a bot-authored case card in the private staff channel; retain the first accepting staff identity/time and keep the control off public cards.
- [x] Close database cases/escalations only after the customer notice sends. Failed Telegram sends leave the case pending. Customer-authorized reopening protects newer active cases.
- [x] Coordinate message claims, case leases, normalized repeat suppression and three leased worker slots through Postgres.
- [x] Bound in-memory waiting work. Overflow persists only message/channel/customer references and a hash, then fetches the original opted-in Discord message for processing; no raw question is stored in the queue.
- [x] Stop accepting work on shutdown and wait for support replies, interactions and Telegram polling. Unstarted work is queued for later recovery; uncertain started deliveries are not automatically replayed.
- [x] Require matching requested order number and verified owner; never substitute another order after an explicit-number miss. Use a supported Shopify API contract and reject unexpected served versions.
- [x] Keep verified private order facts out of chat-model prompts and public replies; retain them only in authorized ephemeral commands and private staff intake.
- [x] Put empathetic, action-first, truthful communication into both answer/reviewer instructions and deterministic reply paths. Application-confirmed delivery chooses the single thread/email next step.
- [x] Add unit regressions and an isolated SQL integration check for schema, claims, queue, case isolation, verification and revocation.
- [x] Add PR checks with no provider/Discord secrets, and a disposable Postgres integration job.
- [x] Complete hosted CI for runtime head `3960f24`: rules on Node 20/24 and the disposable Postgres job pass.
- [x] Run a focused three-run communication evaluation: eight cases meet the pass threshold, one is flaky, none fail the threshold. This is not the 81-case held-out gate or a production smoke test.
- [ ] Deploy through the existing smoke-test and rollback gates; verify real private delivery, restart behavior and deployment overlap.

## Milestone 2 Complete case handling and delivery recovery

- [x] Persist encrypted, minimized GitHub issue/comment drafts, their exact case/customer/source/repository scope, staff edits, preview revisions, approval claims and external receipts across restarts.
- [x] Require a staff-authored technical summary and an exact private preview before a public GitHub write. Never forward customer text, attachments or Discord links automatically; public customer cards have no publication controls.
- [x] Stage important follow-ups from the owning customer's dedicated thread for a separate staff-approved comment when exactly one engineering target is linked. Shared-channel or ambiguous follow-ups remain manual, not guessed.
- [x] Hold uncertain GitHub writes without retrying the POST. A staff check uses bounded read-only reconciliation with application provenance and exact payload verification; confirmed receipts can repair private case links without reposting.
- [x] Validate Discord staff destination privacy and bot permissions before sending a full card or handling publication. Unknown audience permissions fail closed without fetching extra guild members or granting broader intents.
- [x] Persist scoped attempts and accepted message IDs for ordinary answers and full private Discord staff cards; fence parallel sends and stop generic second replies after uncertain outcomes. No message bodies, attachments or rendered cards are retained in this ledger.
- [x] Reconcile matching own-bot Gateway receipts and repair accepted staff delivery/approval-card records after restart, without another POST. Restore customer-owned answer continuation references from recent receipts.
- [x] Fence delayed staff receipts by case generation; reopening clears prior delivery/acceptance and old receipts cannot deliver a reopened case. Provide a read-only, content-free inspection command for held receipts.
- [ ] Add a delivery outbox with accepted-send identifiers, retries for known failures and reconciliation of unknown outcomes. Do not blindly replay a request that may already have replied.
- [ ] Preserve an encrypted/minimized case summary of attempted steps and missing details, with an approved retention/deletion policy. Current durable case context is categories and sources, not raw conversation content.
- [ ] Provide staff queue views, committed response targets, reminders and operational inspection of expired started claims.
- [ ] Enforce cross-identity verification abuse limits. Discord destination validation is implemented above; Telegram destination verification remains a separate follow-up.
- [ ] Add capability checks and monitoring for stale knowledge, provider outages, lookup failures, backlog and missed staff delivery.

Receipt-ledger limits: no automatic late send or whole-request replay; a missed Gateway event plus a lost REST receipt remains held. Non-ticket notices, reused-handoff answers, `/done`, ephemeral commands, Telegram and GitHub tracking notices still need their own delivery adapters. Known rejection is eligible for at most three deliberate attempts within ten minutes, not an automatic retry loop. Metadata retention/deletion and durable pending payload retention require an explicit policy; this slice does not silently purge holds or retain customer content.

## Milestone 3 Verified recording diagnostics

- [ ] Add private Omi sign-in and a short-lived, revocable diagnostic grant bound to the customer and case. Shopify OTP is not Omi account authorization.
- [ ] Implement a backend-owned, pure-read diagnostic projection for capture/upload/sync/finalization/storage availability. Existing backend GET endpoints are not automatically safe to proxy.
- [ ] Authenticate the bot to that one capability; enforce ownership, bounded windows/results and an allowlisted output schema outside the model.
- [ ] Keep audio, transcripts, titles/summaries, photos, raw logs, signed URLs, keys and unrelated customers out of model inputs and public replies.
- [ ] Add bounded server-side log correlation only if metadata alone is insufficient; do not grant the public bot general GCP log/database access.
- [ ] Pilot with synthetic accounts, then a small authorized group. Test unauthorized, wrong-customer, expired/revoked-grant and injection cases before public enablement.

Recovery, reprocessing, refunds, deletion and account mutations remain separate human-authorized workflows. A diagnostic result must distinguish unknown evidence from verified loss and must not promise recovery.

## Milestone 4 Answer quality and operations

- [x] Redesign `/done` closure with internal resolution feedback and optional honest App Store/Google Play review links. Links are shown before any vote, regardless of satisfaction. Store clicks are not dashboard votes or verified review submissions.
- [x] Keep “Still need help” functional and show feedback-storage failure honestly, without invented dashboard totals or a false “recorded” acknowledgment.
- [x] Implement a separate citation fix for recognized localized labels with both ASCII and fullwidth colons, including Chinese, so the grounded formatter emits one source line without deleting prose or unknown identifiers. It is not an engineering-workflow dependency.
- [ ] Improve retrieval coverage and publish missing official support guidance; do not compensate with unverified product facts.
- [ ] Maintain a reviewed incident/release registry with deployment evidence, affected versions and supported workarounds. Merged does not mean released.
- [ ] Track resolution/reopen rates, handoff reasons, capability success and p50/p95 latency without logging customer content.
- [ ] Continue speed work after quality holds. Never cut useful evidence to manufacture a faster score.

## Validation and operating rules

Validation recorded on October 9, 2026: 593 unit/regression tests pass, the offline customer check is 8/8, and the isolated SQL check passes. Hosted CI passes on runtime head `3960f24`. The communication probe used snapshot `4d643e3`: 23/24 replies passed, with the voice-question/no-answer case missing part of the requested explanation on one run; later interaction-deadline and public-order privacy changes have separate regressions and CI coverage. Do not hide that remaining answer-quality inconsistency or call this a full held-out approval.

Next-milestone validation: PR #28 independently passes 668 tests; PR #27 independently passes 599. Their combined working tree passes 674 tests and the offline check is 8/8. Isolated SQL passes encrypted drafts, canonical repository identity, single dispatch, preserved legacy ciphertext, private links and migration refusal without deleting conflicting records. A focused three-run live check passes 12/12 replies across deletion how-to, developer-key how-to, Spanish refund and pure thanks. Its staff delivery is stubbed; this is neither a real delivery/ACL smoke test nor a held-out gate. Hosted CI is a separate required check on each PR.

Receipt slice validation at `4ca5e2f`: 729 tests pass and the offline customer check is 8/8. Isolated SQL passes receipt single-dispatch, immutable source/customer/destination/generation/approval scope, rejected retry bounds, unknown holds, Gateway proof and repair backoff. Unit checks also cover reset/5xx/429 transport behavior, removed-control repair, already-bound filed/expired proposals, stale reopened cases and receipt work added during shutdown. The focused live probe is still running; no held-out file was opened or rerun. Real Discord delivery, production restart and overlap verification remain release gates.

Production has not been redeployed. The customer confirmed that the existing PR #24 smoke-test messages have not yet been posted; the approved readiness rollout and foundation release remain pending that verification.

Run `npm test`, the offline customer check and the isolated database check for foundation changes. Customer-facing changes also need focused live evaluation. Held-out files stay unopened and must never become tuning inputs. Record failed checks and remaining limitations instead of marking work complete prematurely.

No production settings or credentials change as a side effect of coding. Previously exposed secrets still need confirmed rotation/revocation; encryption-key rotation needs a data-preserving migration. Omi Support Bot is the product name; technical repository/domain/channel names are not renamed without an explicit migration.

See [Architecture](docs/ARCHITECTURE.md), [Implementation Checklist](docs/IMPLEMENTATION_PLAN.md), and [Operations Runbook](docs/RUNBOOK.md).
