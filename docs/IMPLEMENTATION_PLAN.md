# Omi Support Bot Implementation Checklist

Implement the [architecture](ARCHITECTURE.md) incrementally, retaining the working answer/review, official retrieval, public commands and private staff delivery. [The roadmap](../ROADMAP.md) is the authoritative progress record. Reports 1–3 passed. The retained #43 release record has localization deployed at `dad2505`, but its live close/reopen smoke is still pending; this branch does not recheck production. The support-experience foundation below is a separate draft. Each runtime change needs regression checks and release verification. No cloud access grants accompany this work.

## Release and security prerequisites

### Combined Release 1 (updated October 17 brief)

- [x] Recheck and merge #46 with a merge commit, without deploying.
- [x] Merge #45 and #42 into an isolated release candidate; preserve live closing-card localization and quiet/mention behavior.
- [x] Replace competing character-budget instructions with the shared concise voice; navigation/conditional and actual-failure regressions pass.
- [x] Preserve whole-item clipping, evidence caps, multipart coverage and damage intake; memory stays disabled.
- [ ] Fresh same-day main/candidate 81×2 comparison, concurrency three, awake host, exact provenance and actual per-case signals/replies; provide all artifacts and word-count summary.
- [ ] Independent grading before release merge/deployment. Private memory pilot and fix inbox remain later releases with their own approval/privacy gates.

### October 17 support-experience draft

- [x] Central concise/plain-language voice and transparent Mira identity; preserve factual/safety/source rules.
- [x] Default-off encrypted support memory with allowed forums/authors, customer isolation, edit ordering, deletion/expiry and persistent post opt-out.
- [x] Capture quiet authorized staff context without changing reply triggers; isolate optional write failures from core replies.
- [x] Separately gate retained-context use, enforce requesting customer ownership and uncached revalidation, and cap additional reads/time.
- [x] Record fixed operational outcome categories and produce read-only aggregate, review-required improvement suggestions.
- [x] Add synthetic adapter and SQL checks for restart, concurrency, edits, privacy/deletion and failure behavior; no manual customer posts needed for these checks.
- [x] Delete-before-first-capture regression and SQL coverage; expiry cleanup bypasses a full optional queue with coalesced sweeps. Three new regressions failed before the repair.
- [ ] Pass independent answer-quality review and the required protected gate before merge. #42 remains held; do not reuse its grade or run it again as a side effect.
- [ ] Obtain privacy/processor/retention/security approval, publish a deletion/retention notice and resolve any Discord App Review requirement before enabling capture. Key/security risk remains a prerequisite, not resolved by adding encryption code.
- [ ] Staff-only shadow pilot, then separately approved context reuse and a one-release-at-a-time smoke. No production settings change in this implementation.
- [ ] Implement reviewed knowledge proposals and regression-controlled publication as a later phase. The current aggregate queue does not learn factual answers or retrain itself.

- [x] PR #24's smoke test was reported before #25's verified readiness rollout. Keep subsequent releases gated on their own review, evaluation and production smoke tests; the roadmap records the evidence.
- [ ] **Deferred by Aryan (Oct 9), accepted risk.** Previously exposed credential rotation remains unconfirmed. Plan encryption-key migration without discarding encrypted state; never print or commit secret values.
- [ ] Inventory actual installed GitHub, Shopify and Discord permissions without exposing values. Existing credentials being configured does not prove their scopes or end-to-end capability.
- [ ] Define support owners, response targets, diagnostic consent, retention and an emergency disable procedure before making customer-facing commitments.

## Phase 1 Durable workflows without new backend access

