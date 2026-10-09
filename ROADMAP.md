# Omi Support Bot Roadmap

This is the living implementation record. A checked implementation item means code exists and its regression checks passed; it does not mean production was deployed. Record release verification separately. Preserve the current official-source answer/review pipeline and improve the whole customer workflow, not isolated examples.

## Current milestone

**Workflow foundation is implemented on the working branch; production rollout is pending.** The earlier documentation-only proposal is now being extended with actual runtime changes. No GCP permissions or customer-content access have been granted.

The existing PR #24 smoke-test prerequisite still applies to the approved PR #25 readiness rollout. Do not redeploy over an unfinished smoke test or claim the new foundation is live before deployment and end-to-end checks succeed.

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
- [x] Put empathetic, action-first, truthful communication into both answer/reviewer instructions and deterministic reply paths. Application-confirmed delivery chooses the single thread/email next step.
- [x] Add unit regressions and an isolated SQL integration check for schema, claims, queue, case isolation, verification and revocation.
- [x] Add PR checks with no provider/Discord secrets, and a disposable Postgres integration job.
- [ ] Complete hosted CI and the focused three-run live evaluation after the final code settles.
- [ ] Deploy through the existing smoke-test and rollback gates; verify real private delivery, restart behavior and deployment overlap.

## Milestone 2 Complete case handling and delivery recovery

- [ ] Persist staff-approved GitHub drafts across restarts and make later approved customer evidence reach linked engineering work.
- [ ] Add a delivery outbox with accepted-send identifiers, retries for known failures and reconciliation of unknown outcomes. Do not blindly replay a request that may already have replied.
- [ ] Preserve an encrypted/minimized case summary of attempted steps and missing details, with an approved retention/deletion policy. Current durable case context is categories and sources, not raw conversation content.
- [ ] Provide staff queue views, committed response targets, reminders and operational inspection of expired started claims.
- [ ] Enforce cross-identity verification abuse limits and validate destination privacy/permissions beyond the presence of configuration.
- [ ] Add capability checks and monitoring for stale knowledge, provider outages, lookup failures, backlog and missed staff delivery.

## Milestone 3 Verified recording diagnostics

- [ ] Add private Omi sign-in and a short-lived, revocable diagnostic grant bound to the customer and case. Shopify OTP is not Omi account authorization.
- [ ] Implement a backend-owned, pure-read diagnostic projection for capture/upload/sync/finalization/storage availability. Existing backend GET endpoints are not automatically safe to proxy.
- [ ] Authenticate the bot to that one capability; enforce ownership, bounded windows/results and an allowlisted output schema outside the model.
- [ ] Keep audio, transcripts, titles/summaries, photos, raw logs, signed URLs, keys and unrelated customers out of model inputs and public replies.
- [ ] Add bounded server-side log correlation only if metadata alone is insufficient; do not grant the public bot general GCP log/database access.
- [ ] Pilot with synthetic accounts, then a small authorized group. Test unauthorized, wrong-customer, expired/revoked-grant and injection cases before public enablement.

Recovery, reprocessing, refunds, deletion and account mutations remain separate human-authorized workflows. A diagnostic result must distinguish unknown evidence from verified loss and must not promise recovery.

## Milestone 4 Answer quality and operations

- [ ] Redesign `/done` closure with internal resolution feedback and optional honest App Store/Google Play review links. Keep the links available regardless of feedback and preserve dashboard semantics.
- [ ] Normalize Chinese citation labels so every language receives exactly one source line.
- [ ] Improve retrieval coverage and publish missing official support guidance; do not compensate with unverified product facts.
- [ ] Maintain a reviewed incident/release registry with deployment evidence, affected versions and supported workarounds. Merged does not mean released.
- [ ] Track resolution/reopen rates, handoff reasons, capability success and p50/p95 latency without logging customer content.
- [ ] Continue speed work after quality holds. Never cut useful evidence to manufacture a faster score.

## Validation and operating rules

Run `npm test`, the offline customer check and the isolated database check for foundation changes. Customer-facing changes also need focused live evaluation. Held-out files stay unopened and must never become tuning inputs. Record failed checks and remaining limitations instead of marking work complete prematurely.

No production settings or credentials change as a side effect of coding. Previously exposed secrets still need confirmed rotation/revocation; encryption-key rotation needs a data-preserving migration. Omi Support Bot is the product name; technical repository/domain/channel names are not renamed without an explicit migration.

See [Architecture](docs/ARCHITECTURE.md), [Implementation Checklist](docs/IMPLEMENTATION_PLAN.md), and [Operations Runbook](docs/RUNBOOK.md).
