# Omi Support Bot Implementation Checklist

Implement the [architecture proposal](ARCHITECTURE.md) incrementally, retaining the working answer/review, official retrieval, public commands and private staff delivery. This checklist is a proposed sequence, not completed implementation. Each runtime change needs a focused draft PR, regression tests, review, and an explicitly approved deployment. No access grants or production changes accompany these documents.

## Release and security prerequisites

- [ ] Complete and report the outstanding PR #24 smoke test before the approved PR #25 readiness rollout. Do not use this architecture work to bypass that gate.
- [ ] Confirm that previously exposed credentials have been rotated or revoked. Never reuse, print or commit exposed values. Plan encryption-key migration without discarding encrypted state.
- [ ] Inventory actual installed GitHub, Shopify and Discord permissions without exposing values. Existing credentials being configured does not prove their scopes or end-to-end capability.
- [ ] Define support owners, response targets, diagnostic consent, retention and an emergency disable procedure before making customer-facing commitments.

## Phase 1 Durable workflows without new backend access

- [ ] Add support cases with customer ownership, context summary, attempted steps, missing details, source references, linked work, delivery destination and resolution state.
- [ ] Move message claims, per-case locks, duplicate-answer state, verification bindings and verification throttles to durable storage. Add expiries, revocation and encryption; do not persist raw verification codes.
- [ ] Add bounded workers and a delivery outbox with attempt tracking, reconciliation and retries. Use backoff and an overall deadline, not unlimited retries.
- [ ] Stop new work on shutdown; drain or safely resume accepted work across deployments. Coordinate overlapping copies through Postgres claims.
- [ ] Make `/done`, ratings/reopening and Telegram delivery operate on the same case state. Failed customer delivery must not resolve a case.
- [ ] Persist staff-approved issue drafts and action results so a restart does not invalidate the File workflow. Decide whether approved customer updates should reach linked GitHub issues; do not document an inactive path as working.
- [ ] Correct exact order targeting: an explicit number not found stays a miss, never another order. Add bounded pagination and explain accessible history privately. Move the retired Shopify API version to a supported tested contract; verify the actual response version. Shopify documents [version fallback](https://shopify.dev/docs/api/usage/versioning) and [order-access scopes](https://shopify.dev/docs/api/usage/access-scopes).

Acceptance: restart during OTP, overlapping copies, provider slowdown, failed/uncertain sends, repeated webhooks, staff-button use after restart and termination during a reply produce neither false completion nor uncontrolled duplicate work. Existing customer routing/privacy regressions stay green.

## Phase 2 Verified metadata diagnostics

- [ ] Implement Omi sign-in and a short-lived support diagnostic grant with customer, case, scope, expiry, consent and revocation. Do not substitute Shopify OTP or a chat-supplied UID.
- [ ] Add backend-owned, pure read projections for recording-session bindings, upload/sync jobs, conversation finalization and storage metadata. Reads must not decrypt content, download audio, enqueue work or mutate stale-job state.
- [ ] Define a typed response with observation time, status, evidence and uncertainty. Return only allowlisted fields; exclude raw logs, content, URLs to private objects and credentials.
- [ ] Authenticate the bot to this one capability. Avoid broad backend/MCP keys and cloud roles. If log correlation becomes necessary, authorize the gateway identity to an approved log view, not the Discord/model process.
- [ ] Make identity, ownership and output checks deterministic. Reject cross-customer handles and excessive time/result windows. Rate-limit verification and diagnostics independently.
- [ ] Deliver verified private results ephemerally or through an authenticated support page. Public posts contain only a minimal safe acknowledgment and next step.

Acceptance: valid owner succeeds; unverified, expired, revoked, wrong customer, arbitrary UID, guessed job, prompt injection and unauthorized tool requests fail closed. Canary secrets and transcript/audio content never enter model prompts, public replies or bot logs. No-result diagnostics remain unknown rather than declaring data lost.

## Phase 3 Helpful communication backed by real case state

- [ ] Incorporate the standing support preference into answer/reviewer contracts and deterministic handoff templates: empathy, remembered attempts, concise uncertainty and one next step.
- [ ] Test before/after verification, staff delivery success/failure, staff acceptance, known/unknown recovery, and repeated follow-ups in several languages.
- [ ] Distinguish attempted action, completed lookup, delivered case, accepted case and confirmed resolution in every reply.
- [ ] Add an approved incident/release record with affected versions, supported workaround, deployment evidence and freshness. A merged PR is background, not a shipped-fix claim.

Acceptance: no invented access, investigations, human ownership, deadlines, outcomes, or diagnostic certainty; no repeated “I can't” loop when a supported next step is available. Tone improves without removing safety warnings or factual limits.

## Phase 4 Restricted rollout and operations

- [ ] Run unit/integration tests, privacy/authorization probes, restart/overlap tests and offline customer evaluation. Run live/held-out evaluation only under its agreed rules; never open or tune against the held-out questions.
- [ ] Pilot new diagnostics in development with synthetic accounts, then a small explicitly authorized staff/customer pilot. Keep the capability disabled server-side for other users.
- [ ] Verify private replies, staff receipt, acceptance and closure end to end. Record capability success, resolution/reopen rate, handoff reasons, answer quality and p50/p95 latency without raw customer content.
- [ ] Add PR CI and capability-level monitoring. Keep alert destinations consistent with the existing email/in-app preference unless separately changed.
- [ ] Document the operator runbook: provider outage, verification failure, diagnostic outage, staff delivery failure, stuck/reopened cases, incident communication, credential revocation and rollback.
- [ ] Expand only after review and approval. Refunds, deletions, account changes, recovery and reprocessing remain human-authorized; broader access is a separate decision.

## Scope of this change

Only architecture and implementation documentation are added. No runtime code, Railway variables, IAM policies, external customer records or live bot behavior are changed. Omi Support Bot is the product name; existing repository, domain and channel identifiers stay unchanged.
