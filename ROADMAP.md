# Omi Support Bot Roadmap

This is the living implementation record. A checked implementation item means code exists and its regression checks passed; it does not mean production was deployed. Record release verification separately. Preserve the current official-source answer/review pipeline and improve the whole customer workflow, not isolated examples.

## Release-only mode and merge gates

Feature work is frozen. Do not extend Milestone 2, add diagnostics code or make further feature commits to #28–#30. #25 and #31 have explicit release approval and are live; #26 and the remaining stack still require review before merge/deployment.

1. Complete and report Aryan's four #24 smoke tests, their exact timing lines, second-look lines and errors, and the private staff card. Screenshots received on October 9 confirm the four replies and replacement card. Totals: deletion 24.760 s, replacement 30.631 s, Spanish 31.251 s, developer 53.540 s; no second looks or model/staff-delivery failures in that window. Functional checks pass, but do not convert this into a blanket answer-quality signoff: the Undo wording overpromises recovery and the replacement intake asks for tracking details.
2. Release approved #25 with a merge commit, deploy main, verify HTTP 200/status `ok`/staff handoff `configured`, and record a real successful rollback target. Read but do not change overlap/draining variables. Set only Healthcheck Path `/health`, leave timeout default, verify the health-gated deployment and measure new Discord login versus old SIGTERM. If overlap exceeds ten seconds, tell Aryan before any further deployments.
3. Standalone citation fix [#31](https://github.com/BasedHardware/omi-vector-bot/pull/31) replaces #27, whose branch is retained. Approved head `4f2c6e5` is merged as `3a28c7f`; 516 tests and offline 8/8 pass. Deployment `0955e078-42ea-4830-bba5-006dae841745` succeeded in an observed quiet window, with HTTP 200/status `ok`/staff handoff `configured` and Discord login confirmed. Rollback target: `75e41379-2bad-46a4-b130-04bd52382504`. Spanish phone-only smoke reply ends with one Fuente line. Chinese returns/warranty reply has one 来源 line followed by an English handoff footer; Aryan confirmed staff receipt and approved continuing with this layout exception recorded. Smoke total timing: Spanish 39.197 s, Chinese 55.366 s. No reply-formatting or Railway setting changes were made. Hosted CI on main still awaits unmerged #26.
4. #26's protected gate is complete at tested head `fb97e4b`, with main's citation fix applied: 81 cases × two runs, concurrency three, 162 valid replies. Automated structural scores: 73 pass both / 2 flaky / 6 fail both. Latency fails the approved gate: total p50 45.281 s (limit 43 s), p95 76.107 s (limit 70 s). Output: `/Users/astar/omi-eval/holdout-pr26-oct9.json`. The case file stayed unopened, and no implementation was tuned or rerun from these results. Provide the JSON and stop for review; do not merge/deploy #26. The gate still requires ≥70 pass both, safety counts zero (recognize source labels with both `:` and `：`), p50 ≤43 s and p95 ≤70 s. Structural scoring is not a factual-answer or broad safety signoff.
5. After #26 is deployed, release #28, then #29, then #30 separately, each only after approval and with its own deploy/health/Discord smoke test: staff-authored GitHub preview/approval (#28), forced duplicate-send check in #vector-test (#29), and `/done` close/reopen (#30). No further feature commits. These existing delivery-only changes do not need the held-out test under the approved release plan.

Any change to answer/reviewer prompts or canned customer-answer replies must pass the full **81-case held-out gate before merge**. A focused live probe is additional evidence, never a substitute. Keep held-out questions unopened, preserve distinct checkout/commit provenance and do not alter code based on protected-case results. Merge commits only; no generated authorship trailers, model names in commit messages, force-pushes or direct pushes to main.

Product decision confirmed by Aryan: **keep** optional honest App Store/Google Play review buttons in #26, shown regardless of feedback. Their implementation is complete; release remains pending #26's gates. Store clicks are not internal support votes or verified review submissions.

Customer-impacting follow-ups take priority over deferred plumbing: developer pages cited for consumer questions; deletion how-to escalating unnecessarily; and speed. Chinese duplicate source labels are addressed by #31; the English footer following its localized citation is a recorded smoke exception, not a new formatting fix. Record any failures without adding fixes during this release-only turn. Milestone 3 stays parked until Omi backend-team agreement and privacy review, before any implementation.

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
- [x] Keep verified private order facts out of chat-model prompts and public replies; retain them only in authorized ephemeral commands and private staff intake.
- [x] Put empathetic, action-first, truthful communication into both answer/reviewer instructions and deterministic reply paths. Application-confirmed delivery chooses the single thread/email next step.
- [x] Add unit regressions and an isolated SQL integration check for schema, claims, queue, case isolation, verification and revocation.
- [x] Add PR checks with no provider/Discord secrets, and a disposable Postgres integration job.
- [x] Complete hosted CI for runtime head `3960f24`: rules on Node 20/24 and the disposable Postgres job pass.
- [x] Run a focused three-run communication evaluation: eight cases meet the pass threshold, one is flaky, none fail the threshold. This is not the 81-case held-out gate or a production smoke test.
- [ ] Deploy through the existing smoke-test and rollback gates; verify real private delivery, restart behavior and deployment overlap.

## Milestone 2 Complete case handling and delivery recovery

Frozen for release, not further feature development. Completed work exists in the held #28 (durable engineering approvals/destination checks), #29 (Discord receipt ledger) and #30 (tracked closure/reopening) branches. That is not production deployment.

- [ ] **Deferred:** complete delivery outbox, remaining adapters, bounded retries and uncertain-outcome reconciliation. Never blindly replay a request that may already have replied.
- [ ] **Deferred:** encrypted/minimized cumulative case summaries and attempted steps, pending an approved retention/deletion policy. Current durable context is operational categories and sources, not raw conversation content.
- [ ] **Deferred:** staff queue views, committed response targets, reminders and additional operational inspection.
- [ ] **Deferred:** cross-identity verification abuse controls and remaining destination verification. Discord audience checks are already in #28; Telegram verification remains unfinished.
- [ ] **Deferred:** additional capability checks/monitoring for stale knowledge, outages, failed lookups, backlog and missed staff delivery.

## Milestone 3 Verified recording diagnostics

Parked. Omi backend-team agreement and privacy review are prerequisites before writing diagnostics/sign-in code or granting access.

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
- [x] Normalize Chinese citation labels (#31 live; Chinese smoke has one 来源 citation line, with the footer-layout exception above).
- [ ] Improve retrieval coverage and publish missing official support guidance; do not compensate with unverified product facts.
- [ ] Maintain a reviewed incident/release registry with deployment evidence, affected versions and supported workarounds. Merged does not mean released.
- [ ] Track resolution/reopen rates, handoff reasons, capability success and p50/p95 latency without logging customer content.
- [ ] Continue speed work after quality holds. Never cut useful evidence to manufacture a faster score.

## Deferred security work: N12 exposed credential rotation

**Deferred by Aryan (Oct 9), accepted risk.** Removed from the first priority slot at Aryan's explicit request; N12 remains an unresolved P0 security finding, not a completed rotation or a lowered severity.

- [ ] Rotate/revoke the exposed Discord token, GitHub App private key, webhook secret and CommandCode key; revoke the old OpenCode key. Rotation/revocation is unconfirmed.
- [ ] Handle `DATA_ENCRYPTION_KEY` through a data-preserving migration before replacement. Do not make retained encrypted records unreadable or reset state to hide a failure.

Never print or paste replacement values into chat, logs or GitHub. Record completion through provider-side revocation and successful authorized use, not merely a variable being present. No credential or Railway variable changes are authorized as a side effect of this release/evaluation work.

## Validation and operating rules

Validation recorded on October 9, 2026: 593 unit/regression tests pass, the offline customer check is 8/8, and the isolated SQL check passes. Hosted CI passes on runtime head `3960f24`. The communication probe used snapshot `4d643e3`: 23/24 replies passed, with the voice-question/no-answer case missing part of the requested explanation on one run; later interaction-deadline and public-order privacy changes have separate regressions and CI coverage. Do not hide that remaining answer-quality inconsistency or call this a full held-out approval.

The #24 smoke test is now posted and reported. #25 is merged as `4f7d7a1` and live: initial deployment `73760501-ddd2-4b49-a21d-7e383840b5d8`, then health-gated deployment `75e41379-2bad-46a4-b130-04bd52382504`, both SUCCESS. `/health` returns HTTP 200, status `ok` and staff handoff `configured`. Only Healthcheck Path `/health` changed; timeout remains default, overlap/draining variables remain unset, and no credential variables changed.

Railway healthcheck evidence (UTC): started 15:14:45.671, new Discord login 15:14:46.451, healthcheck passed 15:14:46.871. The old bot's own `Received SIGTERM` line is missing; platform stop is 15:14:53.151 (+6.7 s) and npm SIGTERM is 15:15:02.638 (+16.2 s). The npm time is a termination proxy, not proof of exact dual-connection duration. This possible over-ten-second window was reported to Aryan; **further deployments are paused for review**, without changing teardown/window settings. No Missing env, model failed or Staff delivery failed lines were found since the health-gated deployment.

The earlier #25 rollback targets remain historical records. Current production is #31 deployment `0955e078-42ea-4830-bba5-006dae841745`, with `75e41379-2bad-46a4-b130-04bd52382504` as its rollback target. Aryan's explicit approval for #31's quiet-window release superseded the earlier deployment pause; overlap/draining/start settings were not changed. #26 incorporates main through merge commit `95c2c13` (citation formatter from main; readiness combines Discord, coordination initialization and non-stopping runtime). Its unit suite passes 603 tests and offline check is 8/8; hosted Node 20/24 and disposable database checks pass at tested head `fb97e4b`. Its protected gate is complete but blocked by latency, as recorded above. #26, #28, #29 and #30 remain unmerged/unreleased. No feature commits were made to #28–#30.

The current Railway service/deployment start-command overrides are unset; runtime logs confirm the npm start lifecycle before `node index.js`. Changing to direct Node remains a #26 rollout action, not performed here. Output-only safety review has not found positive destructive troubleshooting instructions, duplicate citation lines, or staff-action promises without the harness handoff flag. This is not a clean broad-safety approval: heat precautions, non-English data-preservation warnings, public intake of tracking/conversation details, and extra email redirects after handoff need review. No fixes were added from the protected results.

Run `npm test`, the offline customer check and relevant isolated database checks. Answer/reviewer prompt or canned-answer changes require the full 81-case held-out gate before merge, not just a focused live probe. Held-out files stay unopened and must never become tuning inputs. Record failed checks and remaining limitations instead of marking work complete prematurely.

No production settings or credentials change as a side effect of coding. Previously exposed credentials remain unrotated/unconfirmed, deferred by Aryan with accepted risk; encryption-key rotation needs a data-preserving migration. Omi Support Bot is the product name; technical repository/domain/channel names are not renamed without an explicit migration.

See [Architecture](docs/ARCHITECTURE.md), [Implementation Checklist](docs/IMPLEMENTATION_PLAN.md), and [Operations Runbook](docs/RUNBOOK.md).