- [ ] Add support cases with customer ownership, context summary, attempted steps, missing details, source references, linked work, delivery destination and resolution state.
- [x] Move message claims, per-case locks, duplicate-answer state, verification bindings and verification throttles to durable storage. Add expiries, revocation and encryption; do not persist raw verification codes.
- [x] Add bounded leased workers and a metadata-only queue for unstarted requests.
- [ ] Add the complete delivery outbox with attempt tracking, reconciliation and retries. Use backoff and an overall deadline, not unlimited retries.
- [x] Stop new work on shutdown; drain accepted work and queue unstarted requests. Coordinate overlapping copies through Postgres claims. Started requests with uncertain delivery remain an operator-reconciliation task.
- [x] Make `/done`, ratings/reopening and Telegram delivery operate on the same case state. Failed customer delivery must not resolve a case.
- [x] Record real staff acceptance through an authenticated private-card action; preserve the first accepting actor/time.
- [x] Shipped #41: project accepted/work/waiting/resolved/closed state into the existing private cards; persist message references, serialize edits and recover missed updates after restart. Retire deleted cards without reposting.
- [x] Shipped #41: send one localized customer-thread acceptance notice naming the actual staff member; retain uncertainty and direct staff to Jump on notification failure. Clear prior ownership on a new reopened acceptance cycle.
- [x] Phase 3 correction: every unconfirmed acceptance notification explicitly tells staff to reply in the customer's thread, in an ephemeral response. Confirmed boot/30-second sweep wiring and stale-card repair after a failed edit; Phase 2 main merged without a rebase. Combined unit suite 661 pass, offline 8/8.
- [x] Report 3 review and production smoke accepted: English/Spanish acceptance/start/wait/refresh-after-restart and `/done` closure. No extra live double-click test required; reopening remains a later #30 smoke prerequisite.
- [x] Phase 4b draft: localize the closing card from stored case language for the 14 acceptance languages, with English fallback; preserve all feedback IDs, links and delivery/ownership checks. Seven new tests (five red before), 668 unit tests pass; review and deployment remain pending after #42.
- [ ] Persist staff-approved issue drafts and action results so a restart does not invalidate the File workflow. Decide whether approved customer updates should reach linked GitHub issues; do not document an inactive path as working.
- [x] Correct exact order targeting: an explicit number not found stays a miss, never another order. Move the retired Shopify API version to a supported tested contract and verify the actual response version. Shopify documents [version fallback](https://shopify.dev/docs/api/usage/versioning) and [order-access scopes](https://shopify.dev/docs/api/usage/access-scopes).
- [ ] Add bounded historical-order pagination and explain accessible history privately.

Acceptance: restart during OTP, overlapping copies, provider slowdown, failed/uncertain sends, repeated webhooks, staff-button use after restart and termination during a reply produce neither false completion nor uncontrolled duplicate work. Existing customer routing/privacy regressions stay green.

## Access prerequisites before metadata diagnostics

- [ ] After #26 and separately verified #28, add the reviewed public known-issues/releases list and product facts sheet, with official sources, versions, review/freshness ownership and deployment evidence.
- [ ] Use AGENTS.md's support voice without inventing access, receipt, acceptance, investigations or outcomes. Runtime prompt/canned-answer changes require the full protected gate.
- [ ] For each new adapter, define a fixed allowlist, customer/case authorization where needed, consent, limits, kill switch and metadata-only audit; validate synthetically, then pilot in the private staff card before reviewed customer enablement.
- [ ] Extend order facts only through exact-owner-verified private/ephemeral delivery, never a normal customer-thread message or model prompt. Keep existing `/order` self-service enabled; do not add order/account writes.
- [ ] Obtain backend-team agreement and privacy review before linked-account metadata/sign-in implementation. Define available/stale/unknown states for device/version/sync/plan and any provable unsynced count; exclude content and unrelated customers.
- [ ] Follow the remaining staged order: reviewed/gated #42 → reviewed closing-card localization → reviewed/private-preflight #28 → reviewed #29 → reviewed #30. The previous two-week go/no-go order is superseded, not a reason to bypass review. Keep deployments separate, with 24 clean hours unless Aryan explicitly says go; add only the authorized phase corrections. Other open queue/monitoring/retention work remains deferred.

## Phase 2 Verified metadata diagnostics

- [ ] Implement Omi sign-in and a short-lived support diagnostic grant with customer, case, scope, expiry, consent and revocation. Do not substitute Shopify OTP or a chat-supplied UID.
- [ ] Add backend-owned, pure read projections for recording-session bindings, upload/sync jobs, conversation finalization and storage metadata. Reads must not decrypt content, download audio, enqueue work or mutate stale-job state.
- [ ] Define a typed response with observation time, status, evidence and uncertainty. Return only allowlisted fields; exclude raw logs, content, URLs to private objects and credentials.
- [ ] Authenticate the bot to this one capability. Avoid broad backend/MCP keys and cloud roles. If log correlation becomes necessary, authorize the gateway identity to an approved log view, not the Discord/model process.
- [ ] Make identity, ownership and output checks deterministic. Reject cross-customer handles and excessive time/result windows. Rate-limit verification and diagnostics independently.
- [ ] Deliver verified private results ephemerally or through an authenticated support page. Public posts contain only a minimal safe acknowledgment and next step.

Acceptance: valid owner succeeds; unverified, expired, revoked, wrong customer, arbitrary UID, guessed job, prompt injection and unauthorized tool requests fail closed. Canary secrets and transcript/audio content never enter model prompts, public replies or bot logs. No-result diagnostics remain unknown rather than declaring data lost.

## Phase 3 Helpful communication backed by real case state

- [x] Incorporate the standing support preference into answer/reviewer contracts and deterministic personal-action replies: empathy, remembered attempts, concise uncertainty and one delivery-controlled support next step.
- [ ] Test before/after verification, staff delivery success/failure, staff acceptance, known/unknown recovery, and repeated follow-ups in several languages.
- [ ] Distinguish attempted action, completed lookup, delivered case, accepted case and confirmed resolution in every reply.
- [ ] Add an approved incident/release record with affected versions, supported workaround, deployment evidence and freshness. A merged PR is background, not a shipped-fix claim.

Acceptance: no invented access, investigations, human ownership, deadlines, outcomes, or diagnostic certainty; no repeated “I can't” loop when a supported next step is available. Tone improves without removing safety warnings or factual limits.

## Phase 4 Restricted rollout and operations

- [ ] Run unit/integration tests, privacy/authorization probes, restart/overlap tests and offline customer evaluation. Run live/held-out evaluation only under its agreed rules; never open or tune against the held-out questions.
- [ ] Pilot new diagnostics in development with synthetic accounts, then a small explicitly authorized staff/customer pilot. Keep the capability disabled server-side for other users.
- [ ] Verify private replies, staff receipt, acceptance and closure end to end. Record capability success, resolution/reopen rate, handoff reasons, answer quality and p50/p95 latency without raw customer content.
- [x] Add PR CI with secret-free rules checks and a disposable Postgres integration service.
- [ ] Add capability-level monitoring. Keep alert destinations consistent with the existing email/in-app preference unless separately changed.
- [x] Document the operator runbook for current capabilities, provider/verification/delivery failure, queued and uncertain work, reopening and release gates.
- [ ] Expand only after review and approval. Refunds, deletions, account changes, recovery and reprocessing remain human-authorized; broader access is a separate decision.

## Scope of this change

This milestone includes actual runtime coordination, case, verification and communication changes with tests. No Railway variables, IAM policies or external customer records are modified during implementation, and production is not considered changed until rollout is verified. Omi Support Bot is the product name; existing repository, domain and channel identifiers stay unchanged.
